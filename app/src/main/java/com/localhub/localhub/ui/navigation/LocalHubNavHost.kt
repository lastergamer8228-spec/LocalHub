package com.localhub.localhub.ui.navigation

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
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
import com.localhub.localhub.ui.theme.AnimTokens

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
            composable(
                Screen.Dashboard.route,
                enterTransition = enter,
                exitTransition = exit,
                popEnterTransition = popEnter,
                popExitTransition = popExit
            ) { DashboardScreen() }
            composable(
                Screen.Logs.route,
                enterTransition = enter,
                exitTransition = exit,
                popEnterTransition = popEnter,
                popExitTransition = popExit
            ) { LogsScreen() }
            composable(
                Screen.Modules.route,
                enterTransition = enter,
                exitTransition = exit,
                popEnterTransition = popEnter,
                popExitTransition = popExit
            ) { ModulesScreen() }
            composable(
                Screen.Clients.route,
                enterTransition = enter,
                exitTransition = exit,
                popEnterTransition = popEnter,
                popExitTransition = popExit
            ) { ClientsScreen() }
            composable(
                Screen.Settings.route,
                enterTransition = enter,
                exitTransition = exit,
                popEnterTransition = popEnter,
                popExitTransition = popExit
            ) { SettingsScreen() }
        }
    }
}

/** Subtle slide + fade transitions between destinations (shared animation language). */
private val enter: androidx.compose.animation.AnimatedContentTransitionScope<androidx.navigation.NavBackStackEntry>.() -> androidx.compose.animation.EnterTransition = {
    fadeIn(tween(AnimTokens.FAST_MS, easing = AnimTokens.StandardEasing)) +
        slideInHorizontally(
            animationSpec = tween(AnimTokens.SLOW_MS, easing = AnimTokens.EmphasizedDecel),
            initialOffsetX = { it / 12 }
        )
}
private val exit: androidx.compose.animation.AnimatedContentTransitionScope<androidx.navigation.NavBackStackEntry>.() -> androidx.compose.animation.ExitTransition = {
    fadeOut(tween(AnimTokens.FAST_MS, easing = AnimTokens.StandardEasing)) +
        slideOutHorizontally(
            animationSpec = tween(AnimTokens.SLOW_MS, easing = AnimTokens.StandardEasing),
            targetOffsetX = { -it / 12 }
        )
}
private val popEnter: androidx.compose.animation.AnimatedContentTransitionScope<androidx.navigation.NavBackStackEntry>.() -> androidx.compose.animation.EnterTransition = {
    fadeIn(tween(AnimTokens.FAST_MS, easing = AnimTokens.StandardEasing)) +
        slideInHorizontally(
            animationSpec = tween(AnimTokens.SLOW_MS, easing = AnimTokens.EmphasizedDecel),
            initialOffsetX = { -it / 12 }
        )
}
private val popExit: androidx.compose.animation.AnimatedContentTransitionScope<androidx.navigation.NavBackStackEntry>.() -> androidx.compose.animation.ExitTransition = {
    fadeOut(tween(AnimTokens.FAST_MS, easing = AnimTokens.StandardEasing)) +
        slideOutHorizontally(
            animationSpec = tween(AnimTokens.SLOW_MS, easing = AnimTokens.StandardEasing),
            targetOffsetX = { it / 12 }
        )
}
