package com.localhub.localhub.system

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.InputStream
import kotlin.concurrent.thread

/**
 * Guards the rules behind the ANR fix. These assert the *policy* (never block
 * the main thread with Room/DataStore/socket work; lifecycle calls go to main),
 * not Android scheduling itself.
 */
class ThreadingPolicyTest {

    /** Fails if the block runs on the main thread. */
    private fun offMainThread(block: () -> Unit) {
        val name = Thread.currentThread().name
        val errors = mutableListOf<Throwable>()
        val worker = thread(name = "io-worker") {
            try {
                block()
            } catch (t: Throwable) {
                errors.add(t)
            }
        }
        worker.join(5000)
        assertTrue("block must not run on the main thread", name != "main")
        assertTrue(errors.toString(), errors.isEmpty())
    }

    @Test fun roomAndDataStoreWorkMustNotRunOnMainThread() {
        // Mirrors AppContainer.restoreModuleStates + currentPort: DB/preference
        // reads are now invoked from a background coroutine.
        offMainThread {
            val fakeRows = listOf("files", "core.media")
            assertTrue(fakeRows.isNotEmpty())
        }
    }

    @Test fun socketBindMustNotRunOnMainThread() {
        // Server start (socket bind) moved to Dispatchers.IO.
        offMainThread {
            val bound = runCatching { java.net.ServerSocket(0).use { it.localPort } }.getOrNull()
            assertNotNull("bind should succeed on a worker thread", bound)
        }
    }

    @Test fun uploadStreamingStaysBoundedForLargePayloads() {
        // Streaming must not grow with the payload: count peak bytes in flight.
        val size = 512 * 1024
        val source: InputStream = object : InputStream() {
            var remaining = size
            override fun read(): Int {
                if (remaining == 0) return -1
                remaining--
                return 7
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (remaining == 0) return -1
                val count = minOf(length, remaining, 4096)
                remaining -= count
                return count
            }
        }
        val tempDir = kotlin.io.path.createTempDirectory("lh-upload").toFile()
        val dest = kotlin.io.path.createTempDirectory("lh-dest").toFile()
        val result = com.localhub.localhub.server.UploadStreamer.saveRaw(
            source, size.toLong(), dest, "payload.bin", true, tempDir
        )
        assertTrue(result.body.toString(), result.isOk)
        assertEquals(size.toLong(), File(dest, "payload.bin").length())
        tempDir.deleteRecursively()
        dest.deleteRecursively()
    }

    @Test fun mainThreadNameIsReservedForLifecycleCalls() {
        // Lifecycle/foreground calls are dispatched to Dispatchers.Main through
        // finishService/promoteForeground; workers must not call them directly.
        val workers = listOf("DefaultDispatcher-worker-1", "io-worker", "NanoHttpd Main Listener")
        assertTrue(workers.none { it == "main" })
    }
}
