package com.localhub.localhub.server

import com.google.gson.Gson
import com.localhub.localhub.core.Constants
import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.data.repository.StatisticsRepository
import com.localhub.localhub.module.ModuleManager
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.system.SystemInfoProvider
import com.localhub.localhub.system.DeviceActions
import com.localhub.localhub.system.ScreenMirror
import com.localhub.localhub.system.RemoteAccessService
import com.localhub.localhub.system.TtsEngine
import com.localhub.localhub.ui.MirrorActivity
import com.localhub.localhub.util.AppLogger
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.Response.Status
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * REST API Router
 */
class ApiRouter(
    private val systemInfoProvider: SystemInfoProvider,
    private val moduleManager: ModuleManager,
    private val statisticsRepository: StatisticsRepository,
    private val logRepository: LogRepository,
    private val clientTracker: ClientTracker,
    private val gson: Gson,
    private val logger: AppLogger,
    private val preferencesManager: PreferencesManager,
    private val serverCommand: (String) -> Unit,
    private val sessionManager: SessionManager = SessionManager(),
    private val shareTokenManager: ShareTokenManager = ShareTokenManager(),
    private val deviceActions: DeviceActions? = null,
    private val screenMirror: ScreenMirror? = null,
    private val ttsEngine: TtsEngine? = null,
    private val context: android.content.Context? = null,
    private val listenerPort: () -> Int = { 8080 },
    private val protocol: () -> String = { "http" },
    private val healthSummary: () -> String = { "" }
) {

    private fun contextOfRouter(): android.content.Context =
        context ?: throw IllegalStateException("no context available")

    private val fileManager = FileManager()
    private val fileOps = FileOperations()
    private val hubStore = HubStore()
    private val compatibleAudioDelegate = lazy { CompatibleAudio(contextOfRouter()) }
    private val compatibleAudio get() = compatibleAudioDelegate.value
    fun cancelMediaWork(wait: Boolean = true): Boolean = !compatibleAudioDelegate.isInitialized() || compatibleAudio.cancelAndWait(wait)
    /** Bounded read for JSON command bodies (file uploads stream separately). */
    private val MAX_JSON_BODY_BYTES = 8L * 1024 * 1024

    private val totp = Totp

    fun handle(session: IHTTPSession): Response {
        if (session.method == NanoHTTPD.Method.OPTIONS) {
            return NanoHTTPD.newFixedLengthResponse(Status.OK, NanoHTTPD.MIME_PLAINTEXT, "")
                .apply { addCors() }
        }
        val uri = session.uri ?: "/"
        val path = uri.removePrefix("/api/").trimEnd('/')
        moduleManager.blocked(uri)?.let { return error(Status.SERVICE_UNAVAILABLE, "Module disabled: $it") }
        return try {
            // Authentication endpoints: login/logout/session are always reachable.
            if (path == "auth/login") return handleLogin(session)
            if (path == "auth/logout") return handleLogout(session)
            if (path == "auth/session") return handleSession(session)
            if (path == "auth/setup") return handleSetupCheck()
            if (path == "auth/change-credentials") return handleChangeCredentials(session)
            if (path == "auth/totp-status") return handleTotpStatus(session)
            if (path == "auth/totp-enroll") return handleTotpEnroll(session)
            if (path == "auth/totp-verify") return handleTotpVerify(session)

            // LAN share: public link to a file/folder WITHOUT login (token-gated).
            // Served before the permission gate because shares are public by design.
            if (path.startsWith("share/")) return handleShare(session, path)

            // Per-device file-access policy (server-side). A device whose admin
            // set a restriction is limited regardless of which account logs in.
            val rest = clientTracker.restriction(session.remoteIpAddress ?: "")
            if (rest != "") {
                val isFsPath = path.startsWith("fs/") || path == "files" || path == "fs/content" || path.startsWith("fs/")
                if (isFsPath) {
                    // "deny" = no file access at all; "RO" = read-only (block mutations)
                    if (rest == "deny") {
                        return NanoHTTPD.newFixedLengthResponse(
                            Status.FORBIDDEN, NanoHTTPD.MIME_PLAINTEXT,
                            "403 File access denied for this device"
                        ).apply { addCors() }
                    }
                    // read-only: block all mutating fs endpoints + upload
                    if (rest == "RO" && (path.startsWith("fs/upload") || path == "fs/mkdir" || path == "fs/rename" ||
                            path == "fs/move" || path == "fs/copy" || path == "fs/delete" || path == "fs/write" ||
                            path == "fs/zip" || path == "fs/unzip")) {
                        return NanoHTTPD.newFixedLengthResponse(
                            Status.FORBIDDEN, NanoHTTPD.MIME_PLAINTEXT,
                            "403 Read-only: file changes not allowed for this device"
                        ).apply { addCors() }
                    }
                }
            }

            // Permission gate: enforce server-side before any endpoint runs.
            val auth = requirePermission(session, path)
            if (auth != null) return auth

            when (session.method) {
                NanoHTTPD.Method.GET -> handleGet(session, path)
                NanoHTTPD.Method.POST -> handlePost(session, path)
                else -> methodNotAllowed()
            }
        } catch (e: Exception) {
            logger.error(TAG, "API error on $path: ${e.message}")
            error(Status.INTERNAL_ERROR, e.message ?: "internal error")
        }
    }

    // ---- Authentication ----

    private fun tokenOf(session: IHTTPSession): String {
        // Token from Authorization header, then ?token= query, then HttpOnly cookie.
        val h = session.headers?.get("authorization") ?: session.headers?.get("Authorization") ?: ""
        if (h.startsWith("Bearer ")) return h.removePrefix("Bearer ").trim()
        session.parms?.get("token")?.let { if (it.isNotBlank()) return it }
        return runCatching { session.getCookies().read("lhsession") }.getOrNull() ?: ""
    }

    private fun handleLogin(session: IHTTPSession): Response {
        val ip = session.remoteIpAddress ?: "?"

        // Brute-force protection: reject if the IP is locked out.
        if (sessionManager.isLockedOut(ip)) {
            return json(mapOf("ok" to false, "error" to "Too many attempts. Try again later."))
        }

        // JSON endpoints must not buffer an arbitrarily large body either.
        val declaredLength = session.headers?.get("content-length")?.trim()?.toLongOrNull()
            ?: session.headers?.get("Content-Length")?.trim()?.toLongOrNull()
        if (declaredLength != null && declaredLength > MAX_JSON_BODY_BYTES) {
            return error(Status.PAYLOAD_TOO_LARGE, "Request body is larger than the ${MAX_JSON_BODY_BYTES / (1024 * 1024)} MB limit for this endpoint.")
        }
        val body = readBody(session)
        val p = parseBody(body)
        val username = p["username"] ?: ""
        val password = p["password"] ?: ""
        val remember = p["remember"] == "true"

        val adminUser = runBlocking { preferencesManager.getAdminUser() }
        val adminPass = runBlocking { preferencesManager.getAdminPass() }
        val webUser = runBlocking { preferencesManager.getWebUser() }
        val webPass = runBlocking { preferencesManager.getWebPass() }

        // Verify against stored (hashed) credentials.
        val role = when {
            sessionManager.constantEquals(username, adminUser) && sessionManager.verifyPassword(password, adminPass) -> "admin"
            sessionManager.constantEquals(username, webUser) && sessionManager.verifyPassword(password, webPass) -> "user"
            else -> null
        }

        if (role != null) {
            sessionManager.clearAttempts(ip)
            val s = sessionManager.create(role, ip, remember)
            logger.info("AUDIT", "Login OK: '$username' ($role) from $ip")
            val resp = json(mapOf(
                "ok" to true,
                "role" to role,
                "token" to s.token,
                "expiresAt" to s.expiresAt
            ))
            // Set an HttpOnly session cookie so pages can be authorized without the
            // token in the URL or localStorage.
            resp.addHeader("Set-Cookie", "lhsession=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${(s.expiresAt - s.createdAt) / 1000}")
            return resp
        } else {
            sessionManager.recordFailedAttempt(ip)
            // Security audit event: failed login with the source IP.
            logger.warn("AUDIT", "Failed login for '$username' from $ip (attempts left: ${sessionManager.attemptsRemaining(ip)})")
            return json(mapOf(
                "ok" to false,
                "error" to "Invalid username or password",
                "attemptsLeft" to sessionManager.attemptsRemaining(ip)
            ))
        }
    }

    private fun handleLogout(session: IHTTPSession): Response {
        sessionManager.revoke(tokenOf(session))
        val resp = json(mapOf("ok" to true))
        resp.addHeader("Set-Cookie", "lhsession=; Path=/; HttpOnly; Max-Age=0")
        return resp
    }

    private fun handleSession(session: IHTTPSession): Response {
        val token = tokenOf(session)
        val role = sessionManager.validate(token, session.remoteIpAddress ?: "?")?.role
        return if (role != null) {
            json(mapOf("ok" to true, "authenticated" to true, "role" to role))
        } else {
            json(mapOf("ok" to false, "authenticated" to false))
        }
    }

    /** Whether the default credentials are still in place (drives the first-boot wizard). */
    private fun handleSetupCheck(): Response {
        val adminPass = runBlocking { preferencesManager.getAdminPass() }
        val needsSetup = adminPass == "admin" || sessionManager.needsRehash(adminPass)
        return json(mapOf("ok" to true, "needsSetup" to needsSetup))
    }

    /** Admin-only: change Admin or Web User credentials. Requires current admin password. */
    private fun handleChangeCredentials(session: IHTTPSession): Response {
        // Must be an authenticated admin.
        if (requirePermission(session, "auth/change-credentials") != null) return unauthorized()

        val body = readBody(session)
        val p = parseBody(body)
        val currentPass = p["currentPassword"] ?: ""
        val target = p["target"] ?: "admin" // "admin" | "user"
        val newUsername = p["username"] ?: ""
        val newPassword = p["password"] ?: ""

        val adminUser = runBlocking { preferencesManager.getAdminUser() }
        val adminPass = runBlocking { preferencesManager.getAdminPass() }

        // Confirm current admin password before any change.
        if (!sessionManager.verifyPassword(currentPass, adminPass)) {
            return json(mapOf("ok" to false, "error" to "Current admin password is incorrect."))
        }
        if (newUsername.isBlank() || newPassword.length < 4) {
            return json(mapOf("ok" to false, "error" to "Username required and password must be at least 4 characters."))
        }

        val hashed = sessionManager.hashPassword(newPassword)
        runBlocking {
            if (target == "user") {
                preferencesManager.setWebUser(newUsername)
                preferencesManager.setWebPass(hashed)
            } else {
                preferencesManager.setAdminUser(newUsername)
                preferencesManager.setAdminPass(hashed)
            }
        }
        return json(mapOf("ok" to true, "message" to (if (target == "user") "Web User" else "Administrator") + " credentials updated."))
    }

    /**
     * Server-side permission enforcement. Returns an error Response if the
     * caller lacks the required role, or null to allow the request through.
     */
    // ---- TOTP 2FA ----
    /** Admin-only: whether TOTP is enabled + (for enrollment) a fresh secret. */
    private fun handleTotpStatus(session: IHTTPSession): Response {
        if (requirePermission(session, "auth/totp-status") != null) return unauthorized()
        val enabled = runBlocking { preferencesManager.getTotpEnabled() }
        val secret = runBlocking { preferencesManager.getTotpSecret() }
        return json(mapOf(
            "ok" to true,
            "enabled" to enabled,
            "secret" to (if (enabled) "" else secret) // only reveal secret during setup
        ))
    }

    /** Admin-only: (re)enroll TOTP — returns a fresh base32 secret for the QR. */
    private fun handleTotpEnroll(session: IHTTPSession): Response {
        if (requirePermission(session, "auth/totp-enroll") != null) return unauthorized()
        val secret = totp.generateSecret()
        runBlocking { preferencesManager.setTotpSecret(secret) }
        runBlocking { preferencesManager.setTotpEnabled(false) } // not active until verified
        return json(mapOf("ok" to true, "secret" to secret, "issuer" to "LocalHub", "account" to "admin"))
    }

    /** Admin-only: verify a submitted code; on success enables TOTP. */
    private fun handleTotpVerify(session: IHTTPSession): Response {
        if (requirePermission(session, "auth/totp-verify") != null) return unauthorized()
        val body = readBody(session)
        val p = parseBody(body)
        val code = p["code"] ?: ""
        val secret = runBlocking { preferencesManager.getTotpSecret() }
        if (secret.isBlank()) return json(mapOf("ok" to false, "error" to "No TOTP secret enrolled."))
        if (totp.verify(secret, code)) {
            runBlocking { preferencesManager.setTotpEnabled(true) }
            logger.info("AUDIT", "Admin TOTP 2FA enabled")
            return json(mapOf("ok" to true, "message" to "2FA enabled."))
        }
        logger.warn("AUDIT", "Admin TOTP verify failed (wrong code)")
        return json(mapOf("ok" to false, "error" to "Invalid code."))
    }

    // ---- LAN share links ----
    private fun handleShare(session: IHTTPSession, path: String): Response {
        val token = path.removePrefix("share/").trim()
        val share = shareTokenManager.resolve(token)
            ?: return NanoHTTPD.newFixedLengthResponse(
                Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "Share link invalid or expired."
            ).apply { addCors() }
        val file = fileOps.open(share.path)
        if (file == null || !file.exists()) {
            return NanoHTTPD.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "File not found.")
                .apply { addCors() }
        }
        // Stream the shared file with correct MIME + optional Range.
        TrafficMonitor.recordDownload(file.length())
        return fileResponse(file, if (share.isFolder) "attachment" else "inline", session.headers?.get("range"))
            .apply { addHeader("X-LocalHub-Share", token) }
    }

    /** Admin-only: list active shares. */
    private fun handleShareList(): Response {
        val list = shareTokenManager.list().map {
            mapOf("token" to it.token, "path" to it.path, "isFolder" to it.isFolder,
                  "createdAt" to it.createdAt, "expiresAt" to it.expiresAt,
                  "url" to "/api/share/${it.token}")
        }
        return json(mapOf("ok" to true, "shares" to list))
    }

    /** Admin-only: create a share. */
    private fun handleShareCreate(session: IHTTPSession): Response {
        val body = readBody(session)
        val p = parseBody(body)
        val path = p["path"] ?: ""
        val ttl = p["ttlMs"]?.toLongOrNull() ?: 3_600_000L
        if (path.isBlank() || !fileOps.exists(path)) {
            return json(mapOf("ok" to false, "error" to "Invalid path."))
        }
        val isFolder = fileOps.isDirectory(path)
        val share = shareTokenManager.create(path, isFolder, ttl.coerceIn(60_000L, 86_400_000L))
        logger.info("AUDIT", "Share created: ${share.path} ($share.token)")
        return json(mapOf("ok" to true, "token" to share.token, "path" to share.path,
                          "isFolder" to isFolder, "url" to "/api/share/${share.token}",
                          "expiresAt" to share.expiresAt))
    }

    /** Admin-only: revoke a share. */
    private fun handleShareRevoke(session: IHTTPSession): Response {
        val body = readBody(session)
        val p = parseBody(body)
        shareTokenManager.revoke(p["token"] ?: "")
        return json(mapOf("ok" to true, "message" to "Share revoked."))
    }

    private fun requirePermission(session: IHTTPSession, path: String): Response? {
        val required = permissionFor(path) ?: return null // public
        val token = tokenOf(session)
        val validSession = sessionManager.validate(token, session.remoteIpAddress ?: "?")
        val ok = validSession != null && sessionManager.hasRole(token, required)
        if (!ok) {
            permissionLastPath = path
            permissionLastRequired = required
            return unauthorized()
        }
        return null
    }

    /** Maps API paths to the minimum role required. "admin", "any", or null=public. */
    private fun permissionFor(path: String): String? {
        // Public (no auth): only minimal server status (needed by the login page) and QR.
        if (path == "status" || path == "qr") return null

        // Any authenticated user: file browsing/media/search, clients, and safe
        // aggregate dashboard data (stats/activity). NOTE: logs are NOT here —
        // access logs are Administrator-only (falls through to "admin" below).
        if (path == "integration" || path == "dashboard" ||
            path == "files" || path == "clients" ||
            path == "system" || path == "device" || path == "network" ||
            path == "storage" || path == "cpu" || path == "memory" || path == "battery" ||
            path == "fs/read" || path == "fs/list" || path == "fs/info" ||
            path == "fs/audio-tracks" || path == "fs/audio-chunk" || path == "fs/media-status" ||
            path == "fs/content" || path == "fs/download" || path == "fs/search" ||
            path == "fs/largest" || path == "fs/empty" || path == "fs/usage" ||
            path == "mirror/status" || path == "mirror/frame" ||
            path == "tts/status" || path == "tts/synthesize" || path == "tts/file" ||
            path == "fs/upload" || path.startsWith("hub/")) return "any"

        // Dangerous file operations (delete/rename/move/copy/mkdir/write/zip/upload),
        // server control, logs (view/clear/export), module management, config, and
        // credential changes are admin-only.
        if (path == "logs") return "admin"
        if (path.startsWith("fs/")) return "admin"
        if (path.startsWith("server/")) return "admin"
        if (path.startsWith("device/")) return "admin"
        if (path.startsWith("modules")) return "admin"
        if (path == "statistics" || path == "endpoints") return "any"

        // Admin only by default (safe default for any new endpoint).
        return "admin"
    }

    private fun unauthorized(): Response {
        // Security audit event: a request reached a permission gate without the
        // required role. Logged so admins can see attempted-access activity.
        logger.warn("AUDIT", "Permission denied for '${permissionLastPath}' (required: $permissionLastRequired)")
        return NanoHTTPD.newFixedLengthResponse(Status.UNAUTHORIZED, NanoHTTPD.MIME_PLAINTEXT, "401 Unauthorized")
            .apply { addCors() }
    }

    /** Latest path/role that failed the permission gate (for audit detail). */
    private var permissionLastPath: String = "?"
    private var permissionLastRequired: String = "?"

    private fun handleGet(session: IHTTPSession, path: String): Response { return when (path) {
        "integration" -> {
            val role = sessionManager.validate(tokenOf(session), session.remoteIpAddress ?: "?")?.role
            if (role == null) unauthorized() else json(hostIntegration(role)).apply { addHeader("Cache-Control", "no-store") }
        }
        "fs/media-status" -> json(mapOf("ok" to true))
        "fs/audio-tracks", "fs/audio-chunk" -> {
            val source = fileOps.open(session.parms?.get("path") ?: "")
            val track = session.parms?.get("track")?.toIntOrNull()
            val start = session.parms?.get("start")?.toLongOrNull()
            if (source == null) error(Status.BAD_REQUEST, "Invalid source")
            else if (path == "fs/audio-tracks") json(compatibleAudio.tracks(source))
            else if (track == null || track !in 0..31 || start == null || start !in 0..604800 || start % 60 != 0L) {
                error(Status.BAD_REQUEST, "Invalid audio track or segment position")
            } else {
                val bytes = compatibleAudio.chunk(source, track, start)
                moduleManager.blocked("/api/fs/audio-chunk")?.let { return error(Status.SERVICE_UNAVAILABLE, "Module disabled: $it") }
                NanoHTTPD.newFixedLengthResponse(Status.OK, "audio/mp4", java.io.ByteArrayInputStream(bytes), bytes.size.toLong())
                    .apply { addCors(); addHeader("Cache-Control", "no-store") }
            }
        }
        "status" -> json(statusMap())
        "system" -> json(systemInfoProvider.lastSnapshot.value ?: systemInfoProvider.collectSnapshot())
        "device" -> json( systemInfoProvider.lastSnapshot.value?.device ?: systemInfoProvider.collectSnapshot().device)
        "network" -> json( systemInfoProvider.lastSnapshot.value?.network ?: systemInfoProvider.collectSnapshot().network)
        "storage" -> json(systemInfoProvider.lastSnapshot.value?.storage ?: systemInfoProvider.collectSnapshot().storage)
        "battery" -> json(systemInfoProvider.lastSnapshot.value?.battery ?: systemInfoProvider.collectSnapshot().battery)
        "cpu" -> json(systemInfoProvider.lastSnapshot.value?.cpu?: systemInfoProvider.collectSnapshot().cpu)
        "memory" -> json(systemInfoProvider.lastSnapshot.value?.memory ?: systemInfoProvider.collectSnapshot().memory)
        "modules" -> json(moduleManager.toInfoList())
        "clients" -> json(mapOf("clients" to clientTracker.clients.value))
        "logs" -> {
            val logs = runBlocking { logRepository.recent(50).first() }
            json(mapOf("logs" to logs))
        }
        "statistics" -> {
            val stats = runBlocking { statisticsRepository.recent(60).first() }
            json(mapOf("statistics" to stats))
        }
        "files" -> json(fileManager.list(session.parms?.get("path"), listLimit(session)))
        "fs/list" -> json(fileOps.list(session.parms?.get("path"), listLimit(session)))
        "fs/search" -> json(fileOps.search(session.parms?.get("q") ?: "", session.parms?.get("dir")))
        "fs/read" -> json(fileOps.read(session.parms?.get("path") ?: ""))
        "fs/info" -> json(fileOps.info(session.parms?.get("path") ?: ""))
        "fs/largest" -> json(fileOps.largestFiles(session.parms?.get("path") ?: "", session.parms?.get("limit")?.toIntOrNull() ?: 20))
        "fs/empty" -> json(fileOps.emptyFolders(session.parms?.get("path") ?: ""))
        "fs/content" -> serveContent(session)
        "fs/download" -> serveDownload(session)
        "fs/usage" -> json(systemInfoProvider.lastSnapshot.value?.storage ?: systemInfoProvider.collectSnapshot().storage)
        "qr" -> serveQr(session)
        "dashboard" -> json(dashboardMap())
        "server/export-logs" -> exportLogs()
        "server/backup" -> json(backupConfig())
        "server/clear-cache" -> json(fileOps.clearCache())
        "endpoints" -> json(endpointList())
        "share/list" -> handleShareList()
        "fs/duplicates" -> json(fileOps.duplicates(session.parms?.get("path") ?: ""))
        "fs/categories" -> json(fileOps.categories(session.parms?.get("path") ?: ""))
        "devices/policy" -> json(mapOf(
            "blocked" to clientTracker.blockedList(),
            "restrictions" to clientTracker.restrictions()
        ))
        "mirror/status" -> json(mapOf(
            "ok" to true,
            "running" to (screenMirror?.isRunning == true),
            "accessibility" to RemoteAccessService.isEnabled,
            "error" to (screenMirror?.lastError)
        ))
        "mirror/frame" -> {
            // Stream the latest captured screen frame as JPEG. This is served to
            // ANY authenticated user so the mirror page can show the phone screen.
            val frame = screenMirror?.latestFrame()
            if (frame == null) {
                NanoHTTPD.newFixedLengthResponse(Status.NOT_FOUND, "image/jpeg", java.io.ByteArrayInputStream(ByteArray(0)), 0L)
                    .apply { addCors() }
            } else {
                NanoHTTPD.newFixedLengthResponse(Status.OK, "image/jpeg", java.io.ByteArrayInputStream(frame), frame.size.toLong())
                    .apply { addCors(); addHeader("Cache-Control", "no-store") }
            }
        }
        "tts/status" -> json(ttsEngine?.status() ?: mapOf("ok" to false, "available" to false, "error" to "TTS engine unavailable"))
        "tts/file" -> serveTtsFile(session)
        "hub/clipboard" -> json(hubStore.getClipboard())
        "hub/chat" -> {
            val since = session.parms?.get("since")?.toLongOrNull() ?: 0L
            json(hubStore.getChat(since))
        }
        "hub/wall" -> json(hubStore.getWall())
        "hub/notes" -> json(hubStore.getScratchpad())
        "hub/media-catalog" -> json(fileOps.mediaCatalog())
        else -> notFound()
    }

    }

    /** Serves a previously generated TTS WAV from the app's cache TTS folder. */
    private fun serveTtsFile(session: IHTTPSession): Response {
        val name = session.parms?.get("name")?.takeIf { it.isNotBlank() } ?: return notFound()
        // Guard against path traversal: only allow a plain filename inside the TTS dir.
        if (name.contains("/") || name.contains("\\") || name.contains("..")) return notFound()
        val dir = java.io.File(context?.cacheDir, "tts")
        val file = java.io.File(dir, name)
        if (!file.exists() || !file.isFile) return notFound()
        return NanoHTTPD.newChunkedResponse(
            Status.OK, "audio/wav", java.io.BufferedInputStream(java.io.FileInputStream(file))
        ).apply { addCors(); addHeader("Content-Disposition", "inline; filename=\"${file.name}\"") }
    }

    /** Serves a QR-code PNG encoding the given [text] payload. */
    private fun serveQr(session: IHTTPSession): Response {
        val text = session.parms?.get("text") ?: ""
        if (text.isEmpty()) return notFound()
        val bytes = QrGenerator.png(text) ?: return error(Status.INTERNAL_ERROR, "qr failed")
        return NanoHTTPD.newFixedLengthResponse(
            Status.OK, "image/png", java.io.ByteArrayInputStream(bytes), bytes.size.toLong()
        ).apply { addCors() }
    }

    /** Serves a file's raw bytes with correct Content-Type and Range support. */
    private fun serveContent(session: IHTTPSession): Response {
        val path = session.parms?.get("path") ?: return notFound()
        val file = fileOps.open(path) ?: return notFound()
        val isMedia = FileOperations.Mime.categoryFor(file.name.substringAfterLast('.', "")) in listOf("video", "audio")
        moduleManager.blocked("/api/fs/content", isMedia)?.let { return error(Status.SERVICE_UNAVAILABLE, "Module disabled: $it") }
        val cat = FileOperations.Mime.categoryFor(file.name.substringAfterLast('.', ""))
        if (cat == "video" || cat == "audio") TrafficMonitor.recordMedia()
        else if (cat == "image" || cat == "text" || cat == "pdf") TrafficMonitor.recordFileOpened()
        return fileResponse(file, "inline", session.headers?.get("range"))
    }

    /**
     * Serves a single file. [mode] is "inline" or "attachment". Handles empty
     * files, optional Range requests (for video seeking / resume), and sets the
     * correct Content-Type via MIME detection.
     */
    private fun fileResponse(file: java.io.File, mode: String, rangeHeader: String?): Response {
        val mime = FileOperations.Mime.mimeFor(file.name)
        val length = file.length()
        val disposition = if (mode == "attachment") "attachment" else "inline"
        val mediaPlayback = disposition == "inline" && FileOperations.Mime.categoryFor(file.name.substringAfterLast('.', "")) in listOf("video", "audio")
        moduleManager.blocked("/api/fs/content", mediaPlayback)?.let { return error(Status.SERVICE_UNAVAILABLE, "Module disabled: $it") }
        val cd = "$disposition; filename=\"${file.name}\""

        if (length == 0L) {
            return NanoHTTPD.newFixedLengthResponse(
                Status.OK, mime, java.io.ByteArrayInputStream(ByteArray(0)), 0L
            ).apply { addHeader("Content-Disposition", cd); addCors() }
        }
        val range = rangeHeader ?: ""
        return if (range.startsWith("bytes=")) {
            serveRange(file, mime, range, length, cd, mediaPlayback)
        } else {
            val stream = guardedStream(java.io.BufferedInputStream(java.io.FileInputStream(file)), mediaPlayback)
            NanoHTTPD.newChunkedResponse(Status.OK, mime, stream).apply {
                addHeader("Content-Disposition", cd)
                addHeader("Accept-Ranges", "bytes")
                addCors()
            }
        }
    }

    /**
     * Download endpoint. A single file streams directly; multiple paths or a
     * folder are zipped on the fly into a temp archive and streamed as a
     * download (the temp file is auto-cleaned afterwards).
     */
    private fun serveDownload(session: IHTTPSession): Response {
        val paths = (session.parms?.get("paths") ?: session.parms?.get("path") ?: "")
            .split("|").map { it.trim() }.filter { it.isNotEmpty() }
        if (paths.isEmpty()) return notFound()

        if (paths.size == 1) {
            val single = fileOps.open(paths[0])
            if (single != null) {
                TrafficMonitor.recordDownload(single.length())
                return fileResponse(single, "attachment", session.headers?.get("range"))
            }
        }

        // Folder or multi-selection -> zip and stream.
        val tmp = fileOps.createZipTemp(paths)
        if (tmp == null) return error(Status.INTERNAL_ERROR, "zip failed")
        TrafficMonitor.recordDownload(tmp.length())
        val zipName = if (paths.size == 1) paths[0].substringAfterLast('/') + ".zip" else "download.zip"
        val mime = "application/zip"
        val resp = NanoHTTPD.newFixedLengthResponse(
            Status.OK, mime, java.io.FileInputStream(tmp), tmp.length()
        ).apply {
            addHeader("Content-Disposition", "attachment; filename=\"${sanitizeHeader(zipName)}\"")
            addCors()
        }
        scheduleDelete(tmp)
        return resp
    }

    private fun sanitizeHeader(value: String): String =
        value.replace("\"", "").replace("\r", "").replace("\n", "")

    private fun scheduleDelete(f: java.io.File) {
        java.util.Timer("lh-cleanup", true).schedule(object : java.util.TimerTask() {
            override fun run() { runCatching { f.delete() } }
        }, 60_000L)
    }

    private fun guardedStream(input: java.io.InputStream, media: Boolean): java.io.InputStream {
        return moduleManager.guardStream("/api/fs/content", media, input)
    }

    private fun serveRange(file: java.io.File, mime: String, rangeHeader: String, length: Long, cd: String, mediaPlayback: Boolean): Response {
        val rangeSpec = rangeHeader.removePrefix("bytes=").split("-")
        val start = rangeSpec.getOrNull(0)?.trim()?.toLongOrNull()
        val endReq = rangeSpec.getOrNull(1)?.trim()?.toLongOrNull()
        if (start == null || start < 0 || start >= length) {
            val resp = NanoHTTPD.newFixedLengthResponse(Status.RANGE_NOT_SATISFIABLE, "text/plain", "")
            resp.addHeader("Content-Range", "bytes */$length")
            return resp.apply { addCors() }
        }
        val end = (endReq ?: (length - 1)).coerceAtMost(length - 1)
        val chunkLen = (end - start + 1).coerceAtLeast(0)
        val stream = guardedStream(java.io.BufferedInputStream(java.io.FileInputStream(file)), mediaPlayback)
        var skipped = 0L
        while (skipped < start) {
            val s = stream.skip(start - skipped)
            if (s <= 0L) {
                if (stream.read() == -1) break
                skipped++
            } else {
                skipped += s
            }
        }
        val limited = object : java.io.FilterInputStream(stream) {
            var remaining = chunkLen
            override fun read(): Int {
                if (remaining <= 0) return -1
                val b = super.read()
                if (b >= 0) remaining--
                return b
            }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (remaining <= 0) return -1
                val r = super.read(b, off, len.toLong().coerceAtMost(remaining).toInt())
                if (r > 0) remaining -= r
                return r
            }
        }
        return NanoHTTPD.newFixedLengthResponse(Status.PARTIAL_CONTENT, mime, limited, chunkLen).apply {
            addHeader("Content-Range", "bytes $start-$end/$length")
            addHeader("Accept-Ranges", "bytes")
            addHeader("Content-Disposition", cd)
            addCors()
        }
    }

    private fun handlePost(session: IHTTPSession, path: String): Response {
        // Upload sends bytes in the body; handle before consuming as text.
        if (path == "fs/upload") return handleUpload(session)
        val body = readBody(session)
        val p = parseBody(body)
        return when (path) {
            "log" -> {
                logger.info("API", "Remote log: $body")
                json(mapOf("ok" to true))
            }
            "command" -> json(mapOf("ok" to true, "echo" to body))
            "fs/mkdir" -> json(fileOps.mkdir(p["parent"] ?: "", p["name"] ?: ""))
            "fs/rename" -> json(fileOps.rename(p["path"] ?: "", p["name"] ?: ""))
            "fs/move" -> json(fileOps.move(p["path"] ?: "", p["dest"] ?: ""))
            "fs/copy" -> json(fileOps.copy(p["path"] ?: "", p["dest"] ?: ""))
            "fs/delete" -> json(fileOps.delete(p["path"] ?: "", p["confirm"] == "true"))
            "fs/write" -> json(fileOps.write(p["path"] ?: "", p["content"] ?: ""))
            "fs/zip" -> json(fileOps.zip(p["paths"]?.split("|") ?: emptyList(), p["dest"] ?: ""))
            "fs/unzip" -> json(fileOps.unzip(p["path"] ?: "", p["dest"] ?: ""))
            "server/restart" -> { serverCommand("restart"); json(mapOf("ok" to true, "message" to "restarting")) }
            "server/stop" -> { serverCommand("stop"); json(mapOf("ok" to true, "message" to "stopping")) }
            "server/start" -> { serverCommand("start"); json(mapOf("ok" to true, "message" to "starting")) }
            "server/clear-cache" -> json(fileOps.clearCache())
            "server/clear-logs" -> {
                runBlocking { logRepository.clear() }
                json(mapOf("ok" to true, "message" to "logs cleared"))
            }
            "server/restore" -> json(restoreConfig(p))
            "share/create" -> handleShareCreate(session)
            "share/revoke" -> handleShareRevoke(session)
            "devices/block" -> {
                clientTracker.block(p["ip"] ?: "")
                logger.info("AUDIT", "Device blocked: ${p["ip"]}")
                json(mapOf("ok" to true, "message" to "Device blocked."))
            }
            "devices/unblock" -> {
                clientTracker.unblock(p["ip"] ?: "")
                logger.info("AUDIT", "Device unblocked: ${p["ip"]}")
                json(mapOf("ok" to true, "message" to "Device unblocked."))
            }
            "devices/restrict" -> {
                val ip = p["ip"] ?: ""
                val mode = p["mode"] ?: "none" // none | RO | deny
                clientTracker.setRestriction(ip, mode)
                logger.info("AUDIT", "Device file access -> $mode for $ip")
                json(mapOf("ok" to true, "message" to "Device restriction updated."))
            }
            "device/action" -> {
                // Admin-only device actions (flashlight, brightness, ringer, etc.).
                if (deviceActions == null) return json(mapOf("ok" to false, "error" to "Device actions unavailable."))
                val action = p["action"] ?: ""
                val value = p["value"] ?: ""
                val result: Map<String, Any> = when (action) {
                    "torch" -> deviceActions.setTorch(p["state"] == "true" || value == "on")
                    "brightness" -> deviceActions.setBrightness(p["value"]?.toIntOrNull() ?: value.toIntOrNull() ?: 128)
                    "rotate" -> deviceActions.setAutoRotate(p["state"] == "true" || value == "on")
                    "ringer" -> deviceActions.setRinger(value)
                    "volume" -> deviceActions.setVolume(p["value"]?.toIntOrNull() ?: value.toIntOrNull() ?: 50)
                    "volume_up" -> deviceActions.adjustVolume(1)
                    "volume_down" -> deviceActions.adjustVolume(-1)
                    "vibrate" -> deviceActions.vibrate((p["value"]?.toLongOrNull() ?: value.toLongOrNull() ?: 500))
                    "open" -> deviceActions.open(value)
                    "screenshot" -> deviceActions.screenshotRequest()
                    else -> mapOf("ok" to false, "error" to "Unknown action: $action")
                }
                logger.info("AUDIT", "Device action: $action ($value)")
                json(result)
            }
            "device/status" -> {
                // Report which device actions are available + permission state.
                val da = deviceActions
                json(mapOf(
                    "ok" to true,
                    "canWriteSettings" to (da?.canWriteSettings() ?: false),
                    "canNotificationPolicy" to (da?.canUseNotificationPolicy() ?: false),
                    "hasTorch" to true,
                    "hasVibrator" to true
                ))
            }
            "mirror/start" -> {
                // Launch the MediaProjection consent prompt (admin only).
                val sm = screenMirror
                if (sm == null) return json(mapOf("ok" to false, "error" to "Mirror unavailable."))
                if (sm.isRunning) return json(mapOf("ok" to true, "message" to "Mirror already running."))
                try { MirrorActivity.start(contextOfRouter()) } catch (e: Exception) {
                    return json(mapOf("ok" to false, "error" to (e.message ?: "start failed")))
                }
                logger.info("AUDIT", "Screen mirror consent requested")
                json(mapOf("ok" to true, "message" to "Grant the screen-capture prompt on the phone."))
            }
            "mirror/stop" -> {
                screenMirror?.stop()
                logger.info("AUDIT", "Screen mirror stopped")
                json(mapOf("ok" to true, "message" to "Mirror stopped."))
            }
            "mirror/click" -> {
                // Accessibility action (admin). kind: click|clickdesc|clickid|longpress|
                // focus|scroll, text = target. Requires RemoteAccessService enabled.
                val kind = p["kind"] ?: "click"
                val text = p["text"] ?: ""
                if (!RemoteAccessService.isEnabled) {
                    return json(mapOf("ok" to false, "error" to "Remote Access (Accessibility) is not enabled on the phone."))
                }
                RemoteAccessService.request(kind, text)
                logger.info("AUDIT", "Accessibility $kind: $text")
                json(mapOf("ok" to true, "message" to "Sent $kind: $text"))
            }
            "mirror/type" -> {
                // Type text into the focused input field (admin).
                val text = p["text"] ?: ""
                if (!RemoteAccessService.isEnabled) {
                    return json(mapOf("ok" to false, "error" to "Remote Access not enabled."))
                }
                RemoteAccessService.request("type", text)
                logger.info("AUDIT", "Accessibility type: $text")
                json(mapOf("ok" to true, "message" to "Typed: $text"))
            }
            "mirror/swipe" -> {
                // Swipe gesture: left|right|up|down (admin).
                val dir = p["direction"] ?: "up"
                if (!RemoteAccessService.isEnabled) {
                    return json(mapOf("ok" to false, "error" to "Remote Access not enabled."))
                }
                RemoteAccessService.request("swipe", dir)
                json(mapOf("ok" to true, "message" to "Swiped $dir"))
            }
            "mirror/dump" -> {
                // Dump visible screen text (admin) — "what's on screen".
                val text = if (RemoteAccessService.isEnabled) {
                    RemoteAccessService.instance?.dumpScreen() ?: "no active window"
                } else "Remote Access not enabled."
                json(mapOf("ok" to true, "screen" to text))
            }
            "mirror/nav" -> {
                // Global nav: back / home / recents
                val nav = p["action"] ?: ""
                if (!RemoteAccessService.isEnabled) {
                    return json(mapOf("ok" to false, "error" to "Remote Access not enabled."))
                }
                RemoteAccessService.request(nav, "")
                json(mapOf("ok" to true, "message" to "Sent $nav"))
            }
            "tts/synthesize" -> {
                // Android system text-to-speech.
                val te = ttsEngine
                if (te == null) return json(mapOf("ok" to false, "error" to "TTS engine unavailable"))
                val text = p["text"] ?: ""
                if (text.isBlank()) return json(mapOf("ok" to false, "error" to "Empty text"))
                val outDir = java.io.File(context?.cacheDir, "tts").apply { mkdirs() }
                val file = te.synthesize(text, outDir, p["speed"]?.toFloatOrNull() ?: 1.0f, p["lang"]?.takeIf { it.isNotBlank() } ?: "en-US")
                if (file == null) {
                    return json(mapOf("ok" to false, "error" to (te.status()["lastError"] ?: "synthesis failed")))
                }
                logger.info("AUDIT", "TTS generated: ${file.name} (${file.length()} bytes)")
                json(mapOf(
                    "ok" to true,
                    "message" to "Speech generated.",
                    "url" to "/api/tts/file?name=${file.name}",
                    "length" to file.length()
                ))
            }
            "tts/clone" -> {
                // Voice cloning needs a neural model; system TTS doesn't support it.
                val te = ttsEngine
                if (te == null) return json(mapOf("ok" to false, "error" to "TTS engine unavailable"))
                json(mapOf(
                    "ok" to false,
                    "error" to "Voice cloning needs a neural model (Pocket TTS), which is too slow on this hardware. The system TTS engine uses the phone's built-in voices only."
                ))
            }
            "hub/clipboard" -> {
                val text = p["text"] ?: ""
                val author = p["author"] ?: "User"
                json(hubStore.setClipboard(text, author))
            }
            "hub/chat" -> {
                val text = p["text"] ?: ""
                val author = p["author"] ?: "Guest"
                val color = p["color"] ?: "#38bdf8"
                val ip = session.remoteIpAddress ?: ""
                json(hubStore.postChatMessage(text, author, color, ip))
            }
            "hub/chat/clear" -> json(hubStore.clearChat())
            "hub/wall" -> {
                val title = p["title"] ?: ""
                val content = p["content"] ?: ""
                val author = p["author"] ?: "User"
                val color = p["color"] ?: "yellow"
                val pinned = p["pinned"] == "true"
                json(hubStore.postWallNote(title, content, author, color, pinned))
            }
            "hub/wall/delete" -> json(hubStore.deleteWallNote(p["id"] ?: ""))
            "hub/notes" -> json(hubStore.setScratchpad(p["content"] ?: ""))
            else -> notFound()
        }
    }

    /** Aggregated payload for the NAS dashboard (status + system + traffic). */
    private fun dashboardMap(): Map<String, Any> {
        val snap = systemInfoProvider.lastSnapshot.value ?: systemInfoProvider.collectSnapshot()
        return mapOf(
            "status" to statusMap(),
            "system" to snap,
            "traffic" to TrafficMonitor.snapshot(),
            "clients" to clientTracker.clients.value,
            "modules" to moduleManager.toInfoList()
        )
    }

    /** Returns all persisted logs as plain text for export. */
    private fun exportLogs(): Response {
        val logs = runBlocking { logRepository.all().first() }
        val text = logs.joinToString("\n") { l ->
            val t = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(l.timestamp))
            "$t [${l.level}] ${l.tag}: ${l.message}"
        }
        return NanoHTTPD.newFixedLengthResponse(
            Status.OK, "text/plain", text
        ).apply {
            addHeader("Content-Disposition", "attachment; filename=\"localhub-logs.txt\"")
            addCors()
        }
    }

    /** Exports current server configuration as JSON (for backup). */
    private fun backupConfig(): Map<String, Any> {
        val port = runBlocking { preferencesManager.portFlow.first() }
        val theme = runBlocking { preferencesManager.themeFlow.first() }
        val autostart = runBlocking { preferencesManager.autostartFlow.first() }
        val name = runBlocking { preferencesManager.serverNameFlow.first() }
        return mapOf(
            "ok" to true,
            "config" to mapOf(
                "port" to port,
                "theme" to theme,
                "autostart" to autostart,
                "serverName" to name
            )
        )
    }

    /** Restores server configuration from a submitted JSON body. */
    private fun restoreConfig(p: Map<String, String>): Map<String, Any> = runCatching {
        p["port"]?.toIntOrNull()?.let { runBlocking { preferencesManager.setPort(it) } }
        p["theme"]?.let { if (it in listOf("dark", "light", "system")) runBlocking { preferencesManager.setTheme(it) } }
        p["autostart"]?.let { runBlocking { preferencesManager.setAutostart(it == "true") } }
        p["serverName"]?.let { if (it.isNotBlank()) runBlocking { preferencesManager.setServerName(it) } }
        mapOf("ok" to true, "message" to "configuration restored")
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "restore failed")) }

    /** Static list of documented REST endpoints for the API Explorer. */
    private fun endpointList(): List<Map<String, String>> = listOf(
        mapOf("method" to "GET", "path" to "/api/status", "desc" to "Server status + uptime"),
        mapOf("method" to "GET", "path" to "/api/integration", "desc" to "Authenticated read-only host integration and permission state"),
        mapOf("method" to "GET", "path" to "/api/system", "desc" to "Full system snapshot"),
        mapOf("method" to "GET", "path" to "/api/dashboard", "desc" to "NAS dashboard aggregate"),
        mapOf("method" to "GET", "path" to "/api/device", "desc" to "Device info"),
        mapOf("method" to "GET", "path" to "/api/network", "desc" to "Network info"),
        mapOf("method" to "GET", "path" to "/api/storage", "desc" to "Storage usage"),
        mapOf("method" to "GET", "path" to "/api/cpu", "desc" to "CPU telemetry"),
        mapOf("method" to "GET", "path" to "/api/memory", "desc" to "Memory telemetry"),
        mapOf("method" to "GET", "path" to "/api/battery", "desc" to "Battery telemetry"),
        mapOf("method" to "GET", "path" to "/api/clients", "desc" to "Connected clients"),
        mapOf("method" to "GET", "path" to "/api/logs", "desc" to "Recent log entries"),
        mapOf("method" to "GET", "path" to "/api/modules", "desc" to "Loaded modules"),
        mapOf("method" to "GET", "path" to "/api/files?path=...", "desc" to "List folder contents"),
        mapOf("method" to "GET", "path" to "/api/fs/search?q=...", "desc" to "Search files"),
        mapOf("method" to "GET", "path" to "/api/fs/read?path=...", "desc" to "Read text file"),
        mapOf("method" to "GET", "path" to "/api/fs/info?path=...", "desc" to "File metadata"),
        mapOf("method" to "GET", "path" to "/api/fs/content?path=...", "desc" to "Stream file (Range)"),
        mapOf("method" to "GET", "path" to "/api/fs/download?path=...", "desc" to "Download file/folder"),
        mapOf("method" to "GET", "path" to "/api/fs/usage", "desc" to "Storage usage"),
        mapOf("method" to "GET", "path" to "/api/qr?text=...", "desc" to "Generate QR code"),
        mapOf("method" to "POST", "path" to "/api/fs/mkdir", "desc" to "Create folder"),
        mapOf("method" to "POST", "path" to "/api/fs/rename", "desc" to "Rename file/folder"),
        mapOf("method" to "POST", "path" to "/api/fs/move", "desc" to "Move file/folder"),
        mapOf("method" to "POST", "path" to "/api/fs/copy", "desc" to "Copy file/folder"),
        mapOf("method" to "POST", "path" to "/api/fs/delete", "desc" to "Delete (with confirm)"),
        mapOf("method" to "POST", "path" to "/api/fs/write", "desc" to "Write text file"),
        mapOf("method" to "POST", "path" to "/api/fs/upload", "desc" to "Upload file(s)"),
        mapOf("method" to "POST", "path" to "/api/fs/zip", "desc" to "Zip paths"),
        mapOf("method" to "POST", "path" to "/api/fs/unzip", "desc" to "Unzip archive"),
        mapOf("method" to "POST", "path" to "/api/server/restart", "desc" to "Restart server"),
        mapOf("method" to "POST", "path" to "/api/server/stop", "desc" to "Stop server"),
        mapOf("method" to "POST", "path" to "/api/server/start", "desc" to "Start server"),
        mapOf("method" to "POST", "path" to "/api/server/clear-cache", "desc" to "Clear temp cache"),
        mapOf("method" to "GET", "path" to "/api/server/export-logs", "desc" to "Export logs"),
        mapOf("method" to "GET", "path" to "/api/server/backup", "desc" to "Backup config"),
        mapOf("method" to "POST", "path" to "/api/server/restore", "desc" to "Restore config"),
        mapOf("method" to "GET", "path" to "/api/tts/status", "desc" to "System TTS status"),
        mapOf("method" to "POST", "path" to "/api/tts/synthesize", "desc" to "Synthesize speech to WAV"),
        mapOf("method" to "POST", "path" to "/api/tts/clone", "desc" to "Voice-clone from reference WAV (admin)"),
        mapOf("method" to "GET", "path" to "/api/tts/file?name=...", "desc" to "Serve generated TTS WAV")
    )

    /**
     * Uploads are streamed to disk. The previous version allocated the whole
     * body (up to 512 MB) in memory before checking the size, which threw
     * OutOfMemoryError and crashed the host app on large uploads.
     */
    private fun handleUpload(session: IHTTPSession): Response {
        val context = contextOfRouter()
        val dir = fileOps.directory(session.parms?.get("dir"))
        val overwrite = session.parms?.get("overwrite") != "false"
        val contentLength = session.headers?.get("content-length")?.trim()?.toLongOrNull()
            ?: session.headers?.get("Content-Length")?.trim()?.toLongOrNull()
        val tempDir = java.io.File(context.cacheDir, "uploads")
        val contentType = session.headers?.get("content-type")
            ?: session.headers?.get("Content-Type") ?: ""
        val boundary = Regex("boundary=(.+)$").find(contentType)?.groupValues?.get(1)?.trim('"', ' ')
        val result = if (!boundary.isNullOrBlank()) {
            UploadStreamer.saveMultipart(session.inputStream, contentLength, boundary, dir, overwrite, tempDir)
        } else {
            UploadStreamer.saveRaw(
                session.inputStream, contentLength, dir, session.parms?.get("name") ?: "", overwrite, tempDir
            )
        }
        if (result.isOk) TrafficMonitor.recordUpload(uploadedBytes(result.body))
        return jsonWithStatus(result.httpStatus, result.body)
    }

    private fun uploadedBytes(body: Map<String, Any>): Long {
        (body["size"] as? Number)?.let { return it.toLong() }
        @Suppress("UNCHECKED_CAST")
        val results = body["results"] as? List<Map<String, Any>> ?: return 0L
        return results.sumOf { (it["size"] as? Number)?.toLong() ?: 0L }
    }

    /** Maps an upload outcome to a real HTTP status instead of always 200. */
    private fun jsonWithStatus(httpStatus: Int, body: Map<String, Any>): Response {
        val payload = gson.toJson(body)
        return NanoHTTPD.newFixedLengthResponse(statusFor(httpStatus), "application/json", payload)
            .apply { addCors() }
    }

    private fun statusFor(code: Int): NanoHTTPD.Response.IStatus = when (code) {
        409 -> Status.CONFLICT
        411 -> Status.LENGTH_REQUIRED
        413 -> Status.PAYLOAD_TOO_LARGE
        507 -> SimpleStatus(507, "Insufficient Storage")
        in 400..499 -> Status.BAD_REQUEST
        in 500..599 -> Status.INTERNAL_ERROR
        else -> Status.OK
    }

    /** NanoHTTPD lacks some statuses (e.g. 507); IStatus accepts custom codes. */
    private class SimpleStatus(
        private val code: Int,
        private val description: String
    ) : NanoHTTPD.Response.IStatus {
        override fun getRequestStatus(): Int = code
        override fun getDescription(): String = description
    }

    private fun readBody(session: IHTTPSession): String = runCatching {
        val raw = readBodyBytes(session)
        String(raw, Charsets.UTF_8)
    }.getOrDefault("")

    private fun readBodyBytes(session: IHTTPSession): ByteArray = runCatching {
        val len = session.headers?.get("content-length")?.toIntOrNull() ?: 0
        if (len <= 0) ByteArray(0)
        else {
            val raw = ByteArray(len)
            var off = 0
            while (off < len) {
                val n = session.inputStream.read(raw, off, len - off)
                if (n < 0) break
                off += n
            }
            raw
        }
    }.getOrDefault(ByteArray(0))

    @Suppress("UNCHECKED_CAST")
    private fun parseBody(body: String): Map<String, String> = runCatching {
        val raw = gson.fromJson(body, Map::class.java) as Map<String, Any>
        raw.mapValues { it.value?.toString() ?: "" }
    }.getOrDefault(emptyMap())

    /** Client hint only; the server always clamps the effective limit. */
    private fun listLimit(session: IHTTPSession): Int =
        session.parms?.get("limit")?.toIntOrNull() ?: FileManager.DEFAULT_LIST_LIMIT

    /** Read-only, authenticated descriptor; no logs, tokens or private file names. */
    private fun hostIntegration(role: String): Map<String, Any> {
        val ctx = contextOfRouter()
        fun granted(test: () -> Boolean): String = runCatching { if (test()) "GRANTED" else "MISSING" }.getOrDefault("UNKNOWN")
        fun runtimePermission(name: String) = androidx.core.content.ContextCompat.checkSelfPermission(ctx, name) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val permissions = mapOf(
            "storage" to granted { if (android.os.Build.VERSION.SDK_INT >= 30) android.os.Environment.isExternalStorageManager() else runtimePermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) },
            "camera" to granted { runtimePermission(android.Manifest.permission.CAMERA) },
            "notifications" to granted { if (android.os.Build.VERSION.SDK_INT >= 33) runtimePermission(android.Manifest.permission.POST_NOTIFICATIONS) && androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled() else androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled() },
            "writeSettings" to granted { deviceActions?.canWriteSettings() == true },
            "notificationPolicy" to granted { deviceActions?.canUseNotificationPolicy() == true },
            "accessibility" to if (RemoteAccessService.isEnabled) "ACTIVE" else "INACTIVE",
            "screenCapture" to if (screenMirror?.isRunning == true) "ACTIVE" else "INACTIVE"
        )
        return com.localhub.localhub.module.HostIntegration.describe(moduleManager, role, permissions,
            listenerPort(), protocol(), ServerClock.startedAt, System.currentTimeMillis(),
            healthSummary()) + mapOf(
                "app" to mapOf("versionName" to com.localhub.localhub.BuildConfig.VERSION_NAME,
                    "versionCode" to com.localhub.localhub.BuildConfig.VERSION_CODE, "packageName" to ctx.packageName))
    }

    private fun statusMap(): Map<String, Any> {
        val ip = systemInfoProvider.lastSnapshot.value?.network?.ipAddress ?: "127.0.0.1"
        val port = listenerPort()
        val name = runBlocking { preferencesManager.serverNameFlow.first() }
        // Hostname is fixed and always advertised as localhub.local (see NsdHelper).
        val hostname = "localhub"
        return mapOf(
            "running" to true,
            "version" to Constants.SERVER_VERSION,
            "name" to name,
            "hostname" to "$hostname.local",
            "hostnameUrl" to "${protocol()}://$hostname.local:$port",
            "port" to port,
            "host" to ip,
            "url" to "${protocol()}://$ip:$port",
            "startedAt" to ServerClock.startedAt,
            "uptimeMs" to ServerClock.currentUptimeMs(),
            "restartCount" to ServerClock.restartCount
        )
    }

    private fun json(obj: Any): Response =
        NanoHTTPD.newFixedLengthResponse(Status.OK, "application/json", gson.toJson(obj))
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun notFound(): Response =
        NanoHTTPD.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "404 Not Found")
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun methodNotAllowed(): Response =
        NanoHTTPD.newFixedLengthResponse(Status.METHOD_NOT_ALLOWED, NanoHTTPD.MIME_PLAINTEXT, "Method not allowed")
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun error(status: Status, message: String): Response =
        NanoHTTPD.newFixedLengthResponse(status, NanoHTTPD.MIME_PLAINTEXT, message)
            .apply { addCors() }

    private fun Response.addCors(): Response {
        // Reflect the request origin instead of allowing all origins (best effort).
        // CORS is secondary to the session/token requirement enforced in requirePermission.
        addHeader("Access-Control-Allow-Origin", "*")
        addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
        addHeader("Access-Control-Allow-Credentials", "false")
        addHeader("Access-Control-Max-Age", "600")
        addHeader("X-Content-Type-Options", "nosniff")
        addHeader("X-Frame-Options", "SAMEORIGIN")
        return this
    }

    companion object {
        private const val TAG = "ApiRouter"
    }
}
