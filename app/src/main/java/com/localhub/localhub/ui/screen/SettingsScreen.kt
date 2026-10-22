package com.localhub.localhub.ui.screen

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.model.SystemInfo
import com.localhub.localhub.ui.components.PremiumButton
import com.localhub.localhub.ui.components.PremiumCard
import com.localhub.localhub.ui.components.PremiumSwitch
import com.localhub.localhub.ui.components.PremiumTextField
import com.localhub.localhub.ui.components.SectionHeader
import com.localhub.localhub.ui.components.SegmentSelector
import com.localhub.localhub.ui.theme.LocalLocalHubColors
import com.localhub.localhub.ui.viewmodel.SettingsViewModel
import kotlinx.coroutines.delay

@Composable
fun SettingsScreen(viewModel: SettingsViewModel = viewModel()) {
    val running by viewModel.running.collectAsStateWithLifecycle()
    val status by viewModel.serverStatus.collectAsStateWithLifecycle()
    val theme by viewModel.theme.collectAsStateWithLifecycle()
    val autostart by viewModel.autostart.collectAsStateWithLifecycle()
    val serverName by viewModel.serverName.collectAsStateWithLifecycle()
    val httpsEnabled by viewModel.httpsEnabled.collectAsStateWithLifecycle()
    val auditEnabled by viewModel.auditEnabled.collectAsStateWithLifecycle()
    val sys by viewModel.systemInfo.collectAsStateWithLifecycle()
    val clientCount by viewModel.connectedClients.collectAsStateWithLifecycle()

    var nameText by remember { mutableStateOf(serverName) }

    // Ticking clock for live uptime.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }

    val hostname = viewModel.friendlyHostname()
    val ip = sys?.network?.ipAddress ?: status.host
    val baseUrl = "http://$ip:${status.port}"
    val haptics = LocalHapticFeedback.current
    // Captured in the composable body so it can be used inside onClick lambdas.
    val clipboard = LocalClipboardManager.current

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item { LiveStatusStrip(sys, status, now, clientCount) }

        item { SectionHeader("Server") }
        item { ServerCard(running, status, sys, hostname, baseUrl, viewModel) }

        item { SectionHeader("Server Identity") }
        item {
            PremiumCard {
                PremiumTextField(
                    value = nameText,
                    onValueChange = { nameText = it },
                    label = "Server Name"
                )
                PremiumTextField(
                    value = hostname,
                    onValueChange = {},
                    label = "Friendly Hostname",
                    supportingText = "mDNS hostname on your local network"
                )
                PremiumTextField(
                    value = "$baseUrl",
                    onValueChange = {},
                    label = "Friendly URL",
                    supportingText = "Open this from any device on the network"
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    PremiumButton(
                        text = "Save Name",
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setServerName(nameText) }
                    )
                    PremiumButton(
                        text = "Copy URL",
                        modifier = Modifier.weight(1f),
                        accent = LocalLocalHubColors.current.accentBlue,
                        leadingIcon = { Icon(Icons.Default.ContentCopy, null, Modifier.padding(end = 2.dp)) },
                        onClick = {
                            haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                            clipboard.setText(AnnotatedString(baseUrl))
                        }
                    )
                }
            }
        }

        item { SectionHeader("Appearance") }
        item {
            PremiumCard {
                Text("Theme", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                SegmentSelector(
                    options = listOf("dark" to "Dark", "light" to "Light", "system" to "System"),
                    selected = theme,
                    onSelect = { viewModel.setTheme(it) }
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("Autostart on boot", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Launch the server when the device starts",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                    PremiumSwitch(checked = autostart, onCheckedChange = { viewModel.setAutostart(it) })
                }
            }
        }

        item { SectionHeader("Security") }
        item {
            PremiumCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("HTTPS (self-signed)", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Encrypt local traffic. Note: browsers warn on the self-signed cert.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                    PremiumSwitch(checked = httpsEnabled, onCheckedChange = { viewModel.setHttpsEnabled(it) })
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("Security audit events", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Log failed logins and permission denials to the Activity Timeline / logs.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                    PremiumSwitch(checked = auditEnabled, onCheckedChange = { viewModel.setAuditEnabled(it) })
                }
            }
        }

        item { SectionHeader("Quick Actions") }
        item {
            PremiumCard {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PremiumButton("Restart Server", modifier = Modifier.weight(1f), onClick = { viewModel.restartServer() })
                    PremiumButton("Stop Server", modifier = Modifier.weight(1f), accent = LocalLocalHubColors.current.danger, onClick = { viewModel.stopServer() })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PremiumButton("Restart Assets", modifier = Modifier.weight(1f), onClick = { viewModel.restartServer() })
                    PremiumButton("Restart Media", modifier = Modifier.weight(1f), onClick = { viewModel.restartServer() })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PremiumButton("Clear Cache", modifier = Modifier.weight(1f), onClick = { viewModel.restartServer() })
                    PremiumButton("Clear Logs", modifier = Modifier.weight(1f), onClick = { viewModel.clearLogs() })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PremiumButton("Backup Config", modifier = Modifier.weight(1f), enabled = false, onClick = {})
                    PremiumButton("Restore Config", modifier = Modifier.weight(1f), enabled = false, onClick = {})
                    PremiumButton("Export Logs", modifier = Modifier.weight(1f), enabled = false, onClick = {})
                }
            }
        }

        item { SectionHeader("About") }
        item {
            PremiumCard {
                InfoRow2("App Version", status.version)
                InfoRow2("Build", Build.VERSION.INCREMENTAL.ifBlank { "-" })
                InfoRow2("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                InfoRow2("Device Model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                InfoRow2("CPU", sys?.cpu?.model ?: "-")
                InfoRow2("RAM", sys?.memory?.let { fmtBytes(it.totalBytes) } ?: "-")
                InfoRow2("Storage", sys?.storage?.let { fmtBytes(it.totalBytes) } ?: "-")
                InfoRow2("Architecture", Build.SUPPORTED_ABIS.firstOrNull() ?: "-")
                InfoRow2("Developer", "LocalHub Team")
            }
        }
    }
}

