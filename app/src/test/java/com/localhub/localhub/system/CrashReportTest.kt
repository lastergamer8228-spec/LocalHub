package com.localhub.localhub.system

import org.junit.Assert.*
import org.junit.Test

class CrashReportTest {
    @Test fun summarizesClassAndMessage() {
        val summary = CrashReport.summaryOf(IllegalStateException("upload failed"))
        assertEquals("IllegalStateException: upload failed", summary)
    }

    @Test fun handlesNullMessage() {
        assertEquals("RuntimeException", CrashReport.summaryOf(RuntimeException()))
    }

    @Test fun stackTraceIsTruncated() {
        val deep = RuntimeException("deep").apply {
            // Build a long chain so the rendered trace exceeds the cap.
            var cause: Throwable = this
            repeat(30) { cause = Throwable("level $it", cause) }
        }
        val text = CrashReport.stackOf(deep, maxLength = 500)
        assertTrue(text.endsWith("…truncated"))
        assertTrue(text.length <= 520)
    }

    @Test fun entryCapturesThreadSummaryAndScreen() {
        val now = 1234L
        val entry = CrashReport.create("main", IllegalStateException("boom"), now, "Settings")
        assertEquals(now, entry.timestamp)
        assertEquals("main", entry.thread)
        assertEquals("IllegalStateException: boom", entry.summary)
        assertEquals("Settings", entry.screen)
        assertTrue(entry.stack.contains("IllegalStateException"))
    }

    @Test fun longThreadAndScreenNamesAreBounded() {
        val entry = CrashReport.create("t".repeat(200), RuntimeException("x"), 1L, "s".repeat(200))
        assertEquals(64, entry.thread.length)
        assertEquals(64, entry.screen?.length)
    }
}
