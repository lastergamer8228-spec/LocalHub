package com.localhub.localhub.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.ui.theme.LocalLocalHubColors

@Composable
fun ServerStatusCard(
    status: ServerStatus,
    clientCount: Int,
    onOpenDashboard: () -> Unit,
    onManageServer: (() -> Unit)? = null
) {
    val colors = LocalLocalHubColors.current
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (status.running) Icons.Filled.CheckCircle else Icons.Filled.Error, null,
                    tint = if (status.running) colors.success else colors.danger, modifier = Modifier.size(30.dp))
                Text(if (status.running) "Server running" else "Server stopped", style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (status.running) {
                Text("${status.protocol}://${status.host}:${status.port}", style = MaterialTheme.typography.bodyMedium,
                    color = colors.accentBlue, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("$clientCount recent connection(s)", style = MaterialTheme.typography.bodySmall, maxLines = 2)
            } else {
                Text("Open Server settings to start the host.", style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            // Navigation lives here; Start/Stop/Restart have one home in Settings.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                if (status.running) Button(onClick = onOpenDashboard, modifier = Modifier.weight(1f)) {
                    Text("Open dashboard", maxLines = 2)
                }
                if (onManageServer != null) OutlinedButton(onClick = onManageServer, modifier = Modifier.weight(1f)) {
                    Text("Server settings", maxLines = 2)
                }
            }
        }
    }
}
