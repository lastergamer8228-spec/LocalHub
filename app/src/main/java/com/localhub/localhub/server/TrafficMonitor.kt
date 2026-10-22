package com.localhub.localhub.server

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * In-memory traffic + activity monitor for the NAS dashboard. Tracks cumulative
 * bytes served/uploaded, activity counters (downloads, uploads, media streams,
 * files opened) and the current number of active transfers. Values are reset on
 * process start; there is intentionally no persistence (matches the lightweight
 * in-memory design of [ClientTracker]).
 */
object TrafficMonitor {

    private val downloadBytes = AtomicLong(0)
    private val uploadBytes = AtomicLong(0)
    private val mediaStreams = AtomicLong(0)
    private val filesOpened = AtomicLong(0)
    private val downloadsToday = AtomicLong(0)
    private val uploadsToday = AtomicLong(0)
    private val activeTransfers = AtomicInteger(0)
    private val peakConcurrent = AtomicInteger(0)
    private val startEpochDay = currentEpochDay()

    /** Local date as days-since-epoch (Calendar avoids java.time on older APIs). */
    private fun currentEpochDay(): Long {
        val c = java.util.Calendar.getInstance()
        return c.get(java.util.Calendar.YEAR).toLong() * 372 + (c.get(java.util.Calendar.DAY_OF_YEAR).toLong())
    }

    fun recordDownload(bytes: Long) {
        downloadBytes.addAndGet(bytes)
        downloadsToday.incrementAndGet()
    }

    fun recordUpload(bytes: Long) {
        uploadBytes.addAndGet(bytes)
        uploadsToday.incrementAndGet()
    }

    fun recordMedia() = mediaStreams.incrementAndGet()

    fun recordFileOpened() = filesOpened.incrementAndGet()

    /** Call when a streaming/download/upload operation begins. */
    fun transferStarted() {
        val cur = activeTransfers.incrementAndGet()
        peakConcurrent.updateAndGet { max -> maxOf(max, cur) }
    }

    /** Call when the operation completes / its stream closes. */
    fun transferEnded() {
        activeTransfers.updateAndGet { maxOf(0, it - 1) }
    }

    fun snapshot(): Map<String, Any> {
        // Rough "today" semantics: reset counters on a new local day.
        val today = currentEpochDay()
        val reset = today != startEpochDay
        val dl = if (reset) 0L else downloadBytes.get()
        val ul = if (reset) 0L else uploadBytes.get()
        val dlc = if (reset) 0L else downloadsToday.get()
        val ulc = if (reset) 0L else uploadsToday.get()
        return mapOf(
            "downloadBytes" to dl,
            "uploadBytes" to ul,
            "mediaStreams" to mediaStreams.get(),
            "filesOpened" to filesOpened.get(),
            "downloadsToday" to dlc,
            "uploadsToday" to ulc,
            "activeTransfers" to activeTransfers.get(),
            "peakConcurrent" to peakConcurrent.get()
        )
    }
}
