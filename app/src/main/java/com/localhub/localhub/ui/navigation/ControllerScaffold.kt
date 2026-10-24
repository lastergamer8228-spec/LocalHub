package com.localhub.localhub.ui.navigation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow

/** One title/navigation frame for every native controller screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ControllerScaffold(
    selected: Screen,
    onSelect: (Screen) -> Unit,
    content: @Composable (PaddingValues) -> Unit
) {
    val destinations = listOf(Screen.Dashboard, Screen.Modules, Screen.Logs, Screen.Clients, Screen.Settings)
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(selected.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                modifier = Modifier.testTag("controller-title"))
        },
        bottomBar = {
            NavigationBar(modifier = Modifier.testTag("controller-navigation")) {
                destinations.forEach { screen ->
                    NavigationBarItem(
                        selected = selected.route == screen.route,
                        onClick = { onSelect(screen) },
                        icon = { Icon(screen.icon, contentDescription = null) },
                        label = { Text(screen.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.testTag("nav-${screen.route}")
                    )
                }
            }
        },
        content = content
    )
}
