package com.localhub.localhub.ui.motion

import android.content.ContentResolver
import android.provider.Settings
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.localhub.localhub.ui.theme.AnimTokens

/**
 * Motion tokens — a facade over [AnimTokens].
 *
 * This file used to declare its own durations and easings, which left the app
 * with two competing motion systems. Everything now resolves to AnimTokens, so
 * there is exactly one place where timing is decided. Callers that import
 * LocalHubMotion keep working; new code should use AnimTokens directly.
 */
object LocalHubMotion {
    /** Micro feedback: press, ripple, focus. */
    const val FAST = AnimTokens.FAST_MS

    /** Standard transition: entrance, toggle. */
    const val BASE = AnimTokens.NORMAL_MS

    /** Emphasis: a card appearing, a section opening. */
    const val SLOW = AnimTokens.SLOW_MS

    /** Reserved for the server coming up. */
    const val SLOWER = AnimTokens.EMPHASIS_MS

    /** Breathing pulse while online. */
    const val PULSE = AnimTokens.PULSE_MS

    /** Delay between staggered children. */
    const val STAGGER_STEP = AnimTokens.STAGGER_STEP_MS

    val Standard: Easing = AnimTokens.StandardEasing
    val EaseOut: Easing = AnimTokens.EmphasizedDecel
    val EaseIn: Easing = AnimTokens.EaseInEasing
    val Spring: Easing = AnimTokens.SpringEasing
}

@Composable
fun rememberMotionEnabled(): Boolean {
    val context = LocalContext.current
    return remember {
        try {
            val resolver: ContentResolver = context.contentResolver
            val scale = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
            scale != 0f
        } catch (e: Exception) {
            // If we cannot read the setting, animate. A missing preference is
            // not a request to remove motion.
            true
        }
    }
}
