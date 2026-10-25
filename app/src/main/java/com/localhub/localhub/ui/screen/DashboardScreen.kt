package com.localhub.localhub.ui.screen

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.DeveloperBoard
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.ui.components.LogItem
import com.localhub.localhub.ui.components.SectionHeader
import com.localhub.localhub.ui.components.ServerStatusCard
import com.localhub.localhub.ui.components.StatCard
import com.localhub.localhub.ui.theme.LocalLocalHubColors
import com.localhub.localhub.ui.viewmodel.DashboardViewModel
import com.localhub.localhub.util.formatBytes
import com.localhub.localhub.ui.components.ListKeys

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Composable
fun DashboardScreen(viewModel: DashboardViewModel = viewModel(), onManageServer: (() -> Unit)? = null) {
    val systemInfo by viewModel.systemInfo.collectAsStateWithLifecycle()
    val status by viewModel.serverStatus.collectAsStateWithLifecycle()
    val clients by viewModel.clients.collectAsStateWithLifecycle()
    val logs by viewModel.logs.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("home-screen"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.2f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            "LocalHub Controller",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            "Private Cloud • LAN Media & Tools",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    val colors = LocalLocalHubColors.current
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (status.running) colors.success.copy(alpha = 0.15f)
                                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
                    ) {
                        Text(
                            text = if (status.running) "ONLINE" else "STANDBY",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (status.running) colors.success
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                            letterSpacing = 1.sp,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }
            }
        }
        item { SectionHeader("Server") }
        item {
            ServerStatusCard(
                status = status,
                clientCount = clients.size,
                onOpenDashboard = { openDashboard(context, status) },
                onManageServer = onManageServer
            )
        }
        item { SectionHeader("System") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                systemInfo?.let { info ->
                    val colors = LocalLocalHubColors.current
                    StatCard(
                        title = "CPU",
                        value = if (info.cpu.available) "%.1f%%".format(info.cpu.usagePercent) else "Unavailable",
                        subtitle = "${info.cpu.cores} cores • ${info.cpu.model}",
                        progress = if (info.cpu.available) info.cpu.usagePercent / 100f else null,
                        accent = colors.cpu,
                        icon = Icons.Filled.DeveloperBoard
                    )
                    StatCard(
                        title = "Memory",
                        value = formatBytes(info.memory.usedBytes),
                        subtitle = "of ${formatBytes(info.memory.totalBytes)}",
                        progress = info.memory.usagePercent / 100f,
                        accent = colors.memory,
                        icon = Icons.Filled.Memory
                    )
                    StatCard(
                        title = "Storage",
                        value = formatBytes(info.storage.usedBytes),
                        subtitle = "of ${formatBytes(info.storage.totalBytes)}",
                        progress = info.storage.usagePercent / 100f,
                        accent = colors.storage,
                        icon = Icons.Filled.Storage
                    )
                    StatCard(
                        title = "Battery",
                        value = "${info.battery.level}%",
                        subtitle = if (info.battery.isCharging) "Charging" else "Discharging",
                        progress = info.battery.level / 100f,
                        accent = colors.battery,
                        icon = Icons.Filled.BatteryFull
                    )
                    StatCard(
                        title = "Network",
                        value = info.network.type,
                        subtitle = "${info.network.ipAddress}${
                            if (info.network.ssid.isNotBlank()) " • ${info.network.ssid}" else ""
                        }",
                        accent = colors.network,
                        icon = Icons.Filled.Wifi
                    )
                } ?: Text(
                    "Collecting system information…",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
        }
        item { SectionHeader("Recent activity") }
        if (logs.isEmpty()) {
            item {
                Text(
                    "No activity captured in this app session yet. The Activity tab shows stored history.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
        }
        val recentLogs = logs.take(5)
        itemsIndexed(
            recentLogs,
            key = { index, entry -> ListKeys.log(index, entry) },
            contentType = { _, _ -> "log" }
        ) { _, entry -> LogItem(entry) }
        if (logs.size > 5) {
            item {
                Text(
                    "Showing latest 5 of ${logs.size} events. Full history is stored in the Activity tab.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                    modifier = Modifier.padding(vertical = 4.dp)
                )
            }
        }
    }
}

private fun openDashboard(context: Context, status: ServerStatus) {
    if (!status.running) return
    val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("${status.protocol}://127.0.0.1:${status.port}"))
    context.startActivity(intent)
}
