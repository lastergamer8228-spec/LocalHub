package com.localhub.localhub.ui

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.*
import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.ui.navigation.ControllerScaffold
import com.localhub.localhub.ui.navigation.Screen
import com.localhub.localhub.ui.screen.ModulesContent
import com.localhub.localhub.ui.theme.LocalHubTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/** Actual Compose measurement/interaction under Robolectric, not a physical phone test. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "w360dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class ModulesLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val data = mutableStateOf(sample())
    private val sequence = mutableIntStateOf(0)

    private fun show(width: Int = 360, font: Float = 1f) {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, font)) {
                LocalHubTheme {
                    Box(Modifier.fillMaxSize()) {
                        Box(Modifier.size(width.dp, 520.dp)) {
                            ControllerScaffold(Screen.Modules, { if (it == Screen.Modules) sequence.intValue++ }) { padding ->
                                Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                                    ModulesContent(data.value, null, sequence.intValue, { module ->
                                        data.value = data.value.map { if (it.id == module.id) it.copy(enabled = !it.enabled) else it }
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    private fun firstSwitchVisible() {
        compose.onNodeWithTag("module-switch-files").assertIsDisplayed()
        val toggle = compose.onNodeWithTag("module-switch-files").fetchSemanticsNode().boundsInRoot
        val nav = compose.onNodeWithTag("controller-navigation").fetchSemanticsNode().boundsInRoot
        val title = compose.onNodeWithTag("controller-title").fetchSemanticsNode().boundsInRoot
        assertTrue("Switch must be below the app title", toggle.top >= title.bottom)
        assertTrue("First switch must not be hidden behind navigation", toggle.bottom <= nav.top)
        val header = compose.onNodeWithTag("modules-header").fetchSemanticsNode().boundsInRoot
        assertTrue("Header must not become a viewport-tall text column", header.height < 190f)
    }

    @Test fun firstFeatureVisibleAtNormalFont() { show(); firstSwitchVisible() }
    @Test fun firstFeatureVisibleOnNarrowScreen() { show(width = 320); firstSwitchVisible() }
    @Test fun firstFeatureVisibleAtLargeFont() { show(width = 320, font = 1.5f); firstSwitchVisible() }
    @Test fun firstFeatureVisibleAtDoubleFont() { show(width = 320, font = 2f); firstSwitchVisible() }
    @Test @Config(application = Application::class, sdk = [34], qualifiers = "w640dp-h360dp-mdpi")
    fun firstFeatureVisibleInShortLandscapeAtLargeFont() { show(width = 640, font = 2f); firstSwitchVisible() }

    @Test fun togglesDoNotReorderOrResetButTabReselectReturnsToTop() {
        show()
        compose.onNodeWithTag("modules-list").performScrollToIndex(4)
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
        compose.runOnIdle { data.value = data.value.map { if (it.id == "files") it.copy(enabled = false) else it } }
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
        compose.onNodeWithTag("nav-modules").performClick()
        firstSwitchVisible()
        compose.onNodeWithTag("module-switch-files").assertIsOff().performClick().assertIsOn()
    }

    @Test fun themeChangeKeepsTheCurrentRouteAndModulePosition() {
        val dark = mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1f)) {
                LocalHubTheme(darkTheme = dark.value) {
                    val nav = rememberNavController()
                    val entry by nav.currentBackStackEntryAsState()
                    val selected = if (entry?.destination?.route == "fixture-modules") Screen.Modules else Screen.Dashboard
                    ControllerScaffold(selected, { if (it == Screen.Modules) nav.navigate("fixture-modules") }) { padding ->
                        NavHost(nav, "fixture-home", Modifier.fillMaxSize().padding(padding)) {
                            composable("fixture-home") { Text("Home fixture") }
                            composable("fixture-modules") { ModulesContent(data.value, null, 0, {}) }
                        }
                    }
                }
            }
        }
        compose.onNodeWithTag("nav-modules").performClick()
        compose.onNodeWithTag("modules-list").performScrollToIndex(4)
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
        compose.runOnIdle { dark.value = false }
        compose.onNodeWithTag("modules-list").assertIsDisplayed()
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
    }

    @Test fun stoppedHomeShowsAnActualSettingsNavigationAction() {
        var settings = 0
        var browser = 0
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                LocalHubTheme { Box(Modifier.width(320.dp)) {
                    com.localhub.localhub.ui.components.ServerStatusCard(
                        com.localhub.localhub.model.ServerStatus(false, 8080, "", "1", 0, 0), 0,
                        { browser++ }, { settings++ })
                } }
            }
        }
        compose.onNodeWithText("Server settings").assertIsDisplayed().performClick()
        compose.onNodeWithText("Open dashboard").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, settings); assertEquals(0, browser) }
    }

    @Test fun runningHomeActionsStayVisibleAtDoubleFont() {
        var settings = 0
        var browser = 0
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 2f)) {
                LocalHubTheme { Box(Modifier.width(320.dp)) {
                    com.localhub.localhub.ui.components.ServerStatusCard(
                        com.localhub.localhub.model.ServerStatus(true, 8080, "192.168.1.5", "1", 100, 0), 3,
                        { browser++ }, { settings++ })
                } }
            }
        }
        compose.onNodeWithText("Open dashboard").assertIsDisplayed().performClick()
        compose.onNodeWithText("Server settings").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, settings); assertEquals(1, browser) }
    }

    @Test fun dataArrivalDoesNotRequireScrollingToFindTheFirstFeature() {
        data.value = emptyList()
        show(width = 320, font = 1.5f)
        compose.onNodeWithText("Loading features…").assertIsDisplayed()
        compose.runOnIdle { data.value = sample() }
        firstSwitchVisible()
    }

    @Test fun savedPositionSurvivesRecreationButNewEntryRequestResetsIt() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1f)) {
                MaterialTheme { Box(Modifier.size(320.dp, 480.dp)) { ModulesContent(data.value, null, sequence.intValue, {}) } }
            }
        }
        compose.onNodeWithTag("modules-list").performScrollToIndex(4)
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("module-switch-files").assertIsNotDisplayed()
        compose.runOnIdle { sequence.intValue++ }
        compose.onNodeWithTag("module-switch-files").assertIsDisplayed()
    }

    @Test fun informationalComponentsAreCollapsedAndHaveNoSwitch() {
        show()
        compose.onNodeWithTag("modules-list").performScrollToNode(hasTestTag("components-toggle"))
        compose.onNodeWithTag("module-card-core.server").assertDoesNotExist()
        compose.onNodeWithTag("components-toggle").performClick()
        compose.onNodeWithTag("modules-list").performScrollToNode(hasTestTag("module-card-core.server"))
        compose.onNodeWithTag("module-card-core.server").assertIsDisplayed()
        compose.onNodeWithTag("module-switch-core.server").assertDoesNotExist()
    }

    @Test fun reproduceLegacyRowPushingFirstCardBelowViewportThenVerifyReplacement() {
        val replacement = mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                MaterialTheme {
                    Box(Modifier.size(320.dp, 480.dp)) {
                        if (replacement.value) ModulesContent(data.value, null, 0, {})
                        else LazyColumn(Modifier.fillMaxSize()) {
                            item { Row(Modifier.fillMaxWidth()) {
                                Text("Feature switches control server access. Info-only components have no switch.")
                                Text("20 / 24 registered components enabled")
                            } }
                            item { Text("First feature", Modifier.testTag("legacy-first")) }
                        }
                    }
                }
            }
        }
        compose.onNodeWithTag("legacy-first").assertIsNotDisplayed()
        compose.runOnIdle { replacement.value = true }
        compose.onNodeWithTag("module-switch-files").assertIsDisplayed()
    }

    companion object {
        private fun sample(): List<ModuleInfo> {
            return com.localhub.localhub.module.ModuleManager().apply {
                register(com.localhub.localhub.module.DashboardModule())
                register(com.localhub.localhub.module.FileManagerModule())
                register(com.localhub.localhub.module.AIAssistantModule())
                com.localhub.localhub.module.AssistantCapabilities.all().forEach { register(it) }
                com.localhub.localhub.module.CoreCapabilities.all().filter { it.id != "core.files" }.forEach { register(it) }
            }.toInfoList()
        }
    }
}
