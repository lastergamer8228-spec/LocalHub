"""Static wiring/scope checks; not Android permission or health verification."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
api=(root/'app/src/main/java/com/localhub/localhub/server/ApiRouter.kt').read_text()
catalog=(root/'app/src/main/java/com/localhub/localhub/module/HostIntegration.kt').read_text()
bridge=(root/'app/src/main/assets/ai/system_integration.js').read_text()
runtime=(root/'app/src/main/assets/ai/assistant_runtime.js').read_text()
index=(root/'app/src/main/assets/ai/index.html').read_text()
policy=(root/'app/src/main/java/com/localhub/localhub/module/ModulePolicy.kt').read_text()
native_ids=set(re.findall(r'"([a-z.]+)"',re.search(r'val controllable = setOf\((.*?)\)',policy,re.S).group(1)))|{'core.server','core.security'}
client_ids=set(re.findall(r"'([a-z.]+)'",re.search(r'var IDS=\[(.*?)\]',bridge,re.S).group(1)))
checks={
 'native/client feature contract agrees':native_ids==client_ids,
 'authenticated, non-admin read endpoint':'if (path == "integration" || path == "dashboard"' in api,
 'not a public auth bypass':'if (path == "status" || path == "qr") return null' in api,
 'native session validation':'if (role == null) unauthorized() else json(hostIntegration(role))' in api,
 'private descriptor not cached':'json(hostIntegration(role)).apply { addHeader("Cache-Control", "no-store") }' in api,
 'host grants queried, not requested':'Environment.isExternalStorageManager()' in api and 'canWriteSettings()' in api,
 'metadata only enforced controls':'ModulePolicy.controllable + setOf("core.server", "core.security")' in catalog,
 'permission fields sanitized':'permissions[it]?.takeIf' in catalog,
 'policy limited to chat read recovery':'"chatRecoveryPolicy"' in catalog and '"bounded-read-recovery"' in catalog,
 'strict diagnostic endpoint allowlist':'if(READS.indexOf(path)<0)' in bridge,
 'bounded read budget':'if(calls>=12)' in bridge,
 'diagnostic requests always GET':"request(path,'GET',2000,controller.signal)" in runtime,
 'whole-run time budget':"controller.abort();},10000)" in runtime,
 'repair helpers not invoked':all(token not in bridge for token in ['SelfHeal.handleDetection','runDeviceDeployPipeline','FileEngine.runFileFix','Guardian.runHealthCheck','Memory.put','localStorage.setItem']),
 'bootstrap load order':index.index('/ai/system_integration.js') < index.index('/ai/assistant_runtime.js'),
 'configuration re-read before retry':"var fresh" in bridge and "fresh=await read('/api/integration')" in bridge,
 'unknown CPU not guessed':"data.cpu.available===true" in bridge and 'not estimated or treated as zero' in bridge,
 'consent inactivity distinguished':'INACTIVE_EXPECTED' in bridge,
 'generic repair needs current topic':"healthFocus!==owner()" in runtime,
}
for name,ok in checks.items():print(('PASS ' if ok else 'FAIL ')+name)
assert all(checks.values())
print(f'{len(checks)} static integration contracts passed (not device tests).')
