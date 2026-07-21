package com.localhub.localhub.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.localhub.localhub.LocalHubApplication
import com.localhub.localhub.core.AppContainer

/** Base ViewModel that exposes the app-wide [AppContainer]. */
abstract class LocalHubViewModel(application: Application) : AndroidViewModel(application) {
    protected val container: AppContainer
        get() = (getApplication<LocalHubApplication>()).appContainer
}
