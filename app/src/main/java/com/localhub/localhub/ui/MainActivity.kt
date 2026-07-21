package com.localhub.localhub.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import com.localhub.localhub.LocalHubApplication
import com.localhub.localhub.ui.navigation.LocalHubNavHost
import com.localhub.localhub.ui.theme.LocalHubTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as LocalHubApplication).appContainer
        setContent {
            val theme by container.preferencesManager.themeFlow.collectAsState(initial = "dark")
            val dark = when (theme) {
                "light" -> false
                "system" -> isSystemInDarkTheme()
                else -> true
            }
            LocalHubTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    LocalHubNavHost()
                }
            }
        }
    }
}
