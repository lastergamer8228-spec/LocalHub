package com.localhub.localhub.model

/** Describes a loaded module for UI / API consumption. */
data class ModuleInfo(
    val id: String,
    val name: String,
    val description: String,
    val version: String,
    val enabled: Boolean,
    val registeredAt: Long = 0
)
