package com.localhub.localhub.ui.theme

import androidx.compose.animation.core.Easing

/**
 * Central animation timing + easing constants for the Compose (Android) UI.
 *
 * These mirror the web animation system in `assets/animations.css` so the whole
 * LocalHub experience speaks one animation language. Never hardcode timings or
 * easings elsewhere — use these tokens.
 *
 * Note: the cubic-bezier curves are implemented locally (via the `Easing`
 * interface) so the module does not depend on the `cubicBezier` helper that is
 * not exposed by the resolved `animation-core` artifact for this Compose version.
 */
object AnimTokens {
    /** Fast micro-interactions (press, ripple, focus). */
    const val FAST_MS = 120

    /** Normal transitions (fade, list items, toggle). */
    const val NORMAL_MS = 220

    /** Slow / entrance transitions. */
    const val SLOW_MS = 380

    /** Springy / emphatic micro-interactions. */
    const val SPRING_MS = 520

    /** Standard (Material 3) easing — cubic-bezier(0.4, 0, 0.2, 1). */
    val StandardEasing: Easing = bezierEasing(0.4f, 0.0f, 0.2f, 1.0f)

    /** Emphasized deceleration — for entrances, cubic-bezier(0.2, 0, 0, 1). */
    val EmphasizedDecel: Easing = bezierEasing(0.2f, 0.0f, 0.0f, 1.0f)

    /** Gentle overshoot — for micro-interactions, cubic-bezier(0.34, 1.56, 0.64, 1). */
    val SpringEasing: Easing = bezierEasing(0.34f, 1.56f, 0.64f, 1.0f)

    /**
     * Builds an [Easing] from a cubic-bezier definition using the same
     * Newton–Raphson solver approach Compose uses for `CubicBezierEasing`.
     */
    private fun bezierEasing(
        x1: Float, y1: Float,
        x2: Float, y2: Float
    ): Easing = Easing { fraction ->
        if (fraction <= 0f) 0f
        else if (fraction >= 1f) 1f
        else solveCurveX(fraction, x1, x2)
            .let { sampleCurveY(it, y1, y2) }
    }

    private fun sampleCurveX(t: Float, x1: Float, x2: Float): Float {
        val u = 1f - t
        return 3f * u * u * t * x1 + 3f * u * t * t * x2 + t * t * t
    }

    private fun sampleCurveY(t: Float, y1: Float, y2: Float): Float {
        val u = 1f - t
        return 3f * u * u * t * y1 + 3f * u * t * t * y2 + t * t * t
    }

    private fun sampleCurveDerivativeX(t: Float, x1: Float, x2: Float): Float {
        val u = 1f - t
        return 3f * u * u * x1 + 6f * u * t * (x2 - x1) + 3f * t * t * (1f - x2)
    }

    private fun solveCurveX(x: Float, x1: Float, x2: Float): Float {
        var t = x
        for (i in 0 until 8) {
            val xEst = sampleCurveX(t, x1, x2) - x
            val d = sampleCurveDerivativeX(t, x1, x2)
            if (kotlin.math.abs(xEst) < 1e-6f) return t
            if (kotlin.math.abs(d) < 1e-6f) break
            t -= xEst / d
        }
        var start = 0f
        var end = 1f
        t = x
        if (t < start) return start
        if (t > end) return end
        while (start < end) {
            val xEst = sampleCurveX(t, x1, x2)
            if (kotlin.math.abs(xEst - x) < 1e-6f) return t
            if (x > xEst) start = t else end = t
            t = (end - start) * 0.5f + start
        }
        return t
    }
}
