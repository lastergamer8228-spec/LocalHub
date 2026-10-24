package com.localhub.localhub.server

import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File

/** Pure JVM coverage for the streaming upload writer (no Android, no server). */
class UploadStreamerTest {
    @get:Rule val folder = TemporaryFolder()
    private lateinit var dest: File
    private lateinit var temp: File

    @Before fun setup() {
        dest = folder.newFolder("dest")
        temp = folder.newFolder("temp")
    }

    private fun multipart(boundary: String, files: List<Pair<String, ByteArray>>): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val crlf = "\r\n".toByteArray()
        for ((name, content) in files) {
            out.write("--$boundary".toByteArray())
            out.write(crlf)
            out.write("Content-Disposition: form-data; name=\"file\"; filename=\"$name\"".toByteArray())
            out.write(crlf)
            out.write("Content-Type: application/octet-stream".toByteArray())
            out.write(crlf)
            out.write(crlf)
            out.write(content)
            out.write(crlf)
        }
        out.write("--$boundary--".toByteArray())
        out.write(crlf)
        return out.toByteArray()
    }

    @Test fun streamsASingleFileLargerThanTheReadBuffer() {
        val payload = ByteArray(300_000) { (it % 251).toByte() }
        val body = multipart("BOUND", listOf("movie.mkv" to payload))
        val result = UploadStreamer.saveMultipart(
            ByteArrayInputStream(body), body.size.toLong(), "BOUND", dest, true, temp
        )
        assertTrue(result.body.toString(), result.isOk && result.body["saved"] == 1)
        val saved = File(dest, "movie.mkv")
        assertTrue("file should exist", saved.exists())
        assertArrayEquals("bytes must survive streaming", payload, saved.readBytes())
    }

    @Test fun handlesSeveralFilesAndStraddlingBoundaries() {
        val a = ByteArray(70_000) { 1 }
        val b = ByteArray(70_000) { 2 }
        val body = multipart("XYZ-BOUNDARY-123", listOf("a.bin" to a, "b.bin" to b))
        // A tiny internal buffer forces the boundary to split across reads.
        val result = UploadStreamer.saveMultipart(
            ByteArrayInputStream(body), body.size.toLong(), "XYZ-BOUNDARY-123", dest, true, temp
        )
        assertEquals(2, result.body["saved"])
        assertArrayEquals(a, File(dest, "a.bin").readBytes())
        assertArrayEquals(b, File(dest, "b.bin").readBytes())
    }

    @Test fun rawUploadWritesTheExactBytes() {
        val payload = "hello LocalHub".toByteArray()
        val result = UploadStreamer.saveRaw(
            ByteArrayInputStream(payload), payload.size.toLong(), dest, "note.txt", true, temp
        )
        assertTrue(result.isOk)
        assertEquals("hello LocalHub", File(dest, "note.txt").readText())
    }

    @Test fun rejectsOversizeUploadsWithoutBufferingThem() {
        val body = ByteArray(0)
        val result = UploadStreamer.saveRaw(
            ByteArrayInputStream(body), 900L * 1024 * 1024, dest, "big.mkv", true, temp
        )
        assertEquals(413, result.httpStatus)
        assertFalse(File(dest, "big.mkv").exists())
    }

    @Test fun missingContentLengthIsRejectedInsteadOfWritingAnEmptyFile() {
        val result = UploadStreamer.saveRaw(ByteArrayInputStream(ByteArray(10)), null, dest, "x.bin", true, temp)
        assertEquals(411, result.httpStatus)
        assertFalse(File(dest, "x.bin").exists())
    }

    @Test fun truncatedBodyDoesNotCreateAPartialSuccess() {
        val payload = ByteArray(1000) { 9 }
        val result = UploadStreamer.saveRaw(
            ByteArrayInputStream(payload), 2000L, dest, "partial.bin", true, temp
        )
        assertEquals(400, result.httpStatus)
        assertFalse("no partial file should be reported as saved", File(dest, "partial.bin").exists())
    }

    @Test fun existingFileIsRespectedWhenOverwriteIsFalse() {
        File(dest, "keep.txt").writeText("original")
        val result = UploadStreamer.saveRaw(ByteArrayInputStream("new".toByteArray()), 3L, dest, "keep.txt", false, temp)
        assertEquals(409, result.httpStatus)
        assertEquals("original", File(dest, "keep.txt").readText())
    }

    @Test fun filenameTraversalIsStripped() {
        val result = UploadStreamer.saveRaw(
            ByteArrayInputStream("x".toByteArray()), 1L, dest, "../../evil.txt", true, temp
        )
        assertTrue(result.isOk)
        assertTrue(File(dest, "evil.txt").exists())
        assertFalse(File(dest.parentFile, "evil.txt").exists())
    }

    @Test fun multipartOverTheLimitIsRejectedAndCleansTempFiles() {
        val payload = ByteArray(2000) { 3 }
        val body = multipart("LIM", listOf("big.bin" to payload))
        val result = UploadStreamer.saveMultipart(
            ByteArrayInputStream(body), body.size.toLong(), "LIM", dest, true, temp, maxBytes = 500L
        )
        assertEquals(413, result.httpStatus)
        assertTrue("temp files must be cleaned", temp.listFiles()?.isEmpty() ?: true)
    }

    @Test fun multipartLeavesNoTemporaryFilesBehindOnSuccess() {
        val body = multipart("CLEAN", listOf("ok.bin" to ByteArray(5000) { 7 }))
        val result = UploadStreamer.saveMultipart(
            ByteArrayInputStream(body), body.size.toLong(), "CLEAN", dest, true, temp
        )
        assertTrue(result.isOk)
        assertTrue("no leftover temp files", temp.listFiles()?.isEmpty() ?: true)
    }
}
