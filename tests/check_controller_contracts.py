"""Source wiring checks. NOT Android lifecycle/device verification."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'app/src/main/java/com/localhub/localhub'
read=lambda p:(root/p).read_text()
settings=read('ui/screen/SettingsScreen.kt');vm=read('ui/viewmodel/SettingsViewModel.kt')
server=read('server/LocalHubServer.kt');api=read('server/ApiRouter.kt')
container=read('core/AppContainer.kt');service=read('service/LocalHubService.kt')
checks={
 'module gate before dispatcher':server.index('moduleManager.blocked(uri)') < server.index('uri.startsWith("/api/") -> apiRouter.handle'),
 'auth session checks expiry and IP': 'val role = sessionManager.validate(token, session.remoteIpAddress ?: "?")?.role' in api,
 'module gate inside API router': 'moduleManager.blocked(uri)' in api,
 'direct media content classification':'moduleManager.blocked("/api/fs/content", isMedia)' in api,
 'range and ordinary reads guarded':api.count('guardedStream(java.io.BufferedInputStream') == 2,
 'restore before server construction':container.index('moduleManager.restoreEnabled') < container.index('var server:'),
 'legacy duplicate files removed':'moduleRepository.remove("core.files")' in container,
 'persistence failure surfaced':'onFailure { error.value' in read('ui/viewmodel/ModulesViewModel.kt'),
 'no fake restarts/backup buttons':all(x not in settings for x in ['Restart Assets','Restart Media','PremiumButton("Clear Cache"','enabled = false, onClick = {}']),
 'one native restart button':settings.count('PremiumButton("Restart server"') == 1,
 'real temporary-cache clear':'folder.deleteRecursively()' in vm and 'cancelMediaWork()' in vm,
 'logs clear goes to repository':'container.logRepository.clear()' in vm,
 'QR generates pixels':'QrGenerator.png(url)' in settings,
 'app version not Android OS build':'BuildConfig.VERSION_NAME' in settings and 'Build.VERSION.INCREMENTAL' not in settings,
 'status reflects bind result':'container.isServerRunning.value = true' not in service and 'container.isServerRunning.value = started' in service,
 'foreground promotion before worker':'promoteForeground(Constants.DEFAULT_PORT)' in service and service.index('promoteForeground(Constants.DEFAULT_PORT)') < service.index('scope.launch'),
 'serialized native commands':'commandMutex.lock()' in service,
 'no constructor listener start':'server.startServer()' not in container[container.rindex('    init {'):],
 # The refactor renamed initialPort() -> port and rebuilds the transport after
 # stopped-setting edits; assert the rebuild exists, not a stale identifier.
 'fresh transport after stopped edits':container.count('server = buildServer(') >= 2 and container.index('var server:') < container.rindex('server = buildServer('),
 # Fail-closed now lives in applyTls(): it throws instead of serving plaintext.
 'TLS fails closed':'no per-install TLS identity available' in server and 'throw IllegalStateException' in server[server.index('private fun applyTls'):],
 'system endpoint serializes snapshot not StateFlow':'json(systemInfoProvider.lastSnapshot.value ?: systemInfoProvider.collectSnapshot())' in api,
 'actual protocol in native URLs':'status.protocol' in settings and 'status.protocol' in read('ui/screen/DashboardScreen.kt'),
 'audit toggle reaches logger':'if (tag == "AUDIT" && !auditEnabled) return' in read('util/AppLogger.kt'),
 'no synthetic CPU jitter':'baseLoad' not in read('system/SystemInfoProvider.kt') and 'val jitter' not in read('system/SystemInfoProvider.kt'),
 'admin-only websocket logs':'adminOnly = true' in server and 'ws.isAdmin' in read('server/WebSocketHub.kt'),
 'screen capture callback registered':'proj.registerCallback(callback, captureHandler)' in read('system/ScreenMirror.kt'),
 'no sticky replay of screen consent':'return START_NOT_STICKY' in read('service/MirrorService.kt'),
 'DND calls real Android API':'manager.setInterruptionFilter' in read('system/DeviceActions.kt'),
 'accessibility commands dispatched on main':'android.os.Looper.getMainLooper()' in read('system/RemoteAccessService.kt'),
}
for name,ok in checks.items():print(('PASS ' if ok else 'FAIL ')+name)
assert all(checks.values())
print(f'{len(checks)} controller source contracts passed (not runtime tests).')
