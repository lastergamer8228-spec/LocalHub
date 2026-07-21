package com.localhub.localhub.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localhub.localhub.data.local.entity.ModuleEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ModuleDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entity: ModuleEntity)

    @Query("SELECT * FROM modules")
    fun observe(): Flow<List<ModuleEntity>>

    @Query("SELECT * FROM modules WHERE id = :id LIMIT 1")
    suspend fun get(id: String): ModuleEntity?

    @Query("UPDATE modules SET enabled = :enabled WHERE id = :id")
    suspend fun setEnabled(id: String, enabled: Boolean)

    @Query("DELETE FROM modules WHERE id = :id")
    suspend fun remove(id: String)
}
