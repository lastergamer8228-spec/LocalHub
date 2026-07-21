package com.localhub.localhub.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size

import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.ui.theme.LocalLocalHubColors

@Composable
fun ServerStatusCard(
    status: ServerStatus,
    clientCount: Int,
    onOpenDashboard: () -> Unit
) {
    val colors = LocalLocalHubColors.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                if (status.running) Icons.Filled.CheckCircle else Icons.Filled.Error,
                contentDescription = null,
                tint = if (status.running) colors.success else colors.danger,
                modifier = Modifier.size(34.dp)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    if (status.running) "Running" else "Stopped",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (status.running) {
                    Text(
                        "http://${status.host}:${status.port}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.accentBlue
                    )
                    Text(
                        "$clientCount client(s) connected",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
            }
            if (status.running) {
                Button(onClick = onOpenDashboard) { Text("Open") }
            }
        }
    }
}
