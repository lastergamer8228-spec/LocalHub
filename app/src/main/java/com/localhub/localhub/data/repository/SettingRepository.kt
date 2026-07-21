package com.localhub.localhub.data.repository

import com.localhub.localhub.data.local.dao.SettingDao
import com.localhub.localhub.data.local.entity.SettingEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

object SettingKeys {
    const val LOG_LEVEL = "log_level"
    const val MAX_LOG_ENTRIES = "max_log_entries"
}

class SettingRepository(private val dao: SettingDao) {

    suspend fun getString(key: String, default: String = ""): String =
        dao.get(key)?.value ?: default

    suspend fun putString(key: String, value: String) =
        dao.put(SettingEntity(key, value, System.currentTimeMillis()))

    suspend fun getInt(key: String, default: Int = 0): Int =
        dao.get(key)?.value?.toIntOrNull() ?: default

    suspend fun putInt(key: String, value: Int) =
        dao.put(SettingEntity(key, value.toString(), System.currentTimeMillis()))

    fun observe(): Flow<Map<String, String>> =
        dao.observe().map { list -> list.associate { it.key to it.value } }
}
