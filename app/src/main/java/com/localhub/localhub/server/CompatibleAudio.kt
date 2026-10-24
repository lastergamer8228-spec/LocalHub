package com.localhub.localhub.server

import android.content.Context
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Bounded audio-only chunks. No video copy, no movie-sized output. */
class CompatibleAudio(context: Context) {
    private val dir = File(context.cacheDir, "compatible-audio-v2").apply { mkdirs() }
    private val gate = Semaphore(1)
    @Volatile private var activeSessionId: Long? = null

    fun cancelAndWait(wait: Boolean = true): Boolean {
        activeSessionId?.let { FFmpegKit.cancel(it) }
        if (!wait) return true
        val idle = gate.tryAcquire(8, TimeUnit.SECONDS)
        if (idle) gate.release()
        return idle
    }
    private val segmentSeconds = 60
    private val cacheLimit = 24L * 1024 * 1024

    init {
        // Remove obsolete full-movie conversion cache from the previous preview.
        File(context.cacheDir, "compatible-audio").deleteRecursively()
    }

    private fun keyFor(source: File, track: Int, start: Long): String {
        val value = "${source.canonicalPath}:${source.length()}:${source.lastModified()}:$track:$start"
        return MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    fun tracks(source: File): Map<String, Any> {
        check(gate.tryAcquire(8, TimeUnit.SECONDS)) { "Audio converter busy; try again shortly." }
        try {
            var result: Map<String, Any>? = null
            val done = CountDownLatch(1)
            val session = FFprobeKit.getMediaInformationAsync(source.absolutePath, { completed ->
                val streams = completed.mediaInformation?.allProperties?.optJSONArray("streams")
                val tracks = mutableListOf<Map<String, Any>>()
                if (streams != null) for (i in 0 until streams.length()) {
                    val stream = streams.getJSONObject(i)
                    if (stream.optString("codec_type") == "audio") {
                        val tags = stream.optJSONObject("tags")
                        tracks.add(mapOf("track" to tracks.size,
                            "codec" to stream.optString("codec_name", "unknown"),
                            "language" to (tags?.optString("language", "und") ?: "und"),
                            "title" to (tags?.optString("title", "") ?: ""),
                            "isDefault" to (stream.optJSONObject("disposition")?.optInt("default", 0) == 1),
                            "channels" to stream.optInt("channels", 0)))
                    }
                }
                if (completed.mediaInformation != null) result = mapOf("tracks" to tracks, "segmentSeconds" to segmentSeconds)
                done.countDown()
            })
            activeSessionId = session.sessionId
            if (!done.await(20, TimeUnit.SECONDS)) {
                FFmpegKit.cancel(session.sessionId)
                error("Track detection timed out. Try again.")
            }
            return result ?: error("Could not detect audio tracks for this file.")
        } finally { activeSessionId = null; gate.release() }
    }

    /** Return a small in-memory copy so eviction cannot invalidate an HTTP reader. */
    fun chunk(source: File, track: Int, start: Long): ByteArray {
        require(track in 0..31 && start in 0..604800 && start % segmentSeconds == 0L) { "Invalid audio segment" }
        check(gate.tryAcquire(8, TimeUnit.SECONDS)) { "Audio converter busy; try again shortly." }
        var partial: File? = null
        try {
            val key = keyFor(source, track, start)
            val output = File(dir, "$key.m4a")
            if (output.isFile) {
                output.setLastModified(System.currentTimeMillis())
                return output.readBytes()
            }
            val reserve = 32L * 1024 * 1024
            dir.listFiles()?.filter { it.name.endsWith(".partial.m4a") }?.forEach { it.delete() }
            var files = dir.listFiles()?.sortedBy { it.lastModified() } ?: emptyList()
            var total = files.sumOf { it.length() }
            for (old in files) {
                if (total <= cacheLimit - 4L * 1024 * 1024 && dir.usableSpace >= reserve) break
                val size = old.length()
                if (old.delete()) total -= size
            }
            check(dir.usableSpace >= reserve) { "At least 32 MB free space is needed for small audio chunks." }
            partial = File(dir, "$key.partial.m4a")
            val done = CountDownLatch(1)
            var success = false
            val session = FFmpegKit.executeWithArgumentsAsync(arrayOf(
                "-nostdin", "-y", "-threads", "2", "-ss", start.toString(), "-i", source.absolutePath,
                "-t", segmentSeconds.toString(), "-map", "0:a:$track", "-vn", "-sn", "-dn",
                "-af", "asetpts=PTS-STARTPTS", "-c:a", "aac", "-ac", "2", "-ar", "48000",
                "-b:a", "160k", "-threads", "2", "-movflags", "+faststart", partial.absolutePath
            ), { completed -> success = ReturnCode.isSuccess(completed.returnCode); done.countDown() })
            activeSessionId = session.sessionId
            if (!done.await(45, TimeUnit.SECONDS)) {
                FFmpegKit.cancel(session.sessionId)
                done.await(5, TimeUnit.SECONDS)
                error("Audio conversion timed out. Pause playback and retry.")
            }
            check(success && partial.isFile && partial.length() in 1..(4L * 1024 * 1024)) {
                "Audio decoding failed for this track. Try another track or original mode."
            }
            check(partial.renameTo(output)) { "Could not finish audio segment." }
            return output.readBytes()
        } finally {
            partial?.delete()
            activeSessionId = null
            gate.release()
        }
    }
}
