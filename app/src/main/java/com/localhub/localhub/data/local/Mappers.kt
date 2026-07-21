package com.localhub.localhub.data.local

import com.localhub.localhub.data.local.entity.LogEntity
import com.localhub.localhub.data.local.entity.ModuleEntity
import com.localhub.localhub.data.local.entity.SettingEntity
import com.localhub.localhub.data.local.entity.StatisticsEntity
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.model.StatisticsSnapshot

fun LogEntity.toDomain(): LogEntry = LogEntry(
    id = id,
    timestamp = timestamp,
    level = runCatching { LogLevel.valueOf(level) }.getOrDefault(LogLevel.INFO),
    tag = tag,
    message = message
)

fun LogEntry.toEntity(): LogEntity = LogEntity(
    id = id,
    timestamp = timestamp,
    level = level.name,
    tag = tag,
    message = message
)

fun ModuleEntity.toDomain(): ModuleInfo = ModuleInfo(
    id = id,
    name = name,
    description = description,
    version = version,
    enabled = enabled,
    registeredAt = registeredAt
)

fun ModuleInfo.toEntity(): ModuleEntity = ModuleEntity(
    id = id,
    name = name,
    description = description,
    version = version,
    enabled = enabled,
    registeredAt = registeredAt
)

fun StatisticsEntity.toDomain(): StatisticsSnapshot = StatisticsSnapshot(
    timestamp = timestamp,
    cpuUsage = cpuUsage,
    memoryUsed = memoryUsed,
    memoryTotal = memoryTotal,
    batteryLevel = batteryLevel,
    batteryTempC = batteryTempC,
    storageUsed = storageUsed,
    storageTotal = storageTotal,
    networkType = networkType,
    connectedClients = connectedClients
)

fun StatisticsSnapshot.toEntity(): StatisticsEntity = StatisticsEntity(
    timestamp = timestamp,
    cpuUsage = cpuUsage,
    memoryUsed = memoryUsed,
    memoryTotal = memoryTotal,
    batteryLevel = batteryLevel,
    batteryTempC = batteryTempC,
    storageUsed = storageUsed,
    storageTotal = storageTotal,
    networkType = networkType,
    connectedClients = connectedClients
)

fun SettingEntity.toPair(): Pair<String, String> = key to value
