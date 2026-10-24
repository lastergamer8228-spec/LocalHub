package com.localhub.localhub.ui.screen

import android.graphics.BitmapFactory
import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localhub.localhub.BuildConfig
import com.localhub.localhub.server.QrGenerator
import com.localhub.localhub.ui.components.*
import com.localhub.localhub.ui.viewmodel.SettingsViewModel

/** Each action has one home and an actual effect; no placeholder restart aliases. */
@Composable
fun SettingsScreen(viewModel: SettingsViewModel = viewModel()) {
    val running by viewModel.running.collectAsStateWithLifecycle()
    val status by viewModel.serverStatus.collectAsStateWithLifecycle()
    val serverError by viewModel.serverError.collectAsStateWithLifecycle()
    val working by viewModel.working.collectAsStateWithLifecycle()
    val feedback by viewModel.feedback.collectAsStateWithLifecycle()
    val port by viewModel.port.collectAsStateWithLifecycle()
    val serverName by viewModel.serverName.collectAsStateWithLifecycle()
    val https by viewModel.httpsEnabled.collectAsStateWithLifecycle()
    val audit by viewModel.auditEnabled.collectAsStateWithLifecycle()
    val theme by viewModel.theme.collectAsStateWithLifecycle()
    val autostart by viewModel.autostart.collectAsStateWithLifecycle()
    val sys by viewModel.systemInfo.collectAsStateWithLifecycle()
    var nameText by remember { mutableStateOf("") }
    var portText by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<String?>(null) }
    var showQr by remember { mutableStateOf(false) }
    LaunchedEffect(serverName) { nameText = serverName }
    LaunchedEffect(port) { portText = port.toString() }
    val ip = sys?.network?.ipAddress ?: status.host.ifBlank { "127.0.0.1" }
    val scheme = if(running) status.protocol else if(https) "https" else "http"
    val url = "$scheme://$ip:${if(running) status.port else port}"
    val clipboard = LocalClipboardManager.current

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { SectionHeader("Server control") }
        item {
            PremiumCard {
                Text(if(running) "Server online" else "Server stopped", style = MaterialTheme.typography.titleMedium)
                serverError?.let { Text(it, color=MaterialTheme.colorScheme.error, maxLines=3, overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    PremiumButton(if(running) "Stop server" else "Start server", modifier=Modifier.weight(1f), enabled=!working,
                        onClick={ if(running) viewModel.stopServer() else viewModel.startServer() })
                    PremiumButton("Restart server", modifier=Modifier.weight(1f), enabled=running && !working, onClick=viewModel::restartServer)
                }

            }
        }
        feedback?.let { message -> item { Text(message, style=MaterialTheme.typography.bodyMedium, maxLines=3, overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis) } }
        item { SectionHeader("Health & recovery") }
        item { HealthCard() }
        item { SectionHeader("Connection") }
        item {
            PremiumCard {
                Text(url, style=MaterialTheme.typography.bodyMedium, maxLines=2, overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    PremiumButton("Copy URL",modifier=Modifier.weight(1f),onClick={clipboard.setText(AnnotatedString(url))})
                    PremiumButton("Open browser",modifier=Modifier.weight(1f),enabled=running,onClick={viewModel.openBrowser(url)})
                }
                PremiumButton("Show connection QR", onClick={showQr=true})
                if(!running) Text("The QR/URL will work after you start the server.",style=MaterialTheme.typography.bodySmall)
                PremiumTextField(nameText,{nameText=it},"Server display name")
                PremiumButton("Save name",enabled=!working && nameText.isNotBlank() && nameText.length<=64,onClick={viewModel.setServerName(nameText)})
                Text("Discovery hostname: localhub.local (best-effort). Use the IP URL if discovery is unavailable.",style=MaterialTheme.typography.bodySmall)
                PremiumTextField(portText,{portText=it},"Port",supportingText="1024–65535. A running server will rebind to this port.")
                PremiumButton("Apply port",enabled=!working && (portText.toIntOrNull() ?: 0) in 1024..65535,onClick={viewModel.applyPort(portText.toInt())})
            }
        }
        item { SectionHeader("Appearance & startup") }
        item {
            PremiumCard {
                SegmentSelector(listOf("dark" to "Dark","light" to "Light","system" to "System"),theme,viewModel::setTheme)
                SettingToggle("Start on device boot", "Requires Android background-start permission; some manufacturers restrict it.",autostart,viewModel::setAutostart)
            }
        }
        item { SectionHeader("Security") }
        item {
            PremiumCard {
                SettingToggle("HTTPS", "Self-signed certificate: browsers show a warning. Changes restart a running listener.",https,viewModel::setHttpsEnabled)
                SettingToggle("Security audit logging", "Controls new AUDIT events. Authentication and permissions always remain enforced.",audit,viewModel::setAuditEnabled)
            }
        }
        item { SectionHeader("Maintenance") }
        item {
            PremiumCard {
                PremiumButton("Clear stored logs",enabled=!working,onClick={confirm="logs"})
                PremiumButton("Clear temporary media cache",enabled=!working && !running,onClick={confirm="cache"})
                Text("Stop the server before clearing media cache. Source videos/documents are never deleted.",style=MaterialTheme.typography.bodySmall)
            }
        }
        item { SectionHeader("Backup & export") }
        item { BackupCard() }
        item { SectionHeader("About") }
        item {
            PremiumCard {
                Text("App ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                Text("Server protocol ${status.version}")
                Text("Android ${Build.VERSION.RELEASE} · ${Build.MANUFACTURER} ${Build.MODEL}")
                Text("ABI ${Build.SUPPORTED_ABIS.firstOrNull() ?: "Unknown"}")
                Text("Development preview · device acceptance pending",style=MaterialTheme.typography.bodySmall)
                Text("Native config backup/restore and log export are not available yet.",style=MaterialTheme.typography.bodySmall)
            }
        }
    }
    if(confirm != null) AlertDialog(onDismissRequest={confirm=null},title={Text("Confirm maintenance")},
        text={Text(if(confirm=="logs") "Clear stored logs? New activity may create new entries." else "Delete temporary audio/speech cache? Your source files stay untouched.")},
        confirmButton={TextButton(onClick={if(confirm=="logs") viewModel.clearLogs() else viewModel.clearTemporaryCache();confirm=null}){Text("Clear")}},
        dismissButton={TextButton(onClick={confirm=null}){Text("Cancel")}})
    if(showQr) {
        val bitmap = remember(url) { QrGenerator.png(url)?.let { BitmapFactory.decodeByteArray(it,0,it.size) } }
        AlertDialog(onDismissRequest={showQr=false},title={Text("Connect on the same network")},
            text={Column { bitmap?.let { Image(it.asImageBitmap(),"QR for $url",Modifier.size(220.dp)) };Text(url) }},
            confirmButton={TextButton(onClick={showQr=false}){Text("Done")}})
    }
}

