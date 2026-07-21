package com.localhub.localhub.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** DataStore-backed user preferences (port, theme, autostart, server name). */
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "localhub_prefs")

object PrefKeys {
    val PORT = intPreferencesKey("port")
    val THEME = stringPreferencesKey("theme") // "dark" | "light" | "system"
    val AUTOSTART = booleanPreferencesKey("autostart")
    val SERVER_NAME = stringPreferencesKey("server_name")
}

class PreferencesManager(context: Context) {

    private val dataStore = context.applicationContext.dataStore

    val portFlow: Flow<Int> = dataStore.data.map { it[PrefKeys.PORT] ?: 8080 }
    val themeFlow: Flow<String> = dataStore.data.map { it[PrefKeys.THEME] ?: "dark" }
    val autostartFlow: Flow<Boolean> = dataStore.data.map { it[PrefKeys.AUTOSTART] ?: false }
    val serverNameFlow: Flow<String> = dataStore.data.map { it[PrefKeys.SERVER_NAME] ?: "LocalHub" }

    suspend fun setPort(port: Int) = dataStore.edit { it[PrefKeys.PORT] = port }
    suspend fun setTheme(theme: String) = dataStore.edit { it[PrefKeys.THEME] = theme }
    suspend fun setAutostart(enabled: Boolean) = dataStore.edit { it[PrefKeys.AUTOSTART] = enabled }
    suspend fun setServerName(name: String) = dataStore.edit { it[PrefKeys.SERVER_NAME] = name }

    suspend fun getPort(): Int = dataStore.data.map { it[PrefKeys.PORT] ?: 8080 }.first()
    suspend fun getTheme(): String = dataStore.data.map { it[PrefKeys.THEME] ?: "dark" }.first()
    suspend fun getAutostart(): Boolean = dataStore.data.map { it[PrefKeys.AUTOSTART] ?: false }.first()
}
