# Automatic Audio — 1.0.3-auto-audio-preview (code 4)

## End-user flow
Open a video. LocalHub probes actual audio tracks automatically. Known incompatible
AC-3/E-AC-3/DTS/TrueHD/MLP source audio is adapted using the bounded audio-only
chunk pipeline below. Supported original/default AAC audio remains untouched.
Alternate language tracks use the adaptation pipeline to make language selection
work even when Chrome does not expose native audioTracks.

Audio button now opens **Audio language** with friendly Hindi / English / etc.
labels; chosen language is remembered across videos when available. Source-default
language is used when no preference matches. No Detect/Prepare/codec-selection
step is required in ordinary playback. Codec details, manual Fix missing sound,
refresh and original audio override are tucked under Advanced. Browser gesture
restrictions show a single Tap to play with sound prompt; browser policy is not
bypassed. An explicit mute preference is respected.

Authenticated standard users as well as administrators can request track detection
and audio chunks. Existing session expiry/IP checks, blocked-device policy and
per-device file-access denial apply. File mutation endpoints remain admin-only.
Audio conversion creates private cache data, not modifications to shared files.

Build succeeded. ARM64 preview application ID unchanged, same debug signing
certificate, versionCode 4. Install over AAC Streaming v2, restart the server and
reload browser pages. This is NOT an update to the original GitHub-signed app.

Checks: automatic AC-3/E-AC-3 selection, native AAC bypass, denied-access handling,
autoplay gesture recovery, friendly language labels and previous playback-sync
mock scenarios pass. 20 static contracts + JS syntax checks pass; existing engine
suite 542/542 passes. APK signature, version and packaged auto UI verified.
Actual phone/browser playback of this automatic UX is not yet tested here.

## Remaining limits
The compatibility detector handles the named known-incompatible codec families,
not every possible browser/device codec combination. Failed probes do not claim
success; original playback remains, with a retry notice. Buffering and cache limits
from the streaming implementation below still apply. This does not fix video
HEVC / HDR / Dolby Vision browser limitations.

---
## Streaming architecture reference (supersedes v2 manual instructions)

## What changed
Removed full-movie AAC/MP4 copying. Original video URL is never replaced.
Only the selected audio is decoded into 60-second AAC stereo chunks (160 kb/s,
48 kHz). Each chunk is usually ~1.2 MB. Server disk cache budget is 24 MB;
32 MB of available storage is required before generating a new chunk. Browser
holds current and next audio chunks, not a movie-sized blob. Source video quality
and external subtitle rendering are unchanged.

The player pauses while audio chunks load, prefetches the next chunk, restarts
from the requested minute on seeking and corrects large audio/video time drift.
Volume/mute and pause/resume are forwarded to a separate audio element. Original
audio is muted in this mode; Original audio restores it. Background/browser
scheduling can still cause gaps or drift and must be tested on actual devices.

## Endpoints / safety
GET /api/fs/audio-tracks?path=…
GET /api/fs/audio-chunk?path=…&track=…&start=…
Both require a valid authenticated user/admin session (expiry/IP validation) and pass through
existing per-device file restrictions. Track 0..31; start 0..604800 seconds,
aligned to 60 seconds. No shell command interpolation: FFmpeg argument arrays.
One native operation at a time; queue wait 8 seconds; probe timeout 20 seconds;
chunk conversion timeout 45 seconds with cancellation. Partial files removed.
Completed response copied into bounded memory before cache eviction can occur.
Old movie-copy cache is cleared on converter initialization.

## Limits
- Short buffering gaps may occur at minute boundaries or after seeking.
- AAC is stereo, not preservation of surround channels.
- HEVC / Dolby Vision / HDR browser decoding is NOT fixed by audio conversion.
- Existing audio gain/boost/delay effects do not apply to the separate AAC stream.
- Conversion uses CPU and battery. Slow devices may time out; only one concurrent
  conversion/probe is allowed. Try again if busy.
- Not HLS/MSE, not guaranteed gapless playback; A/V sync remains device-unverified.

## Build / package
assembleDebug -PaacPreview=true succeeded using JDK 17 + Android SDK 34.
Preview application ID: com.localhub.localhub.aacpreview (same as previous AAC
preview), ARM64 only, Android 7+. New version code 4. Debug APK signature verified.
This is NOT an update to the original GitHub-signed com.localhub.localhub app;
it is an update to the separately installed AAC preview. Stop the original server
before starting preview because both use the same default port.

## Tests / evidence
- 20 source integration contracts and JavaScript syntax checks passed.
- Mocked player start/prefetch, video URL unchanged, mute/volume, pause, seek,
  retry, drift correction and original-mode restoration passed.
- Host FFmpeg synthetic 5.1 AC-3 AND E-AC-3 → AAC stereo tested at 0s and 60s.
  All four generated outputs decoded non-silent, with expected duration (~60s / 5s).
  These host codec tests are NOT execution of the Android native library.
- Existing headless suite: 542 pass / 0 fail (mock-backed engine tests).
- APK built successfully and packaged scripts/native libraries verified.
- NOT run: install/phone playback, real user's 25.7 GB movie, live Chrome sync.

## Third-party software
Pinned native dependency com.moizhassan.ffmpeg:ffmpeg-kit-16kb:6.1.1.
Native source/build instructions: https://github.com/moizhassankh/ffmpeg-kit-android-16KB
FFmpegKit upstream: https://github.com/arthenica/ffmpeg-kit
FFmpeg sources: https://ffmpeg.org/download.html
Unmodified dynamically linked native libraries; LGPL v3 per artifact POM.
License texts and notices are included in app/src/main/assets/licenses/ and APK.