@Composable
private fun BackupCard(viewModel: SettingsViewModel = viewModel()) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var feedback by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    // Files are written through SAF so the user chooses where they are saved.
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val json = pending
        pending = null
        if (uri == null) {
            feedback = "Export cancelled."
            return@rememberLauncherForActivityResult
        }
        val ok = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { it.write(json.orEmpty().toByteArray()) } ?: return@runCatching false
            true
        }.getOrDefault(false)
        feedback = if (ok) "Backup saved." else "Could not write the backup file."
    }

    val openLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        feedback = null
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.readText()
                }.getOrNull()
            }
            feedback = viewModel.applySettingsBackup(text.orEmpty())
            busy = false
        }
    }

    fun export(kind: String) {
        if (busy) return
        busy = true
        feedback = null
        scope.launch {
            val json = withContext(Dispatchers.IO) {
                if (kind == "settings") viewModel.buildSettingsBackup() else viewModel.buildLogsBackup()
            }
            pending = json
            val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(java.util.Date())
            saveLauncher.launch("localhub-$kind-$stamp.json")
            busy = false
        }
    }

    PremiumCard {
        Text("Move settings and logs between devices", style = MaterialTheme.typography.titleSmall)
        Text(
            "Settings backups contain only non-secret preferences (port, theme, autostart, server name). " +
                "Passwords and two-factor secrets are never exported or restored.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            PremiumButton("Export settings", modifier = Modifier.weight(1f).testTag("export-settings"),
                enabled = !busy, onClick = { export("settings") })
            PremiumButton("Export logs", modifier = Modifier.weight(1f).testTag("export-logs"),
                enabled = !busy, onClick = { export("logs") })
        }
        PremiumButton("Import settings", modifier = Modifier.fillMaxWidth().testTag("import-settings"),
            enabled = !busy, onClick = { openLauncher.launch(arrayOf("application/json")) })
        feedback?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
@Composable
private fun HealthCard() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val app = context.applicationContext as? com.localhub.localhub.LocalHubApplication
    val clipboard = LocalClipboardManager.current
    var state by remember { mutableStateOf<com.localhub.localhub.system.HealthState?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        if (app == null) return
        val next = withContext(Dispatchers.IO) { app.healthStore.read() }
        state = next
    }
    fun run(action: String, block: (com.localhub.localhub.system.CrashReportStore) -> Unit) {
        if (app == null || busy) return
        busy = true
        feedback = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { block(app.healthStore) }.isSuccess
            }
            busy = false
            feedback = if (result) "$action done." else "$action failed."
            refresh()
        }
    }

    LaunchedEffect(Unit) { refresh() }

    PremiumCard {
        Text("Crash protection", style = MaterialTheme.typography.titleSmall)
        if (app == null) {
            Text("Health information is unavailable in this build.", style = MaterialTheme.typography.bodySmall)
            return@PremiumCard
        }
        val current = state
        if (current == null) {
            Text("Loading health information…", style = MaterialTheme.typography.bodySmall)
        } else {
            val summary = remember(current) {
                app.healthStore.describe(current, System.currentTimeMillis())
            }
            Text(summary, style = MaterialTheme.typography.bodySmall)
            Text(
                "Crashes are recorded and the app can restart once. After repeated crashes it enters " +
                    "safe mode and stops auto-starting the server on boot. Recovery cannot prevent every crash.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (current.safeMode) {
                Text(
                    "Safe mode is ON. The server will not start automatically on boot. Fix the problem, then exit safe mode.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                PremiumButton(
                    "Copy details", modifier = Modifier.weight(1f), enabled = !busy,
                    onClick = {
                        clipboard.setText(AnnotatedString(app.healthStore.describe(current, System.currentTimeMillis())))
                        feedback = "Health summary copied."
                    }
                )
                PremiumButton(
                    if (current.safeMode) "Exit safe mode" else "Safe mode off",
                    modifier = Modifier.weight(1f), enabled = !busy && current.safeMode,
                    onClick = { run("Safe mode exit") { it.setSafeMode(false) } }
                )
            }
            PremiumButton("Clear crash log", enabled = !busy && current.crashes.isNotEmpty(),
                onClick = { run("Crash log clear") { it.clearCrashes() } })
            feedback?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
@Composable
private fun SettingToggle(title:String,detail:String,checked:Boolean,onChange:(Boolean)->Unit) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) { Text(title,style=MaterialTheme.typography.bodyMedium);Text(detail,style=MaterialTheme.typography.bodySmall) }
        PremiumSwitch(checked,onChange)
    }
}
