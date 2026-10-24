# Upload crash fix — 1.0.13 (code 14)

## Symptom

“App keeps stopping” when uploading files from a PC browser to LocalHub on the
phone, mostly with larger files.

## Root cause (reproduced by code inspection, not a device log)

`ApiRouter` handled `/api/fs/upload` by calling `readBodyBytes(session)`, which
did:

```kotlin
val len = session.headers?.get("content-length")?.toIntOrNull() ?: 0
val raw = ByteArray(len)   // entire upload in memory
```

With `MAX_UPLOAD_BYTES = 512 MB`, any sizeable upload allocated a huge
`ByteArray` **before** any size check ran. On Android this throws
`OutOfMemoryError` and terminates the host app — matching the reported crash.
Multipart uploads were worse: the whole body was buffered, split by boundary into
more `ByteArray`s, and only then written to disk (double allocation).

Secondary defects on the same path:
- `content-length` parsed as **Int**: files ≥ 2 GB produced `null` → length `0` →
  an empty destination file written and reported as `ok: true` (silent data loss).
- No free-storage check: upload continued until the device ran out of space.
- No `Content-Length` handling: missing length silently produced a 0-byte file.
- Every outcome returned HTTP 200, so the web UI could show success for a failure.
- JSON endpoints also buffered the declared body size; an oversized POST to a
  command endpoint was another memory-exhaustion vector.

Verified constraint: NanoHTTPD does **not** pre-consume the POST body. It reads
only the header, then calls `serve(session)`, so the body is still available on
`session.inputStream` — streaming is possible at this layer.

## Fix

New `UploadStreamer` (Android-free, unit-testable) streams uploads to disk:

- **Raw uploads**: streamed to a temp file, then moved to the destination.
- **Multipart uploads**: a streaming parser reads headers as text and writes each
  file body straight to a temp file with a **64 KB buffer**, so memory use is
  bounded regardless of file size. It keeps a small carry window so a boundary
  split across reads is still detected, and stops at the closing `--boundary--`.
- **Limits enforced while reading**: declared `Content-Length`, the 512 MB cap and
  per-file size are checked during the copy, so an oversized or lying length is
  rejected without allocating it.
- **Temp files** are created under `cacheDir/uploads` and deleted on success and
  failure; leftovers are cleaned after each request.
- **Names** are sanitized (path separators, `..`, NUL stripped) — unchanged
  behaviour, now covered by tests.

`ApiRouter.handleUpload` maps outcomes to real HTTP statuses via a small
`IStatus` implementation (NanoHTTPD lacks some codes such as 507):

| Condition | Status | Behaviour |
|---|---:|---|
| Success | 200 | `{ok, saved, results[]}` (multipart) or `{ok, name, path, size}` (raw) |
| Name/boundary/destination invalid | 400 | error message, nothing written |
| Destination file exists and `overwrite=false` | 409 | existing file untouched |
| `Content-Length` missing | 411 | **no** empty file created |
| Larger than limit (or stream exceeds it) | 413 | rejected before allocation |
| Not enough free storage | 507 | refused up front |
| Body shorter than `Content-Length` | 400 | partial file never reported as saved |

JSON endpoints now reject bodies over **8 MB** with 413 before buffering, closing
the second memory-exhaustion vector.

## Tests

`UploadStreamerTest` — 10 pure JVM tests (no Android/server):

- 300 KB file through a streaming parser (larger than the read buffer) byte-exact.
- Two large files, plus boundaries deliberately split across reads.
- Raw upload byte-exact.
- Oversize rejection (no file created).
- Missing `Content-Length` → 411, no empty file.
- Truncated body → 400, no partial success.
- `overwrite=false` preserves the existing file.
- `../../evil.txt` sanitized into the destination folder.
- Multipart over the limit → 413 with temp files cleaned.
- Successful multipart leaves no temp files behind.

Full suite: **53 passing JVM tests** (24 Compose/Robolectric UI + 29 logic/catalog).

## Not verified here

No physical device upload was performed in this environment, and no logcat was
captured from the user's crash. The diagnosis is source-level with reproduction by
inspection plus new unit tests, so the crash path is addressed but the fix still
needs device confirmation.

## Phone acceptance

Update the preview, start the server, then upload from a PC browser:
1. Small file (a few MB) → succeeds, file opens from File Manager.
2. Large file (e.g. 200–400 MB) → completes without the app closing; watch the
   transfer progress and confirm the byte size matches the source.
3. File above 512 MB → clean “larger than the limit” error, app stays alive.
4. Upload an existing name with overwrite off → 409, original untouched.
5. Confirm no `ul_*.part` leftovers in the app cache after uploads.
6. If a crash persists, capture `adb logcat` at the moment of failure and share the
   stack trace — this pinpoints whether any other path still allocates large memory.
