package com.localhub.localhub.ui.screen

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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

@Composable
fun DashboardScreen(viewModel: DashboardViewModel = viewModel()) {
    val systemInfo by viewModel.systemInfo.collectAsStateWithLifecycle()
    val status by viewModel.serverStatus.collectAsStateWithLifecycle()
    val clients by viewModel.clients.collectAsStateWithLifecycle()
    val logs by viewModel.logs.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { SectionHeader("Server") }
        item {
            ServerStatusCard(
                status = status,
                clientCount = clients.size,
                onOpenDashboard = { openDashboard(context, status) }
            )
        }
        item { SectionHeader("System") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                systemInfo?.let { info ->
                    val colors = LocalLocalHubColors.current
                    StatCard(
                        title = "CPU",
                        value = "%.1f%%".format(info.cpu.usagePercent),
                        subtitle = "${info.cpu.cores} cores • ${info.cpu.model}",
                        progress = info.cpu.usagePercent / 100f,
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
        item { SectionHeader("Recent Logs") }
        items(logs) { LogItem(it) }
    }
}

private fun openDashboard(context: Context, status: ServerStatus) {
    if (!status.running) return
    val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("http://127.0.0.1:${status.port}"))
    context.startActivity(intent)
}
