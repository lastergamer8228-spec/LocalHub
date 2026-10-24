package com.localhub.localhub.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.ui.components.LogItem
import com.localhub.localhub.ui.components.SectionHeader
import com.localhub.localhub.ui.viewmodel.LogsViewModel
import com.localhub.localhub.ui.components.ListKeys

@Composable
fun LogsScreen(viewModel: LogsViewModel = viewModel()) {
    val logs by viewModel.logs.collectAsStateWithLifecycle()
    LogsContent(logs = logs, onClear = viewModel::clear)
}

/** Stateless content: clearing is destructive, so it always asks first. */
@Composable
internal fun LogsContent(logs: List<LogEntry>, onClear: () -> Unit) {
    var confirmClear by rememberSaveable { mutableStateOf(false) }
    val errors = logs.count { it.level == LogLevel.ERROR }
    val warnings = logs.count { it.level == LogLevel.WARNING }

    Column(modifier = Modifier.fillMaxSize().testTag("logs-screen")) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                SectionHeader("Activity log")
                Text(
                    "${logs.size} entries · $warnings warning(s) · $errors error(s)",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2, overflow = TextOverflow.Ellipsis
                )
            }
            OutlinedButton(
                onClick = { confirmClear = true },
                enabled = logs.isNotEmpty(),
                modifier = Modifier.testTag("logs-clear")
            ) { Text("Clear") }
        }
        HorizontalDivider()
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("logs-list"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (logs.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "No log entries yet. Server, service and audit events appear here as they happen.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            // Stable keys keep scroll position and item state across updates.
            // The index is part of the key on purpose: entries that never reached
            // Room all share id = 0, and duplicate keys crash LazyColumn.
            itemsIndexed(
                logs,
                key = { index, entry -> ListKeys.log(index, entry) },
                contentType = { _, _ -> "log" }
            ) { _, entry -> LogItem(entry) }
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear activity log?") },
            text = {
                Text("This deletes all ${logs.size} stored log entries from this device. Saved logs cannot be recovered, and new activity may create new entries.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmClear = false
                        onClear() // exactly one destructive call, then the dialog closes
                    },
                    modifier = Modifier.testTag("logs-clear-confirm")
                ) { Text("Delete all") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmClear = false },
                    modifier = Modifier.testTag("logs-clear-cancel")
                ) { Text("Cancel") }
            },
            modifier = Modifier.testTag("logs-clear-dialog")
        )
    }
}
