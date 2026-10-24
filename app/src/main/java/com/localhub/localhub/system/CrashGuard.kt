package com.localhub.localhub.system

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Intent
import android.os.Process
import android.os.SystemClock
import kotlin.system.exitProcess

/**
 * Last-resort crash handling.
 *
 * It cannot stop an uncaught throwable from killing the process. What it does:
 * records the crash synchronously, detects crash loops and enters safe mode, then
 * performs at most one bounded restart so the user returns to a usable app
 * instead of a repeated "app keeps stopping" dialog. Recoveries are counted and
 * surfaced in the app, so failures are reported rather than hidden.
 */
object CrashGuard {
    private const val RESTART_DELAY_MS = 400L

    fun install(
        application: Application,
        store: CrashReportStore,
        launcher: Class<*>? = null,
        screenProvider: () -> String? = { null },
        restarter: (Application, Class<*>) -> Unit = ::scheduleRestart
    ) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { handle(thread, throwable, application, store, screenProvider, restarter, launcher) }
            // Hand back to the system handler so the process still terminates
            // normally if our recovery throws.
            previous?.uncaughtException(thread, throwable)
        }
    }

    /** Visible for tests: performs recording + recovery decision. */
    fun handle(
        thread: Thread,
        throwable: Throwable,
        application: Application,
        store: CrashReportStore,
        screenProvider: () -> String? = { null },
        restarter: (Application, Class<*>) -> Unit = { _, _ -> },
        launcher: Class<*>? = null
    ) {
        val now = System.currentTimeMillis()
        val entry = CrashReport.create(thread.name, throwable, now, runCatching(screenProvider).getOrNull())
        val state = store.record(entry, now)
        if (CrashPolicy.shouldEnterSafeMode(state.crashes.map { it.timestamp }, now)) {
            store.setSafeMode(true)
            return
        }
        if (CrashPolicy.shouldAutoRestart(state.crashes.map { it.timestamp }, now, state.safeMode) && launcher != null) {
            store.noteRecovery()
            restarter(application, launcher)
        }
    }

    private fun scheduleRestart(application: Application, launcher: Class<*>) {
        val intent = Intent(application, launcher).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        val flags = PendingIntent.FLAG_ONE_SHOT or
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pending = PendingIntent.getActivity(application, 0, intent, flags)
        val alarm = application.getSystemService(AlarmManager::class.java)
        if (alarm != null) {
            alarm.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + RESTART_DELAY_MS, pending)
            Process.killProcess(Process.myPid())
            exitProcess(2)
        } else {
            // Without AlarmManager we cannot safely restart; fall through to the
            // normal system crash handling instead of looping inside the handler.
        }
    }
}
