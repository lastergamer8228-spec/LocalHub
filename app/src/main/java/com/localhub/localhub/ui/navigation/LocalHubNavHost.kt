package com.localhub.localhub.ui.navigation

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
    object Dashboard : Screen("dashboard", "Home", Icons.Filled.Dashboard)
    object Logs : Screen("logs", "Activity", Icons.Filled.ListAlt)
    object Modules : Screen("modules", "Modules", Icons.Filled.Extension)
    object Clients : Screen("clients", "Clients", Icons.Filled.Devices)
    object Settings : Screen("settings", "Settings", Icons.Filled.Settings)
}

@Composable
fun LocalHubNavHost() {
    ControllerNavigation { screen, modulesOpenSequence, onManageServer ->
        when (screen) {
            Screen.Dashboard -> DashboardScreen(onManageServer = onManageServer)
            Screen.Modules -> ModulesScreen(openSequence = modulesOpenSequence)
            Screen.Logs -> LogsScreen()
            Screen.Clients -> ClientsScreen()
            Screen.Settings -> SettingsScreen()
        }
    }
}

/** Production route/click wiring, injectable screen bodies for native UI tests. */
@Composable
internal fun ControllerNavigation(renderScreen: @Composable (Screen, Int, () -> Unit) -> Unit) {
    val navController = rememberNavController()
    val entry by navController.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: Screen.Dashboard.route
    val screens = listOf(Screen.Dashboard, Screen.Modules, Screen.Logs, Screen.Clients, Screen.Settings)
    val selected = screens.firstOrNull { it.route == route } ?: Screen.Dashboard
    var modulesOpenSequence by rememberSaveable { mutableIntStateOf(0) }

    fun selectScreen(screen: Screen) {
        // Read the live back stack at click time. Captured composition state can
        // be stale: the old guard compared a stale `selected` and silently
        // swallowed the Home tab click (reported as a dead Home button).
        val currentRoute = navController.currentBackStackEntry?.destination?.route
        if (screen == Screen.Modules) modulesOpenSequence++
        if (currentRoute == screen.route) return
        navController.navigate(screen.route) {
            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
    ControllerScaffold(selected = selected, onSelect = ::selectScreen) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Dashboard.route,
            modifier = Modifier.fillMaxSize().padding(innerPadding).consumeWindowInsets(innerPadding)
        ) {
            screens.forEach { screen ->
                composable(
                    screen.route,
                    enterTransition = enter,
                    exitTransition = exit,
                    popEnterTransition = popEnter,
                    popExitTransition = popExit
                ) { renderScreen(screen, modulesOpenSequence) { selectScreen(Screen.Settings) } }
            }
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
