package com.localhub.localhub.server

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.charset.StandardCharsets

/**
 * Bounded-memory upload writer.
 *
 * The previous implementation buffered the whole request body (up to 512 MB)
 * into a ByteArray before checking the size, which threw OutOfMemoryError and
 * crashed the host app on large uploads. This streams the body to a temporary
 * file with a small fixed buffer, enforcing the size limit while reading.
 *
 * Android-free so the streaming/parsing rules are unit-testable on the JVM.
 */
object UploadStreamer {
    const val MAX_UPLOAD_BYTES = 500L * 1024 * 1024 * 1024L // 500 GB limit; practically bounded only by storage
    const val MIN_STORAGE_HEADROOM = 150L * 1024 * 1024 // 150 MB safety margin to prevent Android low-space lockouts
    private const val BUFFER_SIZE = 128 * 1024
    /** Bytes kept back so a boundary split across reads is still recognised. */
    private const val CARRY_PAD = 4

    data class UploadResult(val httpStatus: Int, val body: Map<String, Any>) {
        val isOk: Boolean get() = httpStatus in 200..299
    }

    /** Reads at most [limit] bytes; flags whether the stream was truncated. */
    private class BodyLimiter(private val source: InputStream, private val limit: Long) : InputStream() {
        var read = 0L
            private set
        var truncated = false
            private set

        override fun read(): Int {
            if (truncated) return -1
            val value = source.read()
            if (value < 0) return -1
            if (read + 1 > limit) {
                truncated = true
                return -1
            }
            read++
            return value
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (truncated) return -1
            val allowed = minOf(length.toLong(), limit - read)
            if (allowed <= 0) {
                truncated = true
                return -1
            }
            val count = source.read(buffer, offset, allowed.toInt())
            if (count < 0) return -1
            read += count
            return count
        }
    }

    fun saveRaw(
        input: InputStream,
        contentLength: Long?,
        destDir: File,
        rawName: String,
        overwrite: Boolean,
        tempDir: File,
        maxBytes: Long = MAX_UPLOAD_BYTES
    ): UploadResult {
        if (contentLength == null || contentLength < 0) {
            return fail(411, "Content-Length is required for upload.")
        }
        if (contentLength > maxBytes) return tooLarge(maxBytes)
        if (!ensureDir(destDir)) return fail(400, "Destination folder is not available.")
        val name = sanitizeName(rawName)
        if (name.isBlank()) return fail(400, "A valid file name is required.")
        val dest = File(destDir, name)
        if (dest.exists() && !overwrite) return fail(409, "$name already exists.")
        if (destDir.usableSpace < contentLength + MIN_STORAGE_HEADROOM) return fail(507, "Not enough free storage for this upload.")

        val temp = newTempFile(tempDir) ?: return fail(500, "Could not create a temporary file.")
        return try {
            val limiter = BodyLimiter(input, minOf(contentLength, maxBytes))
            val copied = copyBounded(limiter, temp, contentLength, maxBytes)
            when {
                copied is Copy.TooLarge -> tooLarge(maxBytes)
                copied is Copy.Incomplete -> fail(400, "Upload ended before all bytes arrived.")
                else -> {
                    val size = (copied as Copy.Ok).size
                    if (!place(temp, dest, overwrite)) fail(500, "Could not save the uploaded file.")
                    else UploadResult(200, mapOf(
                        "ok" to true, "name" to name, "path" to dest.absolutePath, "size" to size
                    ))
                }
            }
        } finally {
            temp.delete()
        }
    }

