package com.localhub.localhub

import android.app.Application
import com.localhub.localhub.core.AppContainer
import com.localhub.localhub.system.CrashGuard
import com.localhub.localhub.system.CrashReportStore
import com.localhub.localhub.system.MemoryGuard
import com.localhub.localhub.ui.MainActivity
import java.io.File

class LocalHubApplication : Application() {

    lateinit var appContainer: AppContainer
        private set

    /** Crash/health records survive process death; kept separate from Room. */
    lateinit var healthStore: CrashReportStore
        private set

    override fun onCreate() {
        super.onCreate()
        healthStore = CrashReportStore(File(filesDir, "health/crash_log.json"))
        // Installed first so failures while building the container are recorded.
        CrashGuard.install(this, healthStore, launcher = MainActivity::class.java)
        MemoryGuard.install(this, healthStore)
        appContainer = AppContainer(this)
    }
}
