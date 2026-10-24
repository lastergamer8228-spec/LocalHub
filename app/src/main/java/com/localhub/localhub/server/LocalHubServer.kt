package com.localhub.localhub.server

import android.content.Context
import com.localhub.localhub.core.Constants
import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.data.repository.StatisticsRepository
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.model.SystemInfo
import com.localhub.localhub.module.ModuleManager
import com.localhub.localhub.system.SystemInfoProvider
import com.localhub.localhub.system.DeviceActions
import com.localhub.localhub.system.ScreenMirror
import com.localhub.localhub.system.TtsEngine
import com.localhub.localhub.util.AppLogger
import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.Response.Status
import fi.iki.elonen.NanoWSD
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import java.io.IOException
import java.io.InputStream
import java.security.KeyStore
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLServerSocketFactory

/**
 * The embedded local server. Serves the dashboard + REST API over HTTP and
 * realtime updates over WebSocket. Built directly on NanoWSD (one version,
 * 2.3.1) so the NanoHTTPD / NanoWSD APIs always match.
 *
 * Status updates are pushed to [reportStatus] and client changes flow through
 * the shared [clientTracker] so UI state survives server restarts (e.g. when the
 * listening port is changed).
 */
class LocalHubServer(
    private val context: Context,
    private val systemInfoProvider: SystemInfoProvider,
    private val deviceActions: DeviceActions,
    private val screenMirror: ScreenMirror,
    private val ttsEngine: TtsEngine,
    private val moduleManager: ModuleManager,
    private val logger: AppLogger,
    private val preferencesManager: PreferencesManager,
    private val statisticsRepository: StatisticsRepository,
    private val logRepository: LogRepository,
    private val gson: Gson,
    private val clientTracker: ClientTracker,
    private val sessionManager: SessionManager,
    private val shareTokenManager: ShareTokenManager,
    private val controlServer: (String) -> Unit,
    private val reportStatus: (ServerStatus) -> Unit,
    private val port: Int,
    private val healthSummary: () -> String = { "" }
) : NanoWSD(port) {

    private val hub = WebSocketHub()

    private val apiRouter = ApiRouter(
        systemInfoProvider = systemInfoProvider,
        moduleManager = moduleManager,
        statisticsRepository = statisticsRepository,
        logRepository = logRepository,
        clientTracker = clientTracker,
        gson = gson,
        logger = logger,
        preferencesManager = preferencesManager,
        serverCommand = controlServer,
        sessionManager = sessionManager,
        shareTokenManager = shareTokenManager,
        deviceActions = deviceActions,
        screenMirror = screenMirror,
        ttsEngine = ttsEngine,
        context = context,
        listenerPort = { listeningPort },
        protocol = { activeProtocol }
    )

    @Volatile private var activeProtocol = "http"

    private val assetServer = AssetServer(context)

    val clients: StateFlow<List<ConnectedClient>> = clientTracker.clients

    @Volatile var lastError: String? = null
        private set

    fun startServer(): Boolean {
        if (isAlive) return true
        return try {
            if (wasStarted()) stop()

            // Optional HTTPS: if enabled, wrap the server with a self-signed TLS
            // certificate generated at runtime via the Android KeyStore.
            val httpsEnabled = runBlocking { preferencesManager.getHttpsEnabled() }
            if (httpsEnabled) {
                applyTls()
            }

            start(30_000, false)

            activeProtocol = if (httpsEnabled) "https" else "http"
            ServerClock.markStart()
            val snapshot = systemInfoProvider.collectSnapshot()
            reportStatus(
                ServerStatus(
                    running = true,
                    port = listeningPort,
                    host = snapshot.network.ipAddress,
                    version = Constants.SERVER_VERSION,
                    startedAt = System.currentTimeMillis(),
                    uptimeMs = 0,
                    protocol = if (httpsEnabled) "https" else "http"
                )
            )

            lastError = null
            logger.info(TAG, "Server started on port $listeningPort")
            true
        } catch (e: Exception) {
            lastError = e.message ?: "Server startup failed"
            logger.error(TAG, "Failed to start server: ${e.message}")
            false
        }

    }

    fun cancelMediaWork(): Boolean = apiRouter.cancelMediaWork()

    fun stopServer() {
        apiRouter.cancelMediaWork(wait = false)
        try {
            stop()
        } catch (e: Exception) {
            logger.error(TAG, "Error stopping server: ${e.message}")
        }
        ServerClock.reset()
        reportStatus(
            ServerStatus(false, port, "", Constants.SERVER_VERSION, 0, 0)
        )
        logger.info(TAG, "Server stopped")
    }

    /**
     * Wraps the server in TLS using a bundled self-signed PKCS12 keystore
     * (the old bundled res/raw/localhub_keystore.p12, since removed). Opt-in
     * feature: local traffic uses plain HTTP by default; enabling HTTPS is for
     * users who want transport encryption on a trusted network.
     *
     * The bundled cert is self-signed, so browsers will warn about it — that is
     * expected and acceptable for a local, offline server. See the build note in
     * the project README for regenerating the keystore with keytool.
     */
    /**
     * Enables TLS with a per-install key from the Android Keystore.
     *
     * The bundled PKCS#12 key was shared by every installation (same private key
     * shipped in the APK), so it could be extracted to decrypt traffic. We now
     * fail closed: if no device key is available the server refuses to start
     * rather than serving plaintext or reusing a shipped key.
     */
    private fun applyTls() {
        try {
            val ks = com.localhub.localhub.system.TlsCertificateManager.keystoreOrNull()
                ?: throw IllegalStateException("no per-install TLS identity available")

            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
            // Keystore-backed keys are not password protected.
            kmf.init(ks, null)

            val socketFactory: SSLServerSocketFactory =
                javax.net.ssl.SSLContext.getInstance("TLS").apply {
                    init(kmf.keyManagers, null, null)
                }.serverSocketFactory as SSLServerSocketFactory

            // NanoHTTPD: makeSecure(SSLServerSocketFactory, protocols).
            makeSecure(socketFactory, arrayOf("TLSv1.2"))
            logger.info(TAG, "HTTPS enabled with a per-install self-signed certificate. Browsers will warn about the certificate.")
        } catch (e: Exception) {
            logger.error(TAG, "HTTPS setup failed: ${e.message}")
            throw IllegalStateException(
                "HTTPS is enabled but no per-install certificate is available on this device. Turn HTTPS off, or check the device keystore.",
                e
            )
        }
    }

    override fun openWebSocket(handshake: IHTTPSession): NanoWSD.WebSocket {
        // Require a valid session for WebSocket connections so telemetry/log
        // broadcasts are not exposed to unauthenticated clients.
        val token = handshake.parms?.get("token")
            ?: handshake.headers?.get("authorization")?.removePrefix("Bearer ")?.trim()
            ?: ""
        if (sessionManager.validate(token, handshake.remoteIpAddress ?: "?") == null) {
            throw NanoWSD.WebSocketException(
                NanoWSD.WebSocketFrame.CloseCode.PolicyViolation,
                "WebSocket authentication required"
            )
        }
        val ip = handshake.remoteIpAddress ?: "?"
        if (clientTracker.isBlocked(ip)) throw NanoWSD.WebSocketException(NanoWSD.WebSocketFrame.CloseCode.PolicyViolation, "Device blocked")
        return LocalHubWebSocket(handshake, hub, clientTracker, logger,
            sessionManager.validate(token, ip)?.role == "admin") {
                !clientTracker.isBlocked(ip) && sessionManager.validate(token, ip) != null
            }
    }

    override fun serveHttp(session: IHTTPSession): Response {
        val uri = session.uri ?: "/"
        val ip = session.remoteIpAddress ?: "unknown"
        // Device policy: a blocked IP is rejected outright (login page still
        // reachable so the admin can see a message, but no data is served).
        if (clientTracker.isBlocked(ip) && !uri.startsWith("/login.html") && uri != "/api/auth/login") {
            return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.FORBIDDEN, NanoHTTPD.MIME_PLAINTEXT,
                "403 Device blocked by administrator"
            ).apply { addHeader("Access-Control-Allow-Origin", "*") }
        }
        moduleManager.blocked(uri)?.let { disabled ->
            return NanoHTTPD.newFixedLengthResponse(Status.SERVICE_UNAVAILABLE, NanoHTTPD.MIME_PLAINTEXT,
                "Module disabled: $disabled. Enable it in the Android controller.")
                .apply { addHeader("Cache-Control", "no-store") }
        }
        return try {
            clientTracker.httpHit(
                ip,
                session.headers["user-agent"] ?: "Unknown"
            )
            val response = when {
                uri.startsWith("/api/") -> apiRouter.handle(session)
                uri.startsWith("/ws") -> info("/ws is a WebSocket endpoint — connect with Upgrade: websocket")
                else -> servePage(session, uri)
            }
            logAccess(session.method, uri, response, session)
            response
        } catch (e: Exception) {
            logger.error(TAG, "serveHttp error: ${e.message}")
            error(Status.INTERNAL_ERROR, e.message ?: "internal error")
        }
    }

    /**
     * Records a per-request access log entry (method, path, HTTP status) so the
     * dashboard can show real access history. High-frequency telemetry polls and
     * the log/status endpoints are skipped to keep the feed meaningful and avoid
     * flooding storage with the periodic 3–5s dashboard polls.
     */
    private fun logAccess(method: NanoHTTPD.Method, uri: String, response: Response, session: IHTTPSession) {
        // Skip internal telemetry + status polls.
        if (uri.startsWith("/api/") && SKIPPED_POLL_APIS.any { uri.startsWith(it) }) return
        if (uri.startsWith("/ws")) return

        val status = runCatching { response.getStatus().requestStatus }.getOrDefault(0)
        val from = session.remoteIpAddress ?: "?"
        val label = accessLabel(method, uri)
        logger.info("HTTP", "[$from] $label $status")
    }

    /** Produces a human-readable access label for the given request. */
    private fun accessLabel(method: NanoHTTPD.Method, uri: String): String {
        return when {
            uri.startsWith("/api/fs/download") -> "Download ${uri.substringAfter("paths=", "").take(40)}"
            uri.startsWith("/api/fs/content") -> "Media stream"
            uri.startsWith("/api/fs/upload") -> "Upload"
            uri.startsWith("/api/fs/") -> "FS ${method.name} ${uri.removePrefix("/api/fs/").take(30)}"
            uri == "/" -> "GET /"
            uri.startsWith("/files") -> "GET /files"
            uri.startsWith("/player") -> "GET /player"
            uri.startsWith("/ai") -> "GET /ai"
            uri.startsWith("/api/") -> "API ${method.name} ${uri.take(30)}"
            else -> "${method.name} ${uri.take(40)}"
        }
    }

    fun broadcast(json: String) = hub.broadcast(json)

    fun broadcastStats(snapshot: SystemInfo) =
        if (moduleManager.getModule("core.monitor")?.isEnabled == true) hub.broadcast(gson.toJson(mapOf("type" to "stats", "data" to snapshot))) else Unit

    fun broadcastLog(entry: LogEntry) =
        hub.broadcast(gson.toJson(mapOf("type" to "log", "data" to entry)), adminOnly = true)

    fun pruneClients() = clientTracker.prune()

    /**
     * Serves a browser page behind authentication. The login page and its shared
     * assets are always served; protected pages (dashboard, files, player, ai)
     * require a valid session token (via ?token= or the session cookie).
     */
    private fun servePage(session: IHTTPSession, uri: String): Response {
        val token = session.parms?.get("token")
            ?: runCatching { session.getCookies().read("lhsession") }.getOrNull()
            ?: ""

        val clean = uri.trimEnd('/')
        val isProtected = clean == "" || clean == "/" || clean == "/index.html" ||
            clean == "/files" || clean.startsWith("/files/") ||
            clean == "/player" || clean == "/player.html" ||
            clean == "/ai" || clean == "/ai/index.html" ||
            clean == "/mirror" || clean == "/mirror.html" ||
            clean == "/tts" || clean == "/tts.html" ||
            clean == "/core" || clean == "/core.html" ||
            clean == "/selfheal" || clean == "/selfheal.html" ||
            clean == "/brain" || clean == "/brain.html" ||
            clean == "/os" || clean == "/os/index.html"

        val authed = sessionManager.validate(token, session.remoteIpAddress ?: "?") != null

        if (isProtected && !authed) {
            // Redirect to the login page.
            val redirect = NanoHTTPD.newFixedLengthResponse(
                Status.TEMPORARY_REDIRECT, NanoHTTPD.MIME_HTML,
                "<html><head><meta http-equiv=\"refresh\" content=\"0;url=/login.html\"></head><body>Redirecting…</body></html>"
            )
            redirect.addHeader("Location", "/login.html")
            return redirect
        }

        return moduleManager.findHandler(session, uri) ?: assetServer.serve(uri) ?: notFound()
    }

    private fun info(message: String): Response =
        NanoHTTPD.newFixedLengthResponse(Status.OK, NanoHTTPD.MIME_PLAINTEXT, message)
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun notFound(): Response =
        NanoHTTPD.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "404 Not Found")
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun error(status: Status, message: String): Response =
        NanoHTTPD.newFixedLengthResponse(status, NanoHTTPD.MIME_PLAINTEXT, message)
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    companion object {
        private const val TAG = "LocalHubServer"

        /** Telemetry / dashboard poll endpoints we do not log as access entries. */
        private val SKIPPED_POLL_APIS = listOf(
            "/api/system", "/api/status", "/api/clients", "/api/logs", "/api/modules",
            "/api/statistics", "/api/device", "/api/network", "/api/storage",
            "/api/battery", "/api/cpu", "/api/memory", "/api/fs/usage",
            "/api/dashboard", "/api/endpoints"
        )
    }
}
