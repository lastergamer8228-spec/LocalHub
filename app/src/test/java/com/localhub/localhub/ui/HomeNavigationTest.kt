package com.localhub.localhub.ui

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.localhub.localhub.ui.navigation.ControllerNavigation
import com.localhub.localhub.ui.navigation.Screen
import com.localhub.localhub.ui.theme.LocalHubTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/** Actual production navigator and bottom-bar handlers; fixture bodies avoid services/DB. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "w360dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class HomeNavigationTest {
    @get:Rule val compose = createComposeRule()
    private fun show() {
        compose.setContent {
            LocalHubTheme {
                ControllerNavigation { screen, _, onSettings ->
                    Column(Modifier.testTag("screen-${screen.route}")) {
                        Text("Body ${screen.label}")
                        if (screen == Screen.Dashboard) {
                            var count by rememberSaveable { mutableIntStateOf(0) }
                            Button(onClick = { count++ }) { Text("Home count $count") }
                            Button(onClick = onSettings) { Text("Server settings fixture") }
                        }
                    }
                }
            }
        }
    }
    @Test fun modulesThenHomeActuallyReturnsToHomeContent() {
        show()
        compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
        compose.onNodeWithTag("nav-modules").performClick()
        compose.onNodeWithTag("screen-modules").assertIsDisplayed()
        compose.onNodeWithTag("nav-dashboard").performClick()
        compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
        compose.onNodeWithTag("nav-dashboard").assertIsSelected()
    }
    @Test fun everyTabReturnsToHomeContent() {
        show()
        for (tab in listOf("modules", "logs", "clients", "settings")) {
            compose.onNodeWithTag("nav-$tab").performClick()
            compose.onNodeWithTag("screen-$tab").assertIsDisplayed()
            compose.onNodeWithTag("nav-dashboard").performClick()
            compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
            compose.onNodeWithTag("nav-dashboard").assertIsSelected()
        }
    }

    @Test fun repeatedHomeClicksDoNotBreakNavigation() {
        show()
        compose.onNodeWithTag("nav-modules").performClick()
        compose.onNodeWithTag("nav-dashboard").performClick()
        compose.onNodeWithTag("nav-dashboard").performClick()
        compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
        compose.onNodeWithTag("nav-modules").performClick()
        compose.onNodeWithTag("screen-modules").assertIsDisplayed()
    }

    @Test fun homeServerSettingsCallbackReachesSettingsThenBack() {
        show()
        compose.onNodeWithText("Server settings fixture").performClick()
        compose.onNodeWithTag("screen-settings").assertIsDisplayed()
        compose.onNodeWithTag("nav-dashboard").performClick()
        compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
    }

    @Test fun settingsThenHomeActuallyReturnsToHomeContent() {
        show()
        compose.onNodeWithTag("nav-settings").performClick()
        compose.onNodeWithTag("screen-settings").assertIsDisplayed()
        compose.onNodeWithTag("nav-dashboard").performClick()
        compose.onNodeWithTag("screen-dashboard").assertIsDisplayed()
    }
}
