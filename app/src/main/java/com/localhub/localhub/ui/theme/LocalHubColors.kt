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

    /** Legacy translucent surface. Retained for callers not yet migrated. */
    val surfaceGlass: Color,

    /**
     * Tonal elevation surfaces. On a dark background a shadow is the weakest
     * possible depth cue, so — as in Material 3 — a higher level means a
     * lighter surface rather than a heavier shadow. These mirror --elev-0..3
     * in assets/dashboard/tokens.css so both surfaces read identically.
     */
    val surface0: Color,   // canvas / app background
    val surface1: Color,   // card, panel
    val surface2: Color,   // raised: input, dropdown
    val surface3: Color    // modal — the only level that also earns a shadow
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
    surfaceGlass = Color(0xFF16223B),
    surface0 = Color(0xFF0A0D12),
    surface1 = Color(0xFF0F131A),
    surface2 = Color(0xFF141922),
    surface3 = Color(0xFF1A2029)
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
    surfaceGlass = Color(0xFFE6ECF4),
    surface0 = Color(0xFFF7F9FC),
    surface1 = Color(0xFFFFFFFF),
    surface2 = Color(0xFFF0F3F8),
    surface3 = Color(0xFFE8EDF4)
)

val LocalLocalHubColors = staticCompositionLocalOf { DarkLocalHubColors }
