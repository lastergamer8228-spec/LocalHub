package com.localhub.localhub.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.localhub.localhub.data.local.entity.LogEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface LogDao {
    @Insert
    suspend fun insert(entity: LogEntity): Long

    @Query("SELECT * FROM logs ORDER BY timestamp DESC LIMIT :limit")
    fun recent(limit: Int): Flow<List<LogEntity>>

    @Query("SELECT * FROM logs ORDER BY timestamp DESC")
    fun all(): Flow<List<LogEntity>>

    @Query("DELETE FROM logs WHERE timestamp < :before")
    suspend fun deleteOlderThan(before: Long)

    @Query("DELETE FROM logs")
    suspend fun clear()
}
