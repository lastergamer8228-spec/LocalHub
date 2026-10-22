package com.localhub.localhub.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.localhub.localhub.ui.theme.LocalLocalHubColors

/** Rounded, elevated card used across the premium Settings experience. */
@Composable
fun PremiumCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp)
    ) {
        Column(
            modifier = Modifier.padding(18.dp).animateContentSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content
        )
    }
}

/**
 * Tactile button with ripple, press-scale (98%), elevation change, soft glow,
 * haptic feedback, loading spinner and disabled state.
 */
@Composable
fun PremiumButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    accent: Color = MaterialTheme.colorScheme.primary,
    contentColor: Color = MaterialTheme.colorScheme.onPrimary,
    leadingIcon: (@Composable () -> Unit)? = null
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val focused by interaction.collectIsFocusedAsState()
    val haptics = LocalHapticFeedback.current

    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, label = "btnScale")
    val glow by animateFloatAsState(
        if (pressed) 0.30f else if (focused) 0.15f else 0f,
        label = "btnGlow"
    )
    val elevation by animateDpAsState(if (pressed) 2.dp else 8.dp, label = "btnElev")
    val shape = RoundedCornerShape(14.dp)
    val bg = if (enabled) accent else accent.copy(alpha = 0.4f)
    val txtColor = if (enabled) contentColor else contentColor.copy(alpha = 0.6f)

    Box(modifier = modifier.scale(scale)) {
        // soft glow behind the button
        Box(
            modifier = Modifier
                .matchParentSize()
                .clip(shape)
                .background(Brush.radialGradient(listOf(accent.copy(alpha = glow), Color.Transparent)))
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(elevation, shape)
                .clip(shape)
                .background(bg)
                .clickable(
                    interactionSource = interaction,
                    indication = LocalIndication.current,
                    enabled = enabled
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onClick()
                }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = txtColor,
                    strokeWidth = 2.dp
                )
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    leadingIcon?.invoke()
                    Text(text, color = txtColor, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/** Premium animated toggle switch with smooth thumb/track transitions. */
@Composable
fun PremiumSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    accent: Color = LocalLocalHubColors.current.accent
) {
    val interaction = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    val trackWidth = 46.dp
    val thumbSize = 22.dp
    val offset by animateDpAsState(if (checked) trackWidth - thumbSize - 2.dp else 2.dp, label = "thumbX")
    val trackColor by animateColorAsState(
        if (checked) accent else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f),
        label = "trackColor"
    )
    val thumbColor by animateColorAsState(
        if (checked) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        label = "thumbColor"
    )

    Box(
        modifier = modifier
            .size(width = trackWidth, height = thumbSize + 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(trackColor)
            .clickable(
                interactionSource = interaction,
                indication = LocalIndication.current
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onCheckedChange(!checked)
            }
    ) {
        Box(
            modifier = Modifier
                .size(thumbSize)
                .offset(x = offset, y = 2.dp)
                .shadow(4.dp, CircleShape)
                .clip(CircleShape)
                .background(thumbColor)
        )
    }
}

/** Premium text field with focused border + label accent. */
@Composable
fun PremiumTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    supportingText: String? = null,
    leadingIcon: (@Composable () -> Unit)? = null
) {
    val shape = RoundedCornerShape(14.dp)
    val accent = LocalLocalHubColors.current.accentBlue
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        modifier = modifier,
        shape = shape,
        keyboardOptions = keyboardOptions,
        leadingIcon = leadingIcon,
        supportingText = supportingText?.let { { Text(it) } },
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = accent,
            unfocusedBorderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f),
            focusedLabelColor = accent,
            cursorColor = accent,
            focusedContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.4f),
            unfocusedContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.25f)
        )
    )
}

/** Animated segmented selector (e.g. Dark / Light / System). */
@Composable
fun SegmentSelector(
    options: List<Pair<String, String>>, // (key, label)
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        options.forEach { (key, label) ->
            val isSel = selected == key
            val bg by animateColorAsState(
                if (isSel) LocalLocalHubColors.current.accent else Color.Transparent,
                label = "segBg"
            )
            val tc by animateColorAsState(
                if (isSel) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                label = "segText"
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(11.dp))
                    .background(bg)
                    .clickable { onSelect(key) }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(label, color = tc, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
