package com.localhub.localhub.data.backup

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.localhub.localhub.model.LogEntry

/**
 * Settings/log backup format.
 *
 * Security rule: credentials are never exported and never restored. Backups only
 * carry non-secret preferences (port, theme, autostart, server name). Any other
 * key found in a file is ignored and reported, so a tampered or older backup
 * cannot inject passwords, TOTP secrets, or unknown settings.
 */
object BackupSerializer {
    const val SCHEMA_VERSION = 1
    private const val MAX_LOGS = 2000
    private val THEMES = setOf("dark", "light", "system")
    private val ALLOWED = setOf("port", "theme", "autostart", "serverName")

    data class ImportResult(
        val values: Map<String, String> = emptyMap(),
        val ignoredKeys: List<String> = emptyList(),
        val error: String? = null
    )

    fun exportSettings(values: Map<String, String>, now: Long): String {
        val safe = values.filterKeys { it in ALLOWED }
        return Gson().toJson(
            mapOf(
                "schemaVersion" to SCHEMA_VERSION,
                "kind" to "localhub-settings",
                "createdAt" to now,
                "settings" to safe
            )
        )
    }

    fun parseSettings(json: String): ImportResult {
        if (json.isBlank()) return ImportResult(error = "The selected file is empty.")
        val gson = Gson()
        val map = runCatching {
            @Suppress("UNCHECKED_CAST")
            gson.fromJson(json, object : TypeToken<Map<String, Any>>() {}.type) as? Map<String, Any>
        }.getOrNull() ?: return ImportResult(error = "That file is not a valid LocalHub backup.")

        val kind = map["kind"] as? String
        if (kind != null && kind != "localhub-settings") {
            return ImportResult(error = "That file is a $kind backup, not a settings backup.")
        }

        @Suppress("UNCHECKED_CAST")
        val raw = map["settings"] as? Map<String, Any> ?: return ImportResult(error = "No settings found in that file.")

        val values = linkedMapOf<String, String>()
        val ignored = mutableListOf<String>()
        for ((key, value) in raw) {
            val text = value?.toString() ?: ""
            when (key) {
                "port" -> {
                    val port = text.toIntOrNull()
                    if (port != null && port in 1024..65535) values["port"] = port.toString() else ignored.add(key)
                }
                "theme" -> if (text in THEMES) values["theme"] = text else ignored.add(key)
                "autostart" -> if (text == "true" || text == "false") values["autostart"] = text else ignored.add(key)
                "serverName" -> {
                    val name = text.trim()
                    if (name.isNotBlank() && name.length <= 64) values["serverName"] = name else ignored.add(key)
                }
                else -> ignored.add(key) // credentials and unknown keys are never restored
            }
        }
        return ImportResult(values = values, ignoredKeys = ignored)
    }

    /** Bounded so a huge log table cannot produce an enormous file. */
    fun exportLogs(logs: List<LogEntry>, now: Long): String {
        val kept = logs.takeLast(MAX_LOGS)
        val rows = kept.map {
            mapOf(
                "timestamp" to it.timestamp,
                "level" to it.level.name,
                "tag" to it.tag,
                "message" to it.message
            )
        }
        return Gson().toJson(
            mapOf(
                "schemaVersion" to SCHEMA_VERSION,
                "kind" to "localhub-logs",
                "createdAt" to now,
                "count" to rows.size,
                "truncated" to (logs.size > MAX_LOGS),
                "entries" to rows
            )
        )
    }
}