@Composable
private fun LiveStatusStrip(sys: SystemInfo?, status: ServerStatus, now: Long, clientCount: Int) {
    val c = LocalLocalHubColors.current
    val uptime = if (status.startedAt > 0) now - status.startedAt else 0L
    PremiumCard {
        Text("Live Status", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Stat("CPU", sys?.cpu?.usagePercent?.let { "${it.toInt()}%" } ?: "-", c.cpu, Modifier.weight(1f))
            Stat("RAM", sys?.memory?.let { "${it.usagePercent.toInt()}%" } ?: "-", c.memory, Modifier.weight(1f))
            Stat("Storage", sys?.storage?.let { "${it.usagePercent.toInt()}%" } ?: "-", c.storage, Modifier.weight(1f))
            Stat("Battery", sys?.battery?.let { "${it.level}%" } ?: "-", c.battery, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Stat("Temp", sys?.battery?.let { "${it.temperatureCelsius}°" } ?: "-", c.warning, Modifier.weight(1f))
            Stat("Net", sys?.network?.type ?: "-", c.network, Modifier.weight(1f))
            Stat("Clients", clientCount.toString(), c.accentBlue, Modifier.weight(1f))
            Stat("Uptime", fmtDuration(uptime), c.accent, Modifier.weight(1f))
        }
    }
}

@Composable
private fun Stat(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.4f))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun ServerCard(
    running: Boolean,
    status: ServerStatus,
    sys: SystemInfo?,
    hostname: String,
    baseUrl: String,
    viewModel: SettingsViewModel
) {
    val c = LocalLocalHubColors.current
    val dotColor = if (running) c.success else c.danger
    // Captured in this composable's body for use inside the Copy URL onClick.
    val clipboard = LocalClipboardManager.current
    PremiumCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .clip(CircleShape)
                    .background(dotColor)
                    .padding(6.dp)
            )
            Column {
                Text(
                    if (running) "Online" else "Offline",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = dotColor
                )
                Text("LocalHub Server", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
        }
        InfoRow2("Server Version", status.version)
        InfoRow2("IP", status.host.ifEmpty { "-" })
        InfoRow2("Hostname", hostname)
        InfoRow2("Port", status.port.toString())
        InfoRow2("Running Since", if (status.startedAt > 0) fmtDate(status.startedAt) else "-")
        InfoRow2("Uptime", fmtDuration(if (status.startedAt > 0) System.currentTimeMillis() - status.startedAt else 0))
        InfoRow2("Android", "${sys?.device?.androidVersion ?: Build.VERSION.RELEASE}")
        InfoRow2("Device Name", "${sys?.device?.manufacturer ?: Build.MANUFACTURER} ${sys?.device?.model ?: Build.MODEL}".trim())

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PremiumButton(
                text = "Copy URL",
                modifier = Modifier.weight(1f),
                leadingIcon = { Icon(Icons.Default.ContentCopy, null, Modifier.padding(end = 2.dp)) },
                onClick = { clipboard.setText(AnnotatedString(baseUrl)) }
            )
            PremiumButton(
                text = "Open Browser",
                modifier = Modifier.weight(1f),
                accent = LocalLocalHubColors.current.accentBlue,
                leadingIcon = { Icon(Icons.Default.OpenInBrowser, null, Modifier.padding(end = 2.dp)) },
                onClick = { viewModel.openBrowser(baseUrl) }
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PremiumButton(
                text = "Generate QR",
                modifier = Modifier.weight(1f),
                leadingIcon = { Icon(Icons.Default.QrCode2, null, Modifier.padding(end = 2.dp)) },
                onClick = { viewModel.openBrowser(baseUrl) }
            )
            PremiumButton(
                text = "Restart",
                modifier = Modifier.weight(1f),
                accent = LocalLocalHubColors.current.accentBlue,
                onClick = { viewModel.restartServer() }
            )
            PremiumButton(
                text = "Stop",
                modifier = Modifier.weight(1f),
                accent = LocalLocalHubColors.current.danger,
                onClick = { viewModel.stopServer() }
            )
        }
    }
}

@Composable
private fun InfoRow2(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

private fun fmtBytes(b: Long): String {
    val u = arrayOf("B", "KB", "MB", "GB", "TB")
    var v = b.toDouble(); var i = 0
    while (v >= 1024 && i < u.size - 1) { v /= 1024; i++ }
    return "%.1f %s".format(v, u[i])
}

private fun fmtDuration(ms: Long): String {
    if (ms <= 0) return "-"
    var s = ms / 1000
    val d = s / 86400; s %= 86400
    val h = s / 3600; s %= 3600
    val m = s / 60; s %= 60
    val parts = mutableListOf<String>()
    if (d > 0) parts.add("${d}d")
    if (h > 0) parts.add("${h}h")
    if (m > 0) parts.add("${m}m")
    parts.add("${s}s")
    return parts.joinToString(" ")
}

private fun fmtDate(ms: Long): String =
    java.text.SimpleDateFormat("MMM d, HH:mm", java.util.Locale.getDefault()).format(java.util.Date(ms))
