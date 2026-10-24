package com.localhub.localhub.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.ui.components.ClientCard
import com.localhub.localhub.ui.viewmodel.ClientsViewModel
import com.localhub.localhub.ui.components.ListKeys

@Composable
fun ClientsScreen(viewModel: ClientsViewModel = viewModel()) {
    val clients by viewModel.clients.collectAsStateWithLifecycle()
    val blocked by viewModel.blocked.collectAsStateWithLifecycle()
    val restrictions by viewModel.restrictions.collectAsStateWithLifecycle()
    val feedback by viewModel.feedback.collectAsStateWithLifecycle()
    ClientsContent(
        clients = clients,
        blocked = blocked,
        restrictions = restrictions,
        feedback = feedback,
        onBlock = viewModel::block,
        onUnblock = viewModel::unblock,
        onRestrict = viewModel::restrict,
        onDismissFeedback = viewModel::clearFeedback
    )
}

/**
 * Stateless content. Restrictive changes (block, read-only, deny) always ask
 * first because they cut off a device; restoring access applies immediately.
 */
@Composable
internal fun ClientsContent(
    clients: List<ConnectedClient>,
    blocked: Set<String>,
    restrictions: Map<String, String>,
    feedback: String? = null,
    onBlock: (String) -> Unit,
    onUnblock: (String) -> Unit,
    onRestrict: (String, String) -> Unit,
    onDismissFeedback: () -> Unit = {}
) {
    var pendingBlock by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingRestrict by rememberSaveable { mutableStateOf<Pair<String, String>?>(null) }

    Column(modifier = Modifier.fillMaxSize().testTag("clients-screen")) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                "${clients.size} recent connection(s)",
                style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis
            )
            Text(
                "Browser tabs stay listed while connected; plain HTTP devices can remain listed for about a minute after their last request.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3, overflow = TextOverflow.Ellipsis
            )
        }
        HorizontalDivider()
        if (feedback != null) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(feedback, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 3)
                    TextButton(onClick = onDismissFeedback) { Text("OK") }
                }
            }
        }
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("clients-list"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (clients.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "No recent connections. Open the dashboard URL from another device on the same network.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            itemsIndexed(
                clients,
                key = { index, client -> ListKeys.client(index, client) },
                contentType = { _, _ -> "client" }
            ) { _, client ->
                ClientCard(
                    client = client,
                    blocked = client.ip in blocked,
                    restriction = restrictions[client.ip] ?: "none",
                    onBlock = { pendingBlock = client.ip },
                    onUnblock = { onUnblock(client.ip) },
                    onRestrict = { mode ->
                        if (mode == "none") onRestrict(client.ip, mode) else pendingRestrict = client.ip to mode
                    }
                )
            }
        }
    }

    pendingBlock?.let { ip ->
        AlertDialog(
            onDismissRequest = { pendingBlock = null },
            title = { Text("Block $ip?") },
            text = { Text("This device will be refused by LocalHub until you unblock it. Connected clients may need to reconnect.") },
            confirmButton = {
                TextButton(
                    onClick = { pendingBlock = null; onBlock(ip) },
                    modifier = Modifier.testTag("block-confirm")
                ) { Text("Block device") }
            },
            dismissButton = {
                TextButton(onClick = { pendingBlock = null }, modifier = Modifier.testTag("block-cancel")) { Text("Cancel") }
            },
            modifier = Modifier.testTag("block-dialog")
        )
    }

    pendingRestrict?.let { (ip, mode) ->
        AlertDialog(
            onDismissRequest = { pendingRestrict = null },
            title = { Text(if (mode == "deny") "Deny file access for $ip?" else "Limit $ip to read-only?") },
            text = { Text("This changes what that device can do with your files. You can restore full access at any time.") },
            confirmButton = {
                TextButton(onClick = { pendingRestrict = null; onRestrict(ip, mode) }) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { pendingRestrict = null }) { Text("Cancel") } }
        )
    }
}
