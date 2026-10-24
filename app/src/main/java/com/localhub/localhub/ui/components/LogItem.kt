package com.localhub.localhub.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.ui.theme.LocalLocalHubColors
import com.localhub.localhub.util.formatTime

/**
 * Two-line layout: the metadata row and the message wrap independently, so long
 * messages stay readable at large font scales instead of being clipped.
 */
@Composable
fun LogItem(entry: LogEntry) {
    val colors = LocalLocalHubColors.current
    val color = when (entry.level) {
        LogLevel.DEBUG -> MaterialTheme.colorScheme.onSurfaceVariant
        LogLevel.INFO -> colors.accentBlue
        LogLevel.WARNING -> colors.warning
        LogLevel.ERROR -> colors.danger
    }
    Column(modifier = Modifier.fillMaxWidth().testTag("log-item-${entry.id}"),
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Text(
                formatTime(entry.timestamp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1
            )
            Text(
                entry.level.name,
                style = MaterialTheme.typography.labelSmall,
                color = color,
                maxLines = 1
            )
            // The tag was hidden before; it is what makes an entry traceable.
            Text(
                entry.tag,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }
        Text(
            entry.message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
