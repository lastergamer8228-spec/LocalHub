package com.localhub.localhub.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.util.formatTime

@Composable
fun ClientCard(
    client: ConnectedClient,
    blocked: Boolean = false,
    restriction: String = "none",
    onBlock: (() -> Unit)? = null,
    onUnblock: (() -> Unit)? = null,
    onRestrict: ((String) -> Unit)? = null
) {
    Card(
        modifier = Modifier.fillMaxWidth().testTag("client-card-${client.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(
                    if (client.protocol == "WebSocket") Icons.Filled.Cloud else Icons.Filled.Language,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp)
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        client.ip,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        client.protocol,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        "UA: ${client.userAgent}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2, overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        "Connected ${formatTime(client.connectedAt)} • Last seen ${formatTime(client.lastActivity)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                        maxLines = 2, overflow = TextOverflow.Ellipsis
                    )
                }
            }

            if (onBlock != null || onUnblock != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    if (blocked && onUnblock != null) {
                        OutlinedButton(onClick = onUnblock, modifier = Modifier.testTag("unblock-${client.id}")) {
                            Text("Unblock", maxLines = 1)
                        }
                    } else if (onBlock != null) {
                        OutlinedButton(onClick = onBlock, modifier = Modifier.testTag("block-${client.id}")) {
                            Text("Block", maxLines = 1)
                        }
                    }
                }
            }

            if (onRestrict != null) {
                val options = listOf("none" to "Files: normal", "RO" to "Files: read-only", "deny" to "Files: denied")
                var expanded by remember { mutableStateOf(false) }
                Box {
                    OutlinedButton(onClick = { expanded = true }, modifier = Modifier.testTag("restrict-${client.id}")) {
                        Text(options.firstOrNull { it.first == restriction }?.second ?: "Files: normal", maxLines = 1)
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        options.forEach { (mode, label) ->
                            DropdownMenuItem(
                                text = { Text(label, maxLines = 1) },
                                onClick = { expanded = false; onRestrict(mode) }
                            )
                        }
                    }
                }
            }
        }
    }
}
