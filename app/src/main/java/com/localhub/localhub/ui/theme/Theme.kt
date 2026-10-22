package com.localhub.localhub.ui.theme

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = BrandAccent,
    secondary = BrandAccentBlue,
    tertiary = Color(0xFF818CF8),
    background = Color(0xFF0B1220),
    surface = Color(0xFF111A2E),
    surfaceVariant = Color(0xFF1B2740),
    onPrimary = Color(0xFF04140F),
    onBackground = Color(0xFFE5EAF2),
    onSurface = Color(0xFFE5EAF2),
    onSurfaceVariant = Color(0xFFAEB9CC),
    error = BrandDanger
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF0F766E),
    secondary = Color(0xFF0369A1),
    tertiary = Color(0xFF4F46E5),
    background = Color(0xFFF4F7FB),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE6ECF4),
    onPrimary = Color(0xFFFFFFFF),
    onBackground = Color(0xFF0B1220),
    onSurface = Color(0xFF0B1220),
    onSurfaceVariant = Color(0xFF41526B),
    error = Color(0xFFB91C1C)
)

@Composable
fun LocalHubTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit
) {
    CompositionLocalProvider(LocalLocalHubColors provides if (darkTheme) DarkLocalHubColors else LightLocalHubColors) {
        // Crossfade the whole UI on theme changes so switching light/dark animates
        // smoothly instead of snapping. Colors are derived inside the content so
        // the outgoing and incoming states crossfade between the two schemes.
        Crossfade(
            targetState = darkTheme,
            animationSpec = tween(AnimTokens.SLOW_MS, easing = AnimTokens.StandardEasing)
        ) { isDark ->
            val scheme = if (isDark) DarkColorScheme else LightColorScheme
            val colors = if (isDark) DarkLocalHubColors else LightLocalHubColors
            CompositionLocalProvider(LocalLocalHubColors provides colors) {
                MaterialTheme(
                    colorScheme = scheme,
                    typography = LocalHubTypography,
                    content = content
                )
            }
        }
    }
}
