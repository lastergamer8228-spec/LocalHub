"""Static integration contracts, not Android decoding/device tests."""
from pathlib import Path
import re, subprocess
root = Path(__file__).resolve().parents[1]
server = root/'app/src/main/java/com/localhub/localhub/server'
assets = root/'app/src/main/assets/dashboard'
converter = (server/'CompatibleAudio.kt').read_text()
router = (server/'ApiRouter.kt').read_text()
player = (assets/'player.html').read_text()
ui = (assets/'compatible-audio.js').read_text()
checks = {
 'audio only (no video copy)': '"-vn"' in converter and '"-c:v"' not in converter,
 'AAC stereo': '"-c:a", "aac", "-ac", "2"' in converter,
 'argument array, no shell': 'executeWithArgumentsAsync(arrayOf(' in converter,
 'audio mapping bounded': 'track in 0..31' in converter and '"0:a:$track"' in converter,
 '60 second chunks': 'private val segmentSeconds = 60' in converter,
 'bounded cache': 'private val cacheLimit = 24L * 1024 * 1024' in converter,
 'no source-size space requirement': 'dir.usableSpace >= reserve' in converter and 'source.length() + reserve' not in converter,
 'single concurrent conversion': 'Semaphore(1)' in converter,
 'timeout and cancellation': 'done.await(45, TimeUnit.SECONDS)' in converter and 'FFmpegKit.cancel' in converter,
 'private cache': 'context.cacheDir' in converter,
 'permission expiry validation': 'val validSession = sessionManager.validate' in router,
 'normal user audio access': 'path == "fs/audio-tracks" || path == "fs/audio-chunk" ||' in router,
 'file restrictions': 'val isFsPath = path.startsWith("fs/")' in router,
 'actual tracks probed': 'FFprobeKit.getMediaInformationAsync' in converter,
 'UI loaded in fullscreen subtree': 'wrap.appendChild(panel)' in ui,
 'automatic adaptation': 'needsAdaptation(chosen)' in ui and '  detect();' in ui,
 'video URL untouched': 'media.src =' not in ui,
 'bounded browser cache': 'key !== start && key !== start+60' in ui,
 'mute and volume integration': 'window.LH_AUDIO.settings' in player,
 'player integration': '/dashboard/compatible-audio.js' in player,
}
for name, ok in checks.items():
 print(('PASS ' if ok else 'FAIL ') + name)
assert all(checks.values())
subprocess.run(['node','--check',str(assets/'compatible-audio.js')],check=True)
inline = '\n'.join(re.findall(r'<script>(.*?)</script>', player, re.S))
subprocess.run(['node','--check'],input=inline,text=True,check=True)
print('PASS player and compatible-audio JS syntax')
