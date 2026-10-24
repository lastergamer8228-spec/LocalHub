package com.localhub.localhub.ui.screen

import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.module.ModulePolicy

/** Stable order: toggling a feature must not move the card under the user's finger. */
internal object ModulePresentation {
    private val order = listOf("files", "core.media", "ai", "core.mirror", "core.device",
        "core.shares", "core.monitor", "core.tts", "dashboard", "core.os")

    fun features(modules: List<ModuleInfo>): List<ModuleInfo> = modules
        .filter { it.id in ModulePolicy.controllable }
        .sortedWith(compareBy<ModuleInfo> { order.indexOf(it.id).let { index -> if (index < 0) Int.MAX_VALUE else index } }
            .thenBy { it.name })

    fun components(modules: List<ModuleInfo>): List<ModuleInfo> = modules
        .filter { it.id !in ModulePolicy.controllable }
        .sortedWith(compareBy<ModuleInfo> { if (it.id in setOf("core.server", "core.security")) 0 else 1 }.thenBy { it.name })
}
