package com.localhub.localhub.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.localhub.localhub.data.local.entity.StatisticsEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface StatisticsDao {
    @Insert
    suspend fun insert(entity: StatisticsEntity)

    @Query("SELECT * FROM statistics ORDER BY timestamp DESC LIMIT :limit")
    fun recent(limit: Int): Flow<List<StatisticsEntity>>

    @Query("DELETE FROM statistics WHERE timestamp < :before")
    suspend fun deleteOlderThan(before: Long)

    @Query("DELETE FROM statistics")
    suspend fun clear()
}
