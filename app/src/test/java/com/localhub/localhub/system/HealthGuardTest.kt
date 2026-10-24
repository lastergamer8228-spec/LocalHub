package com.localhub.localhub.system

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** Crash store/guard behaviour on a real (Robolectric) Application, not a phone. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34])
class HealthGuardTest {
    private lateinit var app: Application
    private lateinit var file: File
    private lateinit var store: CrashReportStore

    @Before fun setup() {
        app = ApplicationProvider.getApplicationContext()
        file = File(app.filesDir, "health/crash_log.json")
        file.delete()
        store = CrashReportStore(file)
    }

    @Test fun crashIsRecordedAndSurvivesANewStoreInstance() {
        store.record(CrashReport.create("main", IllegalStateException("upload failed"), 1000L, "Files"))
        val reloaded = CrashReportStore(file).read()
        assertEquals(1, reloaded.crashes.size)
        assertEquals("IllegalStateException: upload failed", reloaded.lastCrash?.summary)
        assertTrue(reloaded.lastCrash?.stack?.contains("IllegalStateException") == true)
        assertEquals("Files", reloaded.lastCrash?.screen)
    }

    @Test fun singleCrashRestartsOnceAndCountsRecovery() {
        var restarts = 0
        CrashGuard.handle(Thread("main"), RuntimeException("first"), app, store, { "Home" }, { _, _ -> restarts++ }, app.javaClass)
        val state = store.read()
        assertEquals(1, restarts)
        assertEquals(1, state.recoveries)
        assertFalse(state.safeMode)
        assertEquals(1, state.crashes.size)
    }

    @Test fun repeatedCrashesEnterSafeModeAndStopRestarting() {
        var restarts = 0
        repeat(4) { index ->
            CrashGuard.handle(
                Thread("main"), RuntimeException("crash $index"), app, store,
                { "Home" }, { _, _ -> restarts++ }, app.javaClass
            )
            Thread.sleep(5)
        }
        val state = store.read()
        assertTrue("safe mode should engage", state.safeMode)
        assertTrue("restarts must stop early", restarts <= CrashPolicy.SAFE_MODE_THRESHOLD - 1)
        assertTrue(state.crashes.size >= CrashPolicy.SAFE_MODE_THRESHOLD)
    }

    @Test fun safeModeCanBeCleared() {
        store.setSafeMode(true)
        assertTrue(store.read().safeMode)
        store.setSafeMode(false)
        assertFalse(store.read().safeMode)
        // Crash log is kept for diagnosis even after leaving safe mode.
        store.record(CrashReport.create("main", RuntimeException("x"), System.currentTimeMillis()))
        assertEquals(1, store.read().crashes.size)
    }

    @Test fun lowMemoryEventsAreCounted() {
        store.noteLowMemory()
        store.noteLowMemory()
        assertEquals(2, store.read().lowMemoryEvents)
    }

    @Test fun clearingCrashesKeepsCounters() {
        store.noteLowMemory()
        store.record(CrashReport.create("main", RuntimeException("x"), System.currentTimeMillis()))
        store.clearCrashes()
        val state = store.read()
        assertTrue(state.crashes.isEmpty())
        assertEquals(1, state.lowMemoryEvents)
    }

    @Test fun memoryPressureClearsOnlyTemporaryCaches() {
        val upload = File(app.cacheDir, "uploads/ul_1.part").apply { parentFile?.mkdirs(); writeText("partial") }
        val audio = File(app.cacheDir, "compatible-audio-v2/x.m4a").apply { parentFile?.mkdirs(); writeBytes(ByteArray(10)) }
        val keep = File(app.cacheDir, "other/keep.txt").apply { parentFile?.mkdirs(); writeText("keep") }
        val freed = MemoryGuard.clearCaches(app.cacheDir)
        assertEquals(2, freed)
        assertFalse(upload.exists())
        assertFalse(audio.exists())
        assertTrue("unrelated cache files must stay", keep.exists())
    }

    @Test fun describeReportsStateHonestly() {
        val empty = store.describe(store.read(), 1_000_000L)
        assertTrue(empty.contains("No crashes recorded"))
        store.record(CrashReport.create("main", RuntimeException("boom"), 900_000L))
        val text = store.describe(store.read(), 1_000_000L)
        assertTrue(text.contains("boom"))
        assertTrue(text.contains("Crashes in last 24h: 1"))
        assertTrue(text.contains("Safe mode: off"))
    }

    @Test fun corruptedStoreFileFallsBackToEmptyState() {
        file.parentFile?.mkdirs()
        file.writeText("{not json")
        val state = CrashReportStore(file).read()
        assertTrue(state.crashes.isEmpty())
        assertFalse(state.safeMode)
    }
}
