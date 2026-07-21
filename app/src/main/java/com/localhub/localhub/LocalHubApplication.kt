package com.localhub.localhub

import android.app.Application
import com.localhub.localhub.core.AppContainer

class LocalHubApplication : Application() {

    lateinit var appContainer: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        appContainer = AppContainer(this)
    }
}
