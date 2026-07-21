package com.localhub.localhub.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.localhub.localhub.data.local.dao.LogDao
import com.localhub.localhub.data.local.dao.ModuleDao
import com.localhub.localhub.data.local.dao.SettingDao
import com.localhub.localhub.data.local.dao.StatisticsDao
import com.localhub.localhub.data.local.entity.LogEntity
import com.localhub.localhub.data.local.entity.ModuleEntity
import com.localhub.localhub.data.local.entity.SettingEntity
import com.localhub.localhub.data.local.entity.StatisticsEntity

@Database(
    entities = [
        LogEntity::class,
        SettingEntity::class,
        ModuleEntity::class,
        StatisticsEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun logDao(): LogDao
    abstract fun settingDao(): SettingDao
    abstract fun moduleDao(): ModuleDao
    abstract fun statisticsDao(): StatisticsDao

    companion object {
        const val NAME = "localhub.db"
    }
}
