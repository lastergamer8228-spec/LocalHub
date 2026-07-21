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
import com.localhub.localhub.util.AppLogger
import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.Response.Status
import fi.iki.elonen.NanoWSD
import kotlinx.coroutines.flow.StateFlow
import java.io.IOException

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
    private val moduleManager: ModuleManager,
    private val logger: AppLogger,
    private val preferencesManager: PreferencesManager,
    private val statisticsRepository: StatisticsRepository,
    private val logRepository: LogRepository,
    private val gson: Gson,
    private val clientTracker: ClientTracker,
    private val reportStatus: (ServerStatus) -> Unit,
    private val port: Int
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
        preferencesManager = preferencesManager
    )
    private val assetServer = AssetServer(context)

    val clients: StateFlow<List<ConnectedClient>> = clientTracker.clients

    fun startServer(): Boolean {
        return try {
            if (wasStarted()) stop()

            start(30_000, false)

            val snapshot = systemInfoProvider.collectSnapshot()
            reportStatus(
                ServerStatus(
                    running = true,
                    port = listeningPort,
                    host = snapshot.network.ipAddress,
                    version = Constants.SERVER_VERSION,
                    startedAt = System.currentTimeMillis(),
                    uptimeMs = 0
                )
            )

            logger.info(TAG, "Server started on port $listeningPort")
            true
        } catch (e: IOException) {
            logger.error(TAG, "Failed to start server: ${e.message}")
            false
        }

    }

    fun stopServer() {
        try {
            stop()
        } catch (e: Exception) {
            logger.error(TAG, "Error stopping server: ${e.message}")
        }
        reportStatus(
            ServerStatus(false, port, "", Constants.SERVER_VERSION, 0, 0)
        )
        logger.info(TAG, "Server stopped")
    }

    override fun openWebSocket(handshake: IHTTPSession): NanoWSD.WebSocket =
        LocalHubWebSocket(handshake, hub, clientTracker, logger)

    override fun serveHttp(session: IHTTPSession): Response {
        val uri = session.uri ?: "/"
        return try {
            clientTracker.httpHit(
                session.remoteIpAddress ?: "unknown",
                session.headers["user-agent"] ?: "Unknown"
            )
            when {
                uri.startsWith("/api/") -> apiRouter.handle(session)
                uri.startsWith("/ws") -> info("/ws is a WebSocket endpoint — connect with Upgrade: websocket")
                else -> moduleManager.findHandler(session, uri) ?: assetServer.serve(uri) ?: notFound()
            }
        } catch (e: Exception) {
            logger.error(TAG, "serveHttp error: ${e.message}")
            error(Status.INTERNAL_ERROR, e.message ?: "internal error")
        }
    }

    fun broadcast(json: String) = hub.broadcast(json)

    fun broadcastStats(snapshot: SystemInfo) =
        hub.broadcast(gson.toJson(mapOf("type" to "stats", "data" to snapshot)))

    fun broadcastLog(entry: LogEntry) =
        hub.broadcast(gson.toJson(mapOf("type" to "log", "data" to entry)))

    fun pruneClients() = clientTracker.prune()

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
    }
}
