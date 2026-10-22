package com.localhub.localhub.model

/** Describes a loaded module for UI / API consumption. */
data class ModuleInfo(
    val id: String,
    val name: String,
    val description: String,
    val version: String,
    val enabled: Boolean,
    val registeredAt: Long = 0,
    /** Grouping for the Modules screen: dashboard, files, media, ai, security... */
    val category: String = "system",
    /** What this module can do (shown in the Modules screen). */
    val capabilities: List<String> = emptyList(),
    /** Honest limits / what it does not do (shown in the Modules screen). */
    val limitations: List<String> = emptyList(),
    /** Who can use it: "all", "admin", "user", plus permission notes. */
    val accessibility: String = "all"
)
