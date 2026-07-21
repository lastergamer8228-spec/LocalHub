package com.localhub.localhub.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localhub.localhub.data.local.entity.SettingEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SettingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entity: SettingEntity)

    @Query("SELECT * FROM settings WHERE `key` = :key LIMIT 1")
    suspend fun get(key: String): SettingEntity?

    @Query("SELECT * FROM settings")
    fun observe(): Flow<List<SettingEntity>>

    @Query("DELETE FROM settings WHERE `key` = :key")
    suspend fun remove(key: String)
}
