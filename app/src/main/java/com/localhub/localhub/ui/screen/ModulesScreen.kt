package com.localhub.localhub.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.ui.components.ModuleCard
import com.localhub.localhub.ui.viewmodel.ModulesViewModel
import com.localhub.localhub.ui.components.ListKeys

@Composable
fun ModulesScreen(openSequence: Int = 0, viewModel: ModulesViewModel = viewModel()) {
    val modules by viewModel.modules.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    ModulesContent(modules, error, openSequence, viewModel::toggle, viewModel::clearError)
}

/** Stateless data input makes actual Compose layout tests possible without starting a server. */
@Composable
internal fun ModulesContent(
    modules: List<ModuleInfo>,
    error: String?,
    openSequence: Int,
    onToggle: (ModuleInfo) -> Unit,
    onDismissError: () -> Unit = {}
) {
    val features = remember(modules) { ModulePresentation.features(modules) }
    val components = remember(modules) { ModulePresentation.components(modules) }
    val list = rememberLazyListState()
    var handledOpen by rememberSaveable { mutableIntStateOf(-1) }
    var showComponents by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(openSequence) {
        if (handledOpen != openSequence) {
            list.scrollToItem(0)
            handledOpen = openSequence
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compactHeader = maxHeight < 360.dp
        Column(Modifier.fillMaxSize().testTag("modules-screen")) {
            // No side-by-side unbounded paragraphs: the old count could become a
            // character-wide, viewport-tall column and push every feature below it.
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = if (compactHeader) 4.dp else 12.dp).testTag("modules-header"),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val count = "${features.count { it.enabled }} / ${features.size}"
                Text(if (compactHeader) "$count on" else "$count feature switches on",
                    style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!compactHeader) Text("Manage server access. Open a card's details for requirements.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            HorizontalDivider()
            LazyColumn(
                state = list,
                modifier = Modifier.weight(1f).fillMaxWidth().testTag("modules-list"),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (error != null) item(key = "error") {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                            Text(error, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            TextButton(onClick = onDismissError) { Text("Dismiss") }
                        }
                    }
                }
                if (modules.isEmpty()) item(key = "loading") {
                    Text("Loading features…", Modifier.padding(vertical = 16.dp), style = MaterialTheme.typography.bodyMedium)
                }
                items(features, key = { ListKeys.module(ListKeys.FEATURE, it) }, contentType = { "feature" }) { module ->
                    ModuleCard(module, onToggle)
                }
                if (components.isNotEmpty()) {
                    item(key = "components-toggle") {
                        OutlinedButton(onClick = { showComponents = !showComponents }, modifier = Modifier.fillMaxWidth().testTag("components-toggle")) {
                            Text("Components & requirements (${components.size})", Modifier.weight(1f), maxLines = 2)
                            Icon(if (showComponents) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                        }
                    }
                    if (showComponents) {
                        item(key = "components-note") {
                            Text("These components are required or informational. They are not separate feature switches.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        items(components, key = { ListKeys.module(ListKeys.COMPONENT, it) }, contentType = { "component" }) { module -> ModuleCard(module, onToggle) }
                    }
                }
            }
        }
    }
}
