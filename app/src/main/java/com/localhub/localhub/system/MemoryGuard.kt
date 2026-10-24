package com.localhub.localhub.system

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import java.io.File

/**
 * Reduces memory pressure before the OS kills us. When the system reports low
 * memory, temporary caches (upload temp files, converted audio chunks, TTS
 * output) are dropped; user files are never touched.
 */
object MemoryGuard {
    /** Cache directories that are safe to delete under memory pressure. */
    private val CACHE_DIRS = listOf("uploads", "compatible-audio", "compatible-audio-v2", "tts")

    fun install(application: Application, store: CrashReportStore, onTrim: ((Int, Int) -> Unit)? = null) {
        application.registerComponentCallbacks(object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
                    val freed = clearCaches(application.cacheDir)
                    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
                        store.noteLowMemory()
                        onTrim?.invoke(level, freed)
                    }
                }
            }

            override fun onLowMemory() {
                val freed = clearCaches(application.cacheDir)
                store.noteLowMemory()
                onTrim?.invoke(ComponentCallbacks2.TRIM_MEMORY_COMPLETE, freed)
            }

            override fun onConfigurationChanged(newConfig: Configuration) = Unit
        })
    }

    fun clearCaches(cacheDir: File): Int {
        var freed = 0
        for (name in CACHE_DIRS) {
            val dir = File(cacheDir, name)
            if (!dir.exists()) continue
            dir.walkTopDown().forEach { file ->
                if (file.isFile) {
                    freed++
                    runCatching { file.delete() }
                }
            }
        }
        return freed
    }
}
