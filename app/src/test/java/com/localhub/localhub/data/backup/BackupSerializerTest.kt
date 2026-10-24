package com.localhub.localhub.data.backup

import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import org.junit.Assert.*
import org.junit.Test

class BackupSerializerTest {
    private val settings = mapOf(
        "port" to "8080",
        "theme" to "dark",
        "autostart" to "true",
        "serverName" to "LocalHub"
    )

    @Test fun settingsRoundTrip() {
        val json = BackupSerializer.exportSettings(settings, 1000L)
        val result = BackupSerializer.parseSettings(json)
        assertNull(result.error)
        assertEquals("8080", result.values["port"])
        assertEquals("dark", result.values["theme"])
        assertEquals("true", result.values["autostart"])
        assertEquals("LocalHub", result.values["serverName"])
        assertTrue(result.ignoredKeys.isEmpty())
    }

    @Test fun credentialsAreNeverExported() {
        val withSecrets = settings + mapOf("adminPass" to "hash", "totpSecret" to "SECRET")
        val json = BackupSerializer.exportSettings(withSecrets, 1L)
        assertFalse(json.contains("adminPass"))
        assertFalse(json.contains("totpSecret"))
        assertFalse(json.contains("SECRET"))
    }

    @Test fun credentialsInAFileAreIgnored() {
        val tampered = """{"kind":"localhub-settings","settings":{"port":"8080","adminPass":"evil","totpSecret":"x"}}"""
        val result = BackupSerializer.parseSettings(tampered)
        assertEquals("8080", result.values["port"])
        assertFalse(result.values.containsKey("adminPass"))
        assertFalse(result.values.containsKey("totpSecret"))
        assertTrue(result.ignoredKeys.containsAll(listOf("adminPass", "totpSecret")))
    }

    @Test fun invalidValuesAreRejected() {
        val bad = """{"kind":"localhub-settings","settings":{"port":"80","theme":"neon","autostart":"maybe","serverName":""}}"""
        val result = BackupSerializer.parseSettings(bad)
        assertTrue(result.values.isEmpty())
        assertEquals(4, result.ignoredKeys.size)
    }

    @Test fun malformedInputReportsAnError() {
        assertTrue(BackupSerializer.parseSettings("").error != null)
        assertTrue(BackupSerializer.parseSettings("{nope").error != null)
        assertTrue(BackupSerializer.parseSettings("""{"kind":"localhub-logs"}""").error != null)
    }

    @Test fun wrongBackupKindIsRefused() {
        val logs = """{"kind":"localhub-logs","settings":{"port":"8080"}}"""
        assertTrue(BackupSerializer.parseSettings(logs).error?.contains("logs") == true)
    }

    @Test fun logExportIsBounded() {
        val many = (1..2500).map { LogEntry(it.toLong(), it.toLong(), LogLevel.INFO, "T", "m$it") }
        val json = BackupSerializer.exportLogs(many, 5L)
        assertTrue(json.contains("\"truncated\":true"))
        assertTrue(json.contains("\"count\":2000"))
        // Entries are capped, so the file cannot grow without limit.
        assertFalse(json.contains("m1\""))
    }

    @Test fun smallLogExportIsNotTruncated() {
        val few = listOf(LogEntry(1, 1, LogLevel.ERROR, "AUDIT", "denied"))
        val json = BackupSerializer.exportLogs(few, 5L)
        assertTrue(json.contains("\"truncated\":false"))
        assertTrue(json.contains("denied"))
    }
}
