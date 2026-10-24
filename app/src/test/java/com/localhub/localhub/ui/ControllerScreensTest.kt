package com.localhub.localhub.ui

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.ui.screen.ClientsContent
import com.localhub.localhub.ui.screen.LogsContent
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/** Native UI behaviour for Clients/Logs; no server, Room or device needed. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "w360dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class ControllerScreensTest {
    @get:Rule val compose = createComposeRule()
    private val logs = mutableStateOf(
        listOf(
            LogEntry(1, 1000L, LogLevel.INFO, "Service", "Server started on port 8080"),
            LogEntry(2, 2000L, LogLevel.ERROR, "AUDIT", "Permission denied for 'logs'")
        )
    )
    private val clients = mutableStateOf(
        listOf(
            ConnectedClient("w1", "192.168.1.20", "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Very Long User Agent String", 1000L, 2000L, "WebSocket"),
            ConnectedClient("h1", "192.168.1.21", "curl/8.0", 1500L, 3000L, "HTTP")
        )
    )
    private var cleared = 0
    private var blockedIp: String? = null
    private var unblockedIp: String? = null
    private var lastRestriction: Pair<String, String>? = null

    private fun showLogs(font: Float = 1f) {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, font)) {
                MaterialTheme { Box(Modifier.fillMaxSize()) { LogsContent(logs.value) { cleared++ } } }
            }
        }
    }
    private fun showClients(font: Float = 1f) {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, font)) {
                MaterialTheme {
                    Box(Modifier.fillMaxSize()) {
                        ClientsContent(
                            clients = clients.value,
                            blocked = emptySet(),
                            restrictions = emptyMap(),
                            onBlock = { blockedIp = it },
                            onUnblock = { unblockedIp = it },
                            onRestrict = { ip, mode -> lastRestriction = ip to mode }
                        )
                    }
                }
            }
        }
    }

    @Test fun clearAsksBeforeDeletingStoredLogs() {
        showLogs()
        compose.onNodeWithTag("logs-clear").performClick()
        compose.onNodeWithTag("logs-clear-dialog").assertIsDisplayed()
        compose.onNodeWithTag("logs-clear-cancel").performClick()
        compose.onNodeWithTag("logs-clear-dialog").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, cleared) }

        compose.onNodeWithTag("logs-clear").performClick()
        compose.onNodeWithTag("logs-clear-confirm").performClick()
        compose.onNodeWithTag("logs-clear-dialog").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, cleared) }
    }

    @Test fun clearIsDisabledWhenThereAreNoLogs() {
        compose.setContent { MaterialTheme { LogsContent(emptyList()) { cleared++ } } }
        compose.onNodeWithTag("logs-clear").assertIsNotEnabled()
        compose.onNodeWithText("No log entries yet.", substring = true).assertIsDisplayed()
    }

    @Test fun logsShowCountsTagsAndStayInsideBoundsAtLargeFont() {
        showLogs(font = 2f)
        compose.onNodeWithText("2 entries", substring = true).assertIsDisplayed()
        compose.onNodeWithText("AUDIT", substring = true).assertIsDisplayed()
        val screen = compose.onNodeWithTag("logs-screen").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("logs-list").fetchSemanticsNode().boundsInRoot.let { list ->
            assertTrue("Log list must stay within the screen width", list.right <= screen.right + 1f)
        }
        val item = compose.onNodeWithTag("log-item-1").fetchSemanticsNode().boundsInRoot
        assertTrue("Message column must not overflow the card", item.right <= screen.right + 1f)
    }

    @Test fun clientsDescribeRecentConnectionsNotGuaranteedLive() {
        showClients()
        compose.onNodeWithText("2 recent connection(s)", substring = true).assertIsDisplayed()
        compose.onNodeWithText("about a minute", substring = true).assertIsDisplayed()
        compose.onNodeWithTag("client-card-w1").assertIsDisplayed()
        compose.onNodeWithText("WebSocket").assertIsDisplayed()
    }

    @Test fun blockingADeviceAsksFirstAndUnblockingIsImmediate() {
        compose.setContent {
            MaterialTheme {
                ClientsContent(
                    clients = clients.value,
                    blocked = emptySet(),
                    restrictions = emptyMap(),
                    onBlock = { blockedIp = it },
                    onUnblock = { unblockedIp = it },
                    onRestrict = { ip, mode -> lastRestriction = ip to mode }
                )
            }
        }
        compose.onNodeWithTag("block-w1").performClick()
        compose.onNodeWithTag("block-dialog").assertIsDisplayed()
        compose.onNodeWithTag("block-cancel").performClick()
        compose.onNodeWithTag("block-dialog").assertDoesNotExist()
        assertNull("cancel must not block the device", blockedIp)

        compose.onNodeWithTag("block-w1").performClick()
        compose.onNodeWithTag("block-confirm").performClick()
        assertEquals("192.168.1.20", blockedIp)
    }

    @Test fun restrictiveFileModesAskFirstWhileRestoringFullAccessIsImmediate() {
        compose.setContent {
            MaterialTheme {
                ClientsContent(
                    clients = clients.value,
                    blocked = setOf("192.168.1.20"),
                    restrictions = mapOf("192.168.1.21" to "RO"),
                    onBlock = { },
                    onUnblock = { unblockedIp = it },
                    onRestrict = { ip, mode -> lastRestriction = ip to mode }
                )
            }
        }
        // Blocked device shows Unblock, which restores access without a dialog.
        compose.onNodeWithTag("unblock-w1").performClick()
        assertEquals("192.168.1.20", unblockedIp)
    }

    @Test fun longUserAgentDoesNotOverflowTheCardAtLargeFont() {
        showClients(font = 2f)
        val screen = compose.onNodeWithTag("clients-screen").fetchSemanticsNode().boundsInRoot
        val card = compose.onNodeWithTag("client-card-w1").fetchSemanticsNode().boundsInRoot
        assertTrue("Client card must stay within the screen width", card.right <= screen.right + 1f)
        val list = compose.onNodeWithTag("clients-list").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("client-card-h1").assertIsDisplayed()
        assertTrue("Cards must be laid out in a single column", card.left == list.left || card.left >= list.left)
    }

    @Test fun emptyClientsExplainsHowToConnect() {
        compose.setContent {
            MaterialTheme {
                ClientsContent(
                    clients = emptyList(),
                    blocked = emptySet(),
                    restrictions = emptyMap(),
                    onBlock = { },
                    onUnblock = { },
                    onRestrict = { _, _ -> }
                )
            }
        }
        compose.onNodeWithText("No recent connections.", substring = true).assertIsDisplayed()
        compose.onNodeWithText("0 recent connection(s)", substring = true).assertIsDisplayed()
    }
}
