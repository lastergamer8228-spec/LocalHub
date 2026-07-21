package com.localhub.localhub.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Extra semantic colors beyond the Material 3 color scheme, exposed through a
 * CompositionLocal so any composable can read them via [LocalLocalHubColors].
 */
data class LocalHubColors(
    val accent: Color,
    val accentBlue: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val cpu: Color,
    val memory: Color,
    val storage: Color,
    val battery: Color,
    val network: Color,
    val surfaceGlass: Color
)

val DarkLocalHubColors = LocalHubColors(
    accent = Color(0xFF22D3A6),
    accentBlue = Color(0xFF38BDF8),
    success = Color(0xFF34D399),
    warning = Color(0xFFFBBF24),
    danger = Color(0xFFF87171),
    cpu = Color(0xFF22D3A6),
    memory = Color(0xFF818CF8),
    storage = Color(0xFFF59E0B),
    battery = Color(0xFF34D399),
    network = Color(0xFF38BDF8),
    surfaceGlass = Color(0xFF16223B)
)

val LightLocalHubColors = LocalHubColors(
    accent = Color(0xFF0F766E),
    accentBlue = Color(0xFF0369A1),
    success = Color(0xFF059669),
    warning = Color(0xFFD97706),
    danger = Color(0xFFDC2626),
    cpu = Color(0xFF0F766E),
    memory = Color(0xFF4F46E5),
    storage = Color(0xFFB45309),
    battery = Color(0xFF059669),
    network = Color(0xFF0369A1),
    surfaceGlass = Color(0xFFE6ECF4)
)

val LocalLocalHubColors = staticCompositionLocalOf { DarkLocalHubColors }
