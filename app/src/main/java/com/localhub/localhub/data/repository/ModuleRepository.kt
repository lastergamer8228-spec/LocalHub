package com.localhub.localhub.data.repository

import com.localhub.localhub.data.local.toDomain
import com.localhub.localhub.data.local.toEntity
import com.localhub.localhub.data.local.dao.ModuleDao
import com.localhub.localhub.model.ModuleInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class ModuleRepository(private val dao: ModuleDao) {

    suspend fun upsert(module: ModuleInfo) = dao.put(module.toEntity())

    fun observe(): Flow<List<ModuleInfo>> =
        dao.observe().map { it.map { e -> e.toDomain() } }

    suspend fun setEnabled(id: String, enabled: Boolean) = dao.setEnabled(id, enabled)

    suspend fun remove(id: String) = dao.remove(id)
}
