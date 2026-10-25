package com.localhub.localhub.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.QuestionAnswer
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Category
import com.localhub.localhub.model.ModuleInfo

/** Picks a sensible icon per module category. */
private fun iconFor(category: String): ImageVector = when (category.lowercase()) {
    "assistant" -> Icons.Filled.SmartToy
    "system" -> Icons.Filled.Memory
    "security" -> Icons.Filled.Security
    "voice" -> Icons.Filled.Mic
    "communication" -> Icons.Filled.QuestionAnswer
    else -> Icons.Filled.Category
}

@Composable
fun ModuleCard(module: ModuleInfo, onToggle: (ModuleInfo) -> Unit) {
    var expanded by rememberSaveable(module.id) { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth().testTag("module-card-${module.id}"),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.22f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp).animateContentSize()) {
            // Header row: icon + info + toggle.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = iconFor(module.category),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        module.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        if (module.id in com.localhub.localhub.module.ModulePolicy.controllable) {
                            if (module.enabled) "On" else "Off"
                        } else if (module.id == "core.security" || module.id == "core.server") "Required" else "Information only",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (module.id in com.localhub.localhub.module.ModulePolicy.controllable) {
                    Switch(checked = module.enabled, onCheckedChange = { onToggle(module) },
                        modifier = Modifier.testTag("module-switch-${module.id}").semantics { contentDescription = module.name })
                }
            }
            Text(module.description, modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)

            // Expand/collapse for settings detail.
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { expanded = !expanded }.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    if (expanded) "Hide details" else "Show details",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.weight(1f))
                Icon(
                    imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
            }

            if (expanded) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                if (module.id == "core.media") {
                    SettingsSection("Dependency", "File Manager must also be enabled. Already-buffered video/audio may continue briefly after OFF; new server reads are blocked.")
                }
                if (module.id !in com.localhub.localhub.module.ModulePolicy.controllable) {
                    SettingsSection("Control", "Not an independently switchable feature. No on/off control is claimed.")
                }
                SettingsSection("Component", "${module.id} · v${module.version}")
                SettingsSection("Accessibility", module.accessibility)
                if (module.capabilities.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    SettingsList("Capabilities", module.capabilities)
                }
                if (module.limitations.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    SettingsList("Limitations", module.limitations)
                }
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String, value: String) {
    Column {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        )
    }
}

@Composable
private fun SettingsList(title: String, items: List<String>) {
    Column {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary
        )
        items.forEach { item ->
            Text(
                "• $item",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                modifier = Modifier.padding(top = 2.dp)
            )
        }
    }
}