    fun saveMultipart(
        input: InputStream,
        contentLength: Long?,
        boundary: String,
        destDir: File,
        overwrite: Boolean,
        tempDir: File,
        maxBytes: Long = MAX_UPLOAD_BYTES
    ): UploadResult {
        if (contentLength == null || contentLength < 0) {
            return fail(411, "Content-Length is required for upload.")
        }
        if (contentLength > maxBytes) return tooLarge(maxBytes)
        if (boundary.isBlank()) return fail(400, "Upload is missing its multipart boundary.")
        if (!ensureDir(destDir)) return fail(400, "Destination folder is not available.")
        if (destDir.usableSpace < contentLength + MIN_STORAGE_HEADROOM) return fail(507, "Not enough free storage for this upload.")

        val delimiter = ("--$boundary").toByteArray(StandardCharsets.US_ASCII)
        val limiter = BodyLimiter(input, minOf(contentLength, maxBytes))
        val results = mutableListOf<Map<String, Any>>()
        var saved = 0
        try {
            val parts = parseParts(limiter, delimiter, tempDir)
            if (limiter.truncated) return tooLarge(maxBytes)
            for (part in parts) {
                val safeName = sanitizeName(part.fileName)
                if (safeName.isBlank()) {
                    results.add(mapOf("name" to part.fileName, "ok" to false, "error" to "invalid name"))
                    part.temp.delete()
                    continue
                }
                if (part.size > maxBytes) {
                    results.add(mapOf("name" to safeName, "ok" to false, "error" to "file too large"))
                    part.temp.delete()
                    continue
                }
                val dest = File(destDir, safeName)
                if (dest.exists() && !overwrite) {
                    results.add(mapOf("name" to safeName, "ok" to false, "error" to "already exists"))
                    part.temp.delete()
                    continue
                }
                if (!place(part.temp, dest, overwrite)) {
                    results.add(mapOf("name" to safeName, "ok" to false, "error" to "could not save"))
                    part.temp.delete()
                    continue
                }
                saved++
                results.add(mapOf("name" to safeName, "ok" to true, "path" to dest.absolutePath, "size" to part.size))
            }
            return UploadResult(200, mapOf("ok" to (saved > 0), "saved" to saved, "results" to results))
        } catch (e: Exception) {
            return fail(500, "Upload interrupted: ${e.message ?: "network error"}")
        } finally {
            // Nothing temporary should survive the request.
            tempDir.listFiles()?.forEach { if (it.name.startsWith("ul_") || it.name.endsWith(".part")) it.delete() }
            if (tempDir.name == ".lh_upload_tmp" && tempDir.listFiles()?.isEmpty() == true) {
                runCatching { tempDir.delete() }
            }
        }
    }

    private sealed class Copy {
        data class Ok(val size: Long) : Copy()
        object TooLarge : Copy()
        object Incomplete : Copy()
    }

    private fun copyBounded(input: InputStream, dest: File, expected: Long, maxBytes: Long): Copy {
        val buffer = ByteArray(BUFFER_SIZE)
        var total = 0L
        java.io.BufferedOutputStream(FileOutputStream(dest), BUFFER_SIZE).use { out ->
            while (total < expected) {
                val count = input.read(buffer, 0, minOf(buffer.size.toLong(), expected - total).toInt())
                if (count < 0) break
                out.write(buffer, 0, count)
                total += count
                if (total > maxBytes) return Copy.TooLarge
            }
        }
        return if (total < expected) Copy.Incomplete else Copy.Ok(total)
    }

    private data class Part(val fileName: String, val temp: File, val size: Long)

