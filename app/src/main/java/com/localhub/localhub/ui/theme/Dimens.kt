package com.localhub.localhub.ui.theme

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Non-colour design tokens for the Android controller.
 *
 * These are the Compose mirror of `assets/dashboard/tokens.css`. The same
 * numbers, the same names, so a card on the phone and a card in the browser
 * are the same object seen through two windows.
 *
 * Before this file existed the UI used 24 distinct dp values with no
 * relationship to each other (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15,
 * 16, 18, 20, 22, 24, 26, 28, 36, 38, 46, 48). Two components placed side by
 * side could not align, because their padding had been chosen independently.
 *
 * Rule: no raw `.dp` in a screen or component. If a value is not here, it is
 * not a token yet — either add it deliberately or use one that exists.
 */

/** Spacing — 8dp grid with a 4dp sub-grid for tight, intra-component gaps. */
object Space {
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 24.dp
    val xxl: Dp = 32.dp
    val xxxl: Dp = 48.dp
    val huge: Dp = 64.dp
}

/** Corner radius. */
object Radius {
    val xs: Dp = 5.dp
    val sm: Dp = 7.dp
    val md: Dp = 10.dp
    val lg: Dp = 14.dp
    val xl: Dp = 18.dp
}

/**
 * Elevation.
 *
 * On a dark surface a shadow is the weakest possible depth cue, so these map
 * to Material 3 tonal elevation levels: a higher level means a lighter
 * surface, not a heavier shadow. [level3] is the only one that also earns a
 * real shadow, because it is the only surface that genuinely floats.
 */
object Elevation {
    val level0: Dp = 0.dp   // canvas
    val level1: Dp = 1.dp   // card, panel
    val level2: Dp = 3.dp   // raised: input, dropdown
    val level3: Dp = 6.dp   // modal / dialog
}

/** Fixed component sizes, on the 8dp grid. */
object Size {
    /** Small control (chips, header actions). */
    val controlSm: Dp = 32.dp
    /** Standard button and input height. */
    val controlMd: Dp = 40.dp
    /** Large / primary action. */
    val controlLg: Dp = 48.dp
    /** Minimum touch target (WCAG 2.2). */
    val touchTarget: Dp = 48.dp

    val iconSm: Dp = 16.dp
    val iconMd: Dp = 20.dp
    val iconLg: Dp = 24.dp

    /** Thickness of a progress / metric bar. */
    val barHeight: Dp = 6.dp
}
