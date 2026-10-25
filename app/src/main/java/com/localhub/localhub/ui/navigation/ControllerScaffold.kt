package com.localhub.localhub.ui.navigation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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
            TopAppBar(
                title = {
                    Text(
                        selected.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.Bold
                    )
                },
                actions = {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.25f)),
                        modifier = Modifier.padding(end = 12.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary)
                            )
                            Text(
                                "LOCAL•HUB",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                letterSpacing = 0.8.sp
                            )
                        }
                    }
                },
                modifier = Modifier.testTag("controller-title")
            )
        },
        bottomBar = {
            NavigationBar(
                modifier = Modifier.testTag("controller-navigation"),
                tonalElevation = 6.dp
            ) {
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

