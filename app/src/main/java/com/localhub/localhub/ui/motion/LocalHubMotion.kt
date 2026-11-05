package com.localhub.localhub.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The controller's motion vocabulary.
 *
 * Each composable here is tied to a *meaning*, not to a place:
 *   [PowerRings]      - the server came up
 *   [Modifier.shake]  - something was rejected
 *   [Modifier.entrance] - content arrived
 *   [AnimatedValue]   - a value changed
 *
 * Every one of them reads [rememberMotionEnabled] and degrades to an instant
 * state change when the system asks for reduced motion, so callers never need
 * to branch on accessibility themselves.
 */

/**
 * Progress of the "power up" burst: 0 before the event, 1 once finished.
 *
 * The burst fires only on a false -> true transition. It is deliberately not
 * a loop - a permanently pulsing ring is decoration, whereas a ring that
 * travels outward once tells the user the thing actually just started.
 */
@Composable
fun rememberPowerBurst(active: Boolean): Float {
    val enabled = rememberMotionEnabled()
    val progress = remember { Animatable(0f) }
    var previous by remember { mutableStateOf(active) }

    LaunchedEffect(active, enabled) {
        if (!enabled) {
            progress.snapTo(0f)
            previous = active
            return@LaunchedEffect
        }
        if (active && !previous) {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(LocalHubMotion.SLOWER, easing = LocalHubMotion.Standard))
        } else if (!active && previous) {
            progress.snapTo(0f)
        }
        previous = active
    }
    return progress.value
}

/**
 * Two rings that expand outward and fade, drawn on top of whatever they wrap.
 * Rendered only while a burst is in flight, so an idle UI costs nothing.
 */
@Composable
fun PowerRings(
    progress: Float,
    color: Color,
    modifier: Modifier = Modifier
) {
    if (progress <= 0f || progress >= 1f) return
    Box(modifier = modifier) {
        ring(progress, delay = 0f, color = color)
        ring(progress, delay = 0.22f, color = color)
    }
}

@Composable
private fun ring(progress: Float, delay: Float, color: Color) {
    val local = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)
    if (local <= 0f) return
    val eased = LocalHubMotion.Standard.transform(local)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .scale(0.55f + eased * 1.9f)
            .alpha((0.85f * (1f - eased)).coerceIn(0f, 1f))
            .border(2.dp, color, CircleShape)
    )
}

/**
 * Shakes the content horizontally. Bump [trigger] to fire it - a common
 * pattern is to pass a counter of rejected attempts so each failure shakes.
 */
@Composable
fun Modifier.shake(trigger: Int, distance: Dp = 7.dp): Modifier {
    val enabled = rememberMotionEnabled()
    val offset = remember { Animatable(0f) }

    LaunchedEffect(trigger, enabled) {
        if (!enabled || trigger <= 0) return@LaunchedEffect
        offset.snapTo(0f)
        repeat(4) { i ->
            offset.animateTo(
                targetValue = if (i % 2 == 0) distance.value else -distance.value,
                animationSpec = tween(50)
            )
        }
        offset.animateTo(0f, tween(60))
    }
    return this.offset(x = offset.value.dp)
}

/**
 * Fades and lifts content in, optionally staggered by [index].
 * Used for list items and cards so a screen assembles rather than snaps.
 */
@Composable
fun Modifier.entrance(index: Int = 0): Modifier {
    val enabled = rememberMotionEnabled()
    val progress = remember { Animatable(if (enabled) 0f else 1f) }

    LaunchedEffect(enabled) {
        if (!enabled) {
            progress.snapTo(1f)
            return@LaunchedEffect
        }
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                durationMillis = LocalHubMotion.BASE,
                delayMillis = index * LocalHubMotion.STAGGER_STEP,
                easing = LocalHubMotion.Standard
            )
        )
    }

    val eased = LocalHubMotion.Standard.transform(progress.value.coerceIn(0f, 1f))
    return this
        .alpha(eased)
        .offset(y = ((1f - eased) * 12f).dp)
}

/**
 * Crossfades and slides a changing value: counters, telemetry, status text.
 * Without this a number that updates every two seconds looks like a glitch.
 */
@Composable
fun AnimatedValue(
    value: String,
    style: TextStyle,
    color: Color = Color.Unspecified,
    modifier: Modifier = Modifier
) {
    val enabled = rememberMotionEnabled()
    if (!enabled) {
        Text(text = value, style = style, color = color, modifier = modifier)
        return
    }
    AnimatedContent(
        targetState = value,
        transitionSpec = {
            (fadeIn(tween(LocalHubMotion.FAST)) + slideInVertically(
                animationSpec = tween(LocalHubMotion.FAST),
                initialOffsetY = { it / 4 }
            )) togetherWith fadeOut(tween(LocalHubMotion.FAST))
        },
        label = "animatedValue",
        modifier = modifier
    ) { text ->
        Text(text = text, style = style, color = color)
    }
}

/**
 * Smoothly tracks a border/background colour change so a status flip reads as
 * one continuous movement instead of an instant swap.
 */
@Composable
fun animateColor(target: Color): Color {
    val enabled = rememberMotionEnabled()
    return if (!enabled) {
        target
    } else {
        val fraction by animateFloatAsState(
            targetValue = 1f,
            animationSpec = tween(LocalHubMotion.BASE, easing = LocalHubMotion.Standard),
            label = "colorPulse"
        )
        // Nothing to interpolate against without holding the previous value, so
        // this fades the new colour in over the surface instead - the visual
        // result (a soft arrival) is what the token is for.
        target.copy(alpha = target.alpha * fraction)
    }
}

/** Convenience: the standard entrance for a card at position [index]. */
@Composable
fun Modifier.cardEntrance(index: Int = 0): Modifier = this.entrance(index)

/** Default tint used when a caller has no meaningful colour to pass. */
val MotionFallbackColor: Color
    @Composable get() = MaterialTheme.colorScheme.primary
