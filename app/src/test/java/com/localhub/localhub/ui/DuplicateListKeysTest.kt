package com.localhub.localhub.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Density
import com.localhub.localhub.data.local.dao.LogDao
import com.localhub.localhub.data.local.entity.LogEntity
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.ui.components.ListKeys
import com.localhub.localhub.ui.screen.ClientsContent
import com.localhub.localhub.ui.screen.LogsContent
import com.localhub.localhub.util.AppLogger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/**
 * Regression tests for the field crash reported on 2026-10-23:
 *
 *   java.lang.IllegalArgumentException: Key "0" was already used.
 *   If you are using LazyColumn/Row please make sure you provide a unique key
 *   for each item.
 *
 * Every log entry created in memory carried the default id 0, so a list keyed
 * on `it.id` produced two rows with the same key and Compose threw.
 *
 * Robolectric + real Compose: this proves the lists render, not how they look.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [34], qualifiers = "w360dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class DuplicateListKeysTest {

    @get:Rule
    val compose = createComposeRule()

    // Exactly the data shape that crashed the app: real content, all ids zero.
    private val zeroIdLogs = listOf(
        LogEntry(0L, 1_700_000_000_000L, LogLevel.INFO, "Service", "Server started on port 8080"),
        LogEntry(0L, 1_700_000_001_000L, LogLevel.INFO, "HTTP", "GET / from 192.168.0.101"),
        LogEntry(0L, 1_700_000_002_000L, LogLevel.ERROR, "Upload", "Upload rejected: file too large"),
        LogEntry(0L, 1_700_000_003_000L, LogLevel.WARNING, "Service", "Low memory"),
        LogEntry(0L, 1_700_000_004_000L, LogLevel.INFO, "HTTP", "GET /files from 192.168.0.102")
    )

    @Composable
    private fun Screen(body: @Composable () -> Unit) {
        CompositionLocalProvider(LocalDensity provides Density(1f, 1f)) {
            MaterialTheme { Box(Modifier.fillMaxSize()) { body() } }
        }
    }

    private fun show(body: @Composable () -> Unit) {
        compose.setContent { Screen(body) }
    }

    @Test
    fun theOldKeyReallyDidCrash() {
        // Documents the bug: keying on a field that repeats must throw. If this
        // stops throwing, Compose changed and this whole class is obsolete.
        val thrown = runCatching {
            compose.setContent {
                MaterialTheme {
                    LazyColumn {
                        items(zeroIdLogs, key = { it.id }) { entry -> Text(entry.message) }
                    }
                }
            }
            compose.onNodeWithText("Server started on port 8080").assertExists()
        }.exceptionOrNull()

        assertTrue(
            "expected the duplicate-key crash, got: $thrown",
            thrown != null && (thrown is IllegalArgumentException || thrown.cause is IllegalArgumentException)
        )
    }

    @Test
    fun logListRendersWhenEveryEntrySharesTheSameId() {
        show { LogsContent(zeroIdLogs) {} }
        compose.onNodeWithText("Server started on port 8080").assertExists()
        compose.onNodeWithText("Upload rejected: file too large").assertExists()
        compose.onNodeWithText("Low memory").assertExists()
    }

    @Test
    fun dashboardStyleLogListWithIndexKeysRendersDuplicates() {
        show {
            LazyColumn {
                itemsIndexed(
                    zeroIdLogs,
                    key = { index, entry -> ListKeys.log(index, entry) }
                ) { _, entry -> Text(entry.message) }
            }
        }
        compose.onNodeWithText("GET /files from 192.168.0.102").assertExists()
    }

    @Test
    fun clientsListSurvivesDuplicateClientIds() {
        val clients = listOf(
            ConnectedClient("dup", "192.168.0.10", "Chrome", 1L, 2L, "HTTP"),
            ConnectedClient("dup", "192.168.0.11", "Chrome", 3L, 4L, "WebSocket"),
            ConnectedClient("dup", "192.168.0.12", "Chrome", 5L, 6L, "HTTP")
        )
        show {
            ClientsContent(
                clients = clients,
                blocked = emptySet(),
                restrictions = emptyMap(),
                onBlock = {},
                onUnblock = {},
                onRestrict = { _, _ -> }
            )
        }
        compose.onNodeWithText("192.168.0.10").assertExists()
        compose.onNodeWithText("192.168.0.11").assertExists()
        compose.onNodeWithText("192.168.0.12").assertExists()
    }

    @Test
    fun twoModuleBlocksWithTheSameIdDoNotClash() {
        val shared = ModuleInfo(
            id = "core.files",
            name = "File manager",
            description = "Browse and serve files",
            version = "1.0",
            enabled = true
        )
        show {
            LazyColumn {
                items(listOf(shared), key = { ListKeys.module(ListKeys.FEATURE, it) }) { Text("feature:" + it.name) }
                items(listOf(shared), key = { ListKeys.module(ListKeys.COMPONENT, it) }) { Text("component:" + it.name) }
            }
        }
        compose.onNodeWithText("feature:File manager").assertExists()
        compose.onNodeWithText("component:File manager").assertExists()
    }

    @Test
    fun listKeysAreUniquePerRow() {
        val keys = zeroIdLogs.mapIndexed { index, entry -> ListKeys.log(index, entry) }
        assertEquals(keys.size, keys.toSet().size)
        // identical content, different position -> still different keys
        val twin = zeroIdLogs[0]
        assertNotEquals(ListKeys.log(0, twin), ListKeys.log(1, twin))
    }

    @Test
    fun appLoggerGivesEveryEmittedEntryAUniqueId() = runBlocking {
        val logger = AppLogger(LogRepository(FailingLogDao()))
        repeat(25) { i -> logger.log(LogLevel.INFO, "Test", "message $i") }
        val ids = collectIds(logger)
        assertEquals(25, ids.size)
        assertEquals(25, ids.toSet().size)
        assertTrue("no entry may keep the default id 0", ids.none { it == 0L })
    }

    @Test
    fun appLoggerPrefersRoomRowIdsWhenTheDatabaseWorks() = runBlocking {
        val logger = AppLogger(LogRepository(SequenceLogDao()))
        repeat(5) { i -> logger.log(LogLevel.INFO, "Test", "row $i") }
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), collectIds(logger))
    }

    private suspend fun collectIds(logger: AppLogger): List<Long> = coroutineScope {
        val ids = mutableListOf<Long>()
        val job = launch { logger.logs.collect { ids.add(it.id) } }
        delay(60) // let the replay cache drain into the collector
        job.cancel()
        ids.toList()
    }

    private class FailingLogDao : LogDao {
        override suspend fun insert(entity: LogEntity): Long = 0L // persistence unavailable
        override fun recent(limit: Int): Flow<List<LogEntity>> = emptyFlow()
        override fun all(): Flow<List<LogEntity>> = emptyFlow()
        override suspend fun deleteOlderThan(before: Long) {}
        override suspend fun clear() {}
    }

    private class SequenceLogDao : LogDao {
        private var next = 0L
        override suspend fun insert(entity: LogEntity): Long = ++next
        override fun recent(limit: Int): Flow<List<LogEntity>> = emptyFlow()
        override fun all(): Flow<List<LogEntity>> = emptyFlow()
        override suspend fun deleteOlderThan(before: Long) {}
        override suspend fun clear() {}
    }
}
