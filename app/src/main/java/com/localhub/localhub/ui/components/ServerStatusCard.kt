package com.localhub.localhub.ui.components

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
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
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (status.running) Icons.Filled.CheckCircle else Icons.Filled.Error, null,
                    tint = if (status.running) colors.success else colors.danger, modifier = Modifier.size(30.dp))
                Text(if (status.running) "Server running" else "Server stopped", style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (status.running) {
                val url = "${status.protocol}://${status.host}:${status.port}"
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clickable {
                                clipboardManager.setText(AnnotatedString(url))
                                Toast.makeText(context, "URL copied to clipboard", Toast.LENGTH_SHORT).show()
                            }
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                url,
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.accentBlue,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Icon(
                                Icons.Filled.ContentCopy,
                                contentDescription = "Copy URL",
                                tint = colors.accentBlue.copy(alpha = 0.7f),
                                modifier = Modifier.size(14.dp)
                            )
                        }
                        Text("$clientCount recent connection(s)", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                    IconButton(
                        onClick = {
                            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, url)
                            }
                            context.startActivity(Intent.createChooser(shareIntent, "Share LocalHub URL"))
                        },
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            Icons.Filled.Share,
                            contentDescription = "Share URL",
                            tint = colors.accentBlue
                        )
                    }
                }
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
