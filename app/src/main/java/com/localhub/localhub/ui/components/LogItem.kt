package com.localhub.localhub.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.ui.theme.LocalLocalHubColors
import com.localhub.localhub.util.formatTime

@Composable
fun LogItem(entry: LogEntry) {
    val colors = LocalLocalHubColors.current
    val color = when (entry.level) {
        LogLevel.DEBUG -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        LogLevel.INFO -> colors.accentBlue
        LogLevel.WARNING -> colors.warning
        LogLevel.ERROR -> colors.danger
    }
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(
            formatTime(entry.timestamp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
            modifier = Modifier.width(64.dp)
        )
        Text(
            "[${entry.level.name}]",
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.width(62.dp)
        )
        Text(
            entry.message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
        )
    }
}
