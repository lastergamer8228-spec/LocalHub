package com.localhub.localhub.ui.motion

import android.content.ContentResolver
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Motion tokens for the Android controller.
 *
 * One place decides how long anything takes and how it eases, so the whole app
 * moves with the same accent. Durations mirror the web dashboard's motion.css,
 * which means a screen and a page describing the same event feel like the same
 * product instead of two apps that happen to share a name.
 *
 * The tokens are deliberately conservative. This is a utility, not a showreel:
 * motion here exists to make state changes legible, and a 900ms flourish on a
 * button the user taps twenty times a day is a tax, not a feature.
 */
object LocalHubMotion {

    /** Micro feedback: presses, ticks, value changes. */
    const val FAST = 160

    /** Standard transition: entrances, tab changes, small expands. */
    const val BASE = 260

    /** Emphasis: a card appearing, a section opening. */
    const val SLOW = 420

    /** Reserved for state changes worth noticing: the server coming up. */
    const val SLOWER = 720

    /** Steady breathing pulse while the server is online. */
    const val PULSE = 1400

    /** Delay between staggered children. */
    const val STAGGER_STEP = 40

    val Standard: Easing = CubicBezierEasing(0.22f, 0.61f, 0.36f, 1f)
    val EaseOut: Easing = CubicBezierEasing(0.16f, 1f, 0.30f, 1f)
    val EaseIn: Easing = CubicBezierEasing(0.55f, 0f, 0.55f, 0.20f)

    /** Slight overshoot - used only for things that "land": toasts, checkmarks. */
    val Spring: Easing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
}

/**
 * True when the user has asked the system to stop animating.
 *
 * Read from the global animator scale rather than a bespoke setting: it is the
 * switch the user already knows, it covers TalkBack and developer options, and
 * it costs one ContentResolver read that we cache per composition.
 */
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
