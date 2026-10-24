package com.localhub.localhub.module

/** Single route ownership policy. Independent of Android so it can be tested on JVM.
 * Core security/server and browser-only assistant subfeatures are NOT fake toggles.
 */
object ModulePolicy {
    val controllable = setOf("dashboard", "files", "ai", "core.media", "core.mirror",
        "core.device", "core.shares", "core.monitor", "core.tts", "core.os")

    fun requirements(rawPath: String, audioVideoContent: Boolean = false): Set<String> {
        val parts = java.util.ArrayDeque<String>()
        rawPath.substringBefore('?').replace('\\', '/').split('/').forEach { part ->
            when (part) { "", "." -> Unit; ".." -> if (parts.isNotEmpty()) parts.removeLast(); else -> parts.addLast(part) }
        }
        var path = "/" + parts.joinToString("/")
        path = path.removePrefix("/assets")
        if (path.startsWith("/dashboard/")) path = "/" + path.removePrefix("/dashboard/")
        if (path == "/api") path = "/api/"
        val required = linkedSetOf<String>()
        when {
            path == "/" || path == "/index.html" || path == "/app.js" || path == "/visuals.js" -> required.add("dashboard")
            path == "/files" || path == "/files.html" || path.startsWith("/files/") -> required.add("files")
            path == "/player" || path == "/player.html" || path == "/player-cinema.css" || path == "/compatible-audio.js" || path == "/module-access.js" -> required.addAll(listOf("files", "core.media"))
            path == "/ai" || path.startsWith("/ai/") || path == "/brain" || path == "/brain.js" || path == "/brain.html" || path == "/selfheal" || path == "/selfheal.js" || path == "/selfheal.html" -> required.add("ai")
            path == "/mirror" || path == "/mirror.html" -> required.add("core.mirror")
            path == "/tts" || path == "/tts.html" -> required.add("core.tts")
            path == "/os" || path.startsWith("/os/") -> required.add("core.os")
            path == "/core" || path == "/core.html" || path == "/core.js" -> required.add("core.monitor")
        }
        when {
            path.startsWith("/api/fs/") || path == "/api/files" -> required.add("files")
            path.startsWith("/api/share/") -> required.addAll(listOf("files", "core.shares"))
            path.startsWith("/api/mirror/") -> required.add("core.mirror")
            path.startsWith("/api/device/") -> required.add("core.device")
            path.startsWith("/api/tts/") -> required.add("core.tts")
        }
        if (path.startsWith("/api/fs/audio-") || path == "/api/fs/media-status" || audioVideoContent) required.add("core.media")
        if (path in setOf("/api/system", "/api/device", "/api/network", "/api/storage", "/api/battery", "/api/cpu", "/api/memory", "/api/statistics", "/api/dashboard", "/api/fs/usage")) required.add("core.monitor")
        return required
    }

    fun blocked(rawPath: String, enabled: (String) -> Boolean, audioVideoContent: Boolean = false): String? =
        requirements(rawPath, audioVideoContent).firstOrNull { !enabled(it) }
}
