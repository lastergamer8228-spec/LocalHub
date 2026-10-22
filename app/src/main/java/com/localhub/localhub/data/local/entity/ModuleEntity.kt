package com.localhub.localhub.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "modules", primaryKeys = ["id"])
data class ModuleEntity(
    val id: String,
    val name: String,
    val description: String,
    val version: String,
    val enabled: Boolean,
    val registeredAt: Long,
    val category: String = "system",
    val capabilities: String = "",   // JSON/pipe-joined list
    val limitations: String = "",    // JSON/pipe-joined list
    val accessibility: String = "all"
)