    /**
     * Streaming multipart reader: headers are parsed as text, file bodies are
     * streamed to temporary files, so memory use stays bounded regardless of
     * file size.
     */
    private fun parseParts(input: InputStream, delimiter: ByteArray, tempDir: File): List<Part> {
        val parts = mutableListOf<Part>()
        val buffer = ByteArray(BUFFER_SIZE)
        var carry = ByteArray(0)
        var output: java.io.OutputStream? = null
        var currentName: String? = null
        var currentTemp: File? = null
        var written = 0L
        var finished = false

        fun closeCurrent() {
            output?.close()
            output = null
            val temp = currentTemp
            val name = currentName
            if (temp != null && name != null) parts.add(Part(name, temp, written))
            currentTemp = null
            currentName = null
            written = 0L
        }

        while (!finished) {
            val count = input.read(buffer)
            if (count < 0) break
            var work = if (carry.isEmpty()) buffer.copyOf(count) else carry + buffer.copyOfRange(0, count)
            var searchFrom = 0
            while (true) {
                val index = indexOf(work, delimiter, searchFrom)
                if (index < 0) {
                    val safe = work.size - (delimiter.size + CARRY_PAD)
                    if (safe > 0) {
                        output?.write(work, 0, safe)
                        written += safe
                        carry = work.copyOfRange(safe, work.size)
                    } else {
                        carry = work
                    }
                    break
                }
                // Content before the delimiter belongs to the current part.
                val bodyEnd = if (index >= 2 && work[index - 2] == '\r'.code.toByte() && work[index - 1] == '\n'.code.toByte()) index - 2 else index
                val activeOutput = output
                if (activeOutput != null && bodyEnd > 0) {
                    activeOutput.write(work, 0, bodyEnd)
                    written += bodyEnd
                }
                closeCurrent()
                var pos = index + delimiter.size
                if (pos + 1 < work.size && work[pos] == '-'.code.toByte() && work[pos + 1] == '-'.code.toByte()) {
                    finished = true
                    break
                }
                // Skip the CRLF after the delimiter, then read this part's headers.
                while (pos < work.size && (work[pos] == '\r'.code.toByte() || work[pos] == '\n'.code.toByte())) pos++
                val headerEnd = indexOf(work, "\r\n\r\n".toByteArray(StandardCharsets.US_ASCII), pos)
                if (headerEnd < 0) {
                    carry = work.copyOfRange(pos, work.size)
                    break
                }
                val headers = String(work, pos, headerEnd - pos, StandardCharsets.US_ASCII)
                val name = extractFilename(headers)
                var bodyStart = headerEnd + 4
                if (name != null) {
                    val temp = newTempFile(tempDir)
                    if (temp == null) {
                        finished = true
                        break
                    }
                    currentTemp = temp
                    currentName = name
                    output = java.io.BufferedOutputStream(FileOutputStream(temp), BUFFER_SIZE)
                    written = 0L
                }
                searchFrom = bodyStart
                work = work.copyOfRange(bodyStart, work.size)
            }
        }
        closeCurrent()
        return parts
    }

    private fun extractFilename(headers: String): String? {
        val regex = Regex("filename\\s*=\\s*\"([^\"]*)\"|filename\\s*=\\s*([^;\\r\\n]*)", RegexOption.IGNORE_CASE)
        val match = regex.find(headers) ?: return null
        return (match.groupValues[1].takeIf { it.isNotEmpty() } ?: match.groupValues[2]).trim().takeIf { it.isNotEmpty() }
    }

    fun sanitizeName(raw: String): String {
        var name = raw.replace("\\", "/")
        if (name.contains('/')) name = name.substringAfterLast('/')
        name = name.replace("..", "").replace("\u0000", "").trim()
        return name
    }

    private fun ensureDir(dir: File): Boolean = (dir.exists() || dir.mkdirs()) && dir.isDirectory

    private fun hasSpace(dir: File, needed: Long): Boolean = dir.usableSpace >= needed

    private fun newTempFile(dir: File): File? = runCatching {
        if (!ensureDir(dir)) return null
        File.createTempFile("ul_", ".part", dir)
    }.getOrNull()

    private fun place(temp: File, dest: File, overwrite: Boolean): Boolean = runCatching {
        val parent = dest.parentFile
        if (parent != null && !ensureDir(parent)) return false
        if (dest.exists()) {
            if (!overwrite) return false
            if (!dest.delete()) return false
        }
        temp.renameTo(dest) || temp.copyTo(dest, overwrite = true).let { temp.delete(); true }
    }.getOrDefault(false)

    private fun indexOf(data: ByteArray, pattern: ByteArray, from: Int): Int {
        if (pattern.isEmpty() || data.size < pattern.size) return -1
        val start = from.coerceAtLeast(0)
        outer@ for (i in start..data.size - pattern.size) {
            for (j in pattern.indices) {
                if (data[i + j] != pattern[j]) continue@outer
            }
            return i
        }
        return -1
    }

    private fun tooLarge(maxBytes: Long): UploadResult {
        val limitStr = if (maxBytes >= 1024L * 1024 * 1024) "${maxBytes / (1024L * 1024 * 1024)} GB" else "${maxBytes / (1024 * 1024)} MB"
        return fail(413, "File is larger than the $limitStr upload limit.")
    }

    private fun fail(status: Int, message: String): UploadResult =
        UploadResult(status, mapOf("ok" to false, "error" to message))
}
