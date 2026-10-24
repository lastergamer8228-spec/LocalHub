package com.localhub.localhub.system

import org.junit.Assert.*
import org.junit.Test

class CrashPolicyTest {
    @Test fun countsOnlyRecentCrashes() {
        val now = 1_000_000L
        val stamps = listOf(now - 25 * 3600_000L, now - 60_000L, now)
        assertEquals(2, CrashPolicy.recentCount(stamps, now))
        assertEquals(2, CrashPolicy.recentCount(stamps, now, 120_000L))
    }

    @Test fun safeModeAfterRepeatedCrashesInWindow() {
        val now = 100_000L
        val two = listOf(now - 30_000L, now)
        assertFalse(CrashPolicy.shouldEnterSafeMode(two, now))
        val three = listOf(now - 90_000L, now - 60_000L, now)
        assertTrue(CrashPolicy.shouldEnterSafeMode(three, now))
    }

    @Test fun oldCrashesDoNotTriggerSafeMode() {
        val now = 10_000_000L
        val spread = listOf(now - 10 * 60_000L, now - 5 * 60_000L, now - 4 * 60_000L)
        assertFalse(CrashPolicy.shouldEnterSafeMode(spread, now))
    }

    @Test fun restartStopsWhenLoopSuspectedOrSafeModeOn() {
        val now = 100_000L
        val loop = listOf(now - 20_000L, now - 10_000L, now)
        assertFalse(CrashPolicy.shouldAutoRestart(loop, now, safeMode = false))
        val single = listOf(now)
        assertTrue(CrashPolicy.shouldAutoRestart(single, now, safeMode = false))
        assertFalse(CrashPolicy.shouldAutoRestart(single, now, safeMode = true))
    }

    @Test fun pruningKeepsRecentAndBoundedHistory() {
        val now = 5_000_000L
        val many = (0 until 40).map { now - it * 60_000L }
        val pruned = CrashPolicy.pruned(many, now)
        assertEquals(20, pruned.size)
        assertTrue(pruned.all { it >= now - CrashPolicy.SUMMARY_WINDOW_MS })
    }
}
