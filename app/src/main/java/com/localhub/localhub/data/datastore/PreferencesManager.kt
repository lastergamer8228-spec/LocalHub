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
    val ADMIN_USER = stringPreferencesKey("admin_user")
    val ADMIN_PASS = stringPreferencesKey("admin_pass")
    val WEB_USER = stringPreferencesKey("web_user")
    val WEB_PASS = stringPreferencesKey("web_pass")
    // ---- Security & features ----
    val HTTPS_ENABLED = booleanPreferencesKey("https_enabled")
    val TOTP_SECRET = stringPreferencesKey("totp_secret")       // base32 admin TOTP secret ("" = disabled)
    val TOTP_ENABLED = booleanPreferencesKey("totp_enabled")
    val AUDIT_ENABLED = booleanPreferencesKey("audit_enabled")  // security audit events
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

    // ---- Authentication credentials (defaults) ----
    suspend fun getAdminUser(): String = dataStore.data.map { it[PrefKeys.ADMIN_USER] ?: "admin" }.first()
    suspend fun getAdminPass(): String = dataStore.data.map { it[PrefKeys.ADMIN_PASS] ?: "admin" }.first()
    suspend fun getWebUser(): String = dataStore.data.map { it[PrefKeys.WEB_USER] ?: "user" }.first()
    suspend fun getWebPass(): String = dataStore.data.map { it[PrefKeys.WEB_PASS] ?: "user" }.first()

    suspend fun setAdminUser(u: String) = dataStore.edit { it[PrefKeys.ADMIN_USER] = u }
    suspend fun setAdminPass(p: String) = dataStore.edit { it[PrefKeys.ADMIN_PASS] = p }
    suspend fun setWebUser(u: String) = dataStore.edit { it[PrefKeys.WEB_USER] = u }
    suspend fun setWebPass(p: String) = dataStore.edit { it[PrefKeys.WEB_PASS] = p }

    // ---- HTTPS ----
    val httpsEnabledFlow: Flow<Boolean> = dataStore.data.map { it[PrefKeys.HTTPS_ENABLED] ?: false }
    suspend fun getHttpsEnabled(): Boolean = dataStore.data.map { it[PrefKeys.HTTPS_ENABLED] ?: false }.first()
    suspend fun setHttpsEnabled(enabled: Boolean) = dataStore.edit { it[PrefKeys.HTTPS_ENABLED] = enabled }

    // ---- TOTP 2FA ----
    val totpSecretFlow: Flow<String> = dataStore.data.map { it[PrefKeys.TOTP_SECRET] ?: "" }
    val totpEnabledFlow: Flow<Boolean> = dataStore.data.map { it[PrefKeys.TOTP_ENABLED] ?: false }
    suspend fun getTotpSecret(): String = dataStore.data.map { it[PrefKeys.TOTP_SECRET] ?: "" }.first()
    suspend fun getTotpEnabled(): Boolean = dataStore.data.map { it[PrefKeys.TOTP_ENABLED] ?: false }.first()
    suspend fun setTotpSecret(secret: String) = dataStore.edit { it[PrefKeys.TOTP_SECRET] = secret }
    suspend fun setTotpEnabled(enabled: Boolean) = dataStore.edit { it[PrefKeys.TOTP_ENABLED] = enabled }

    // ---- Audit ----
    val auditEnabledFlow: Flow<Boolean> = dataStore.data.map { it[PrefKeys.AUDIT_ENABLED] ?: true }
    suspend fun getAuditEnabled(): Boolean = dataStore.data.map { it[PrefKeys.AUDIT_ENABLED] ?: true }.first()
    suspend fun setAuditEnabled(enabled: Boolean) = dataStore.edit { it[PrefKeys.AUDIT_ENABLED] = enabled }
}
