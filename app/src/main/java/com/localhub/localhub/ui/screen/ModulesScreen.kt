package com.localhub.localhub.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.ui.components.ModuleCard
import com.localhub.localhub.ui.components.SectionHeader
import com.localhub.localhub.ui.viewmodel.ModulesViewModel

@Composable
fun ModulesScreen(viewModel: ModulesViewModel = viewModel()) {
    val modules by viewModel.modules.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { SectionHeader("Modules") }
        items(modules) { ModuleCard(it, onToggle = viewModel::toggle) }
    }
}
