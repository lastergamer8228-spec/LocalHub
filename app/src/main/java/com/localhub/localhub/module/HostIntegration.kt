package com.localhub.localhub.module

/** Sanitized host capability/state descriptor, not an executor or diagnosis.
 * Keep unsupported metadata-only cards out of the advertised switch surface.
 */
object HostIntegration {
    val permissionKeys = setOf("storage", "camera", "notifications", "writeSettings", "notificationPolicy", "accessibility", "screenCapture")

    fun describe(manager: ModuleManager, role: String, permissions: Map<String, String>,
                 port: Int, protocol: String, startedAt: Long, sampledAt: Long,
                 healthSummary: String? = null): Map<String, Any> {
        val safeRole = role.takeIf { it == "admin" || it == "user" } ?: "unknown"
        val permissionStates = setOf("GRANTED", "MISSING", "UNKNOWN", "ACTIVE", "INACTIVE")
        val visible = ModulePolicy.controllable + setOf("core.server", "core.security")
        return mapOf(
            "schemaVersion" to 1,
            "sampledAt" to sampledAt,
            "source" to "android-host-read-only",
            "server" to mapOf("running" to true, "port" to port, "protocol" to protocol, "startedAt" to startedAt),
            "access" to mapOf("role" to safeRole, "canRequestDisruptiveChange" to (safeRole == "admin")),
            "features" to manager.toInfoList().filter { it.id in visible }.map { feature -> mapOf(
                "id" to feature.id, "name" to feature.name, "enabled" to feature.enabled,
                "control" to if (feature.id in ModulePolicy.controllable) "switch" else "required",
                "requires" to if (feature.id in setOf("core.media", "core.shares")) listOf("files") else emptyList<String>()
            ) },
            "permissions" to permissionKeys.associateWith { permissions[it]?.takeIf { value -> value in permissionStates } ?: "UNKNOWN" },
            "lifecycle" to mapOf("nativeHost" to "Android foreground service", "assistant" to "browser page",
                "guardian" to "browser-page lifetime; not an Android background repair daemon",
                "installedApkPatching" to "not provided by this host",
                "buildAndDeploy" to "requires separate development/device adapters"),
            // Crash/health detail is admin-only; standard users see nothing.
            "health" to (healthSummary?.takeIf { safeRole == "admin" } ?: ""),
            "recovery" to mapOf("architecture" to "crash recorded + bounded restart + safe mode",
                "note" to "Recovery reduces repeated stops; it cannot guarantee a crash-free app."),
            "chatRecoveryPolicy" to mapOf(
                "mode" to "bounded-read-recovery",
                "automatic" to listOf("read host state", "inspect enabled features", "recheck a transient read once"),
                "approvalRequired" to listOf("server restart/stop", "file edits/deletes", "configuration or permission changes"),
                "neverAutomatic" to listOf("re-enable an intentionally disabled module", "bypass Android consent", "patch installed APK", "root-only controls"),
                "legacyEngine" to "frozen; not invoked by this integration's diagnostic/recheck flow"
            )
        )
    }
}
