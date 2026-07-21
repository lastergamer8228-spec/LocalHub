package com.localhub.localhub.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "statistics")
data class StatisticsEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val cpuUsage: Float,
    val memoryUsed: Long,
    val memoryTotal: Long,
    val batteryLevel: Int,
    val batteryTempC: Float,
    val storageUsed: Long,
    val storageTotal: Long,
    val networkType: String,
    val connectedClients: Int
)
