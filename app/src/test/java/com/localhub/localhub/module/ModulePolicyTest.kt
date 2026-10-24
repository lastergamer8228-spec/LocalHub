package com.localhub.localhub.module

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class ModulePolicyTest {
    private fun manager() = ModuleManager().apply {
        register(DashboardModule()); register(FileManagerModule()); register(AIAssistantModule())
        CoreCapabilities.all().filter { it.id != "core.files" }.forEach { register(it) }
    }

    @Test fun mediaOffBlocksEveryPlayerAliasAndAudioEndpoint() {
        val m = manager(); m.setEnabled("core.media", false)
        listOf("/player", "/player/", "/player?file=foo", "/player.html", "/dashboard/player.html",
            "/assets/dashboard/player.html", "/dashboard/../dashboard/player.html", "/dashboard/player-cinema.css",
            "/dashboard/compatible-audio.js", "/api/fs/audio-tracks", "/api/fs/audio-chunk", "/api/fs/media-status", "/dashboard/module-access.js").forEach {
            assertEquals(it, "core.media", m.blocked(it))
        }
        assertEquals("core.media", m.blocked("/api/fs/content", true))
        assertNull(m.blocked("/api/fs/content", false))
        assertNull(m.blocked("/api/fs/list"))
        assertNull(m.blocked("/api/auth/login"))
        m.setEnabled("core.media", true)
        assertNull(m.blocked("/player")); assertNull(m.blocked("/api/fs/audio-chunk"))
    }

    @Test fun filesOffBlocksMediaAndFileMutationsButNotLogin() {
        val m=manager();m.setEnabled("files",false)
        listOf("/files","/dashboard/files.html","/player","/api/files","/api/fs/list","/api/fs/read",
            "/api/fs/write","/api/fs/upload","/api/fs/content","/api/fs/audio-chunk","/api/share/token").forEach {
            assertEquals(it,"files",m.blocked(it))
        }
        assertNull(m.blocked("/api/auth/login"));assertNull(m.blocked("/api/status"))
    }

    @Test fun independentRouteGroupsAreEnforced() {
        val cases=mapOf("dashboard" to listOf("/","/index.html","/dashboard/index.html","/app.js"),
            "ai" to listOf("/ai","/ai/index.html","/ai/brain.js","/selfheal","/brain"),
            "core.mirror" to listOf("/mirror","/dashboard/mirror.html","/api/mirror/start","/api/mirror/frame"),
            "core.device" to listOf("/api/device/torch","/api/device/volume"),
            "core.shares" to listOf("/api/share/token","/api/share/list"),
            "core.monitor" to listOf("/api/dashboard","/api/system","/core","/api/cpu","/api/fs/usage"),
            "core.tts" to listOf("/tts","/api/tts/synthesize","/api/tts/file"),
            "core.os" to listOf("/os","/os/","/os/index.html","/os/os.js"))
        cases.forEach { (id,paths) -> val m=manager();m.setEnabled(id,false)
            paths.forEach { assertEquals(it,id,m.blocked(it)) }
            assertNull(m.blocked("/api/auth/login"))
        }
    }

    @Test fun restoreDisabledStateBeforeRoutesAndMigrateDuplicateFiles() {
        val first=manager();first.setEnabled("core.media",false);first.setEnabled("files",false)
        val saved=first.toInfoList().associate { it.id to it.enabled }
        val second=manager();second.restoreEnabled(saved)
        assertEquals("files", second.blocked("/player.html")) // files OFF is also required; explicit check below
    }

    @Test fun restoreAndLegacyMigration() {
        val m=manager();m.restoreEnabled(mapOf("core.media" to false, "core.files" to false, "core.security" to false))
        assertFalse(m.getModule("core.media")!!.isEnabled);assertFalse(m.getModule("files")!!.isEnabled)
        assertTrue(m.getModule("core.security")!!.isEnabled)
        assertNull(m.getModule("core.files"))
    }

    @Test fun cannotPretendToDisableSecurityOrMetadataOnlyComponents() {
        val m=manager()
        listOf("core.security","core.server","core.automation","not-a-module").forEach {
            try { m.setEnabled(it,false);fail("Should reject $it") } catch(expected:IllegalArgumentException) { }
        }
        assertTrue(m.getModule("core.security")!!.isEnabled)
    }

    @Test fun offCutsExistingContentReadsAndOnRestoresNewStreams() {
        val m=manager();val stream=m.guardStream("/api/fs/content",true,ByteArrayInputStream(byteArrayOf(1,2,3)))
        assertEquals(1,stream.read());m.setEnabled("core.media",false)
        assertEquals(-1,stream.read());assertEquals(-1,stream.read(ByteArray(4),0,4))
        m.setEnabled("core.media",true)
        assertEquals(2,m.guardStream("/api/fs/content",true,ByteArrayInputStream(byteArrayOf(2))).read())
    }
}
