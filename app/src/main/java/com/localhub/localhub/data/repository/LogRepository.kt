package com.localhub.localhub.data.repository

import com.localhub.localhub.data.local.toDomain
import com.localhub.localhub.data.local.toEntity
import com.localhub.localhub.data.local.dao.LogDao
import com.localhub.localhub.model.LogEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class LogRepository(private val dao: LogDao) {

    suspend fun insert(entry: LogEntry) = dao.insert(entry.toEntity())

    fun recent(limit: Int = 200): Flow<List<LogEntry>> =
        dao.recent(limit).map { it.map { e -> e.toDomain() } }

    fun all(): Flow<List<LogEntry>> =
        dao.all().map { it.map { e -> e.toDomain() } }

    suspend fun clear() = dao.clear()

    suspend fun pruneOlderThan(before: Long) = dao.deleteOlderThan(before)
}
