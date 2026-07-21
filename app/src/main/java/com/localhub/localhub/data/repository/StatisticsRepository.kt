package com.localhub.localhub.data.repository

import com.localhub.localhub.data.local.toDomain
import com.localhub.localhub.data.local.toEntity
import com.localhub.localhub.data.local.dao.StatisticsDao
import com.localhub.localhub.model.StatisticsSnapshot
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class StatisticsRepository(private val dao: StatisticsDao) {

    suspend fun insert(snapshot: StatisticsSnapshot) = dao.insert(snapshot.toEntity())

    fun recent(limit: Int = 120): Flow<List<StatisticsSnapshot>> =
        dao.recent(limit).map { it.map { e -> e.toDomain() } }

    suspend fun clear() = dao.clear()

    suspend fun pruneOlderThan(before: Long) = dao.deleteOlderThan(before)
}
