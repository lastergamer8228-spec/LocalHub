package com.localhub.localhub.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.localhub.localhub.ui.screen.ClientsScreen
import com.localhub.localhub.ui.screen.DashboardScreen
import com.localhub.localhub.ui.screen.LogsScreen
import com.localhub.localhub.ui.screen.ModulesScreen
import com.localhub.localhub.ui.screen.SettingsScreen

sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    object Dashboard : Screen("dashboard", "Dashboard", Icons.Filled.Dashboard)
    object Logs : Screen("logs", "Logs", Icons.Filled.ListAlt)
    object Modules : Screen("modules", "Modules", Icons.Filled.Extension)
    object Clients : Screen("clients", "Clients", Icons.Filled.Devices)
    object Settings : Screen("settings", "Settings", Icons.Filled.Settings)
}

@Composable
fun LocalHubNavHost() {
    val navController = rememberNavController()
    val items = listOf(
        Screen.Dashboard,
        Screen.Logs,
        Screen.Modules,
        Screen.Clients,
        Screen.Settings
    )

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination
                items.forEach { screen ->
                    NavigationBarItem(
                        icon = { Icon(screen.icon, contentDescription = null) },
                        label = { Text(screen.label) },
                        selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Dashboard.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Dashboard.route) { DashboardScreen() }
            composable(Screen.Logs.route) { LogsScreen() }
            composable(Screen.Modules.route) { ModulesScreen() }
            composable(Screen.Clients.route) { ClientsScreen() }
            composable(Screen.Settings.route) { SettingsScreen() }
        }
    }
}
