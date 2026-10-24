package com.localhub.localhub.system

import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.WindowManager

/**
 * Device Actions — lets LocalHub control the host phone through public Android
 * APIs. Everything here works WITHOUT root. Actions are exposed via the REST API
 * (admin-only) and the Assistant, so a web user can toggle the flashlight,
 * change brightness, mute the phone, open an app, take a screenshot, etc.
 *
 * NOTE: actions that Android reserves for system apps (turning the hotspot /
 * mobile-data on) are NOT possible from a normal app without root or ADB
 * device-owner. Those are intentionally reported as "requires root/device-owner".
 */
class DeviceActions(private val context: Context) {

    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    // ---- Flashlight ----
    fun setTorch(on: Boolean): Map<String, Any> {
        return try {
            val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = cm.cameraIdList.firstOrNull { cid ->
                val ch = cm.getCameraCharacteristics(cid)
                ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            } ?: return mapOf("ok" to false, "error" to "No camera/flash available.")
            cm.setTorchMode(id, on)
            mapOf("ok" to true, "action" to "torch", "state" to on)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "torch failed"))
        }
    }

    // ---- Screen brightness (0..255) ----
    fun setBrightness(level: Int): Map<String, Any> {
        val clamped = level.coerceIn(0, 255)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(context)) {
                return mapOf("ok" to false, "error" to "WRITE_SETTINGS permission not granted", "action" to "brightness")
            }
            Settings.System.putInt(
                context.contentResolver,
                Settings.System.SCREEN_BRIGHTNESS, clamped
            )
            // Apply immediately if we have the app-level brightness access via an activity.
            mapOf("ok" to true, "action" to "brightness", "level" to clamped)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "brightness failed"))
        }
    }

    // ---- Auto-rotate toggle ----
    fun setAutoRotate(on: Boolean): Map<String, Any> {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(context)) {
                return mapOf("ok" to false, "error" to "WRITE_SETTINGS permission not granted", "action" to "rotate")
            }
            Settings.System.putInt(
                context.contentResolver,
                Settings.System.ACCELEROMETER_ROTATION, if (on) 1 else 0
            )
            mapOf("ok" to true, "action" to "rotate", "state" to on)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "rotate failed"))
        }
    }

    // ---- Ringer / DND mode ----
    fun setRinger(mode: String): Map<String, Any> {
        // "normal" | "silent" | "vibrate" | "dnd"
        val m = when (mode.lowercase()) {
            "normal", "sound", "ring" -> AudioManager.RINGER_MODE_NORMAL
            "silent", "mute" -> AudioManager.RINGER_MODE_SILENT
            "vibrate" -> AudioManager.RINGER_MODE_VIBRATE
            "dnd", "priority" -> {
                // Requires NotificationPolicyAccess; return informative error if not.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !notificationPolicyAccess()) {
                    return mapOf("ok" to false, "error" to "DND requires Notification access permission", "action" to "dnd")
                }
                return try {
                    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                    manager.setInterruptionFilter(android.app.NotificationManager.INTERRUPTION_FILTER_PRIORITY)
                    val applied = manager.currentInterruptionFilter == android.app.NotificationManager.INTERRUPTION_FILTER_PRIORITY
                    mapOf("ok" to applied, "action" to "dnd", "state" to applied)
                } catch (e: Exception) { mapOf("ok" to false, "error" to (e.message ?: "DND change rejected")) }
            }
            else -> return mapOf("ok" to false, "error" to "Unknown ringer mode: $mode")
        }
        return try {
            audio.ringerMode = m
            mapOf("ok" to true, "action" to "ringer", "mode" to mode)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "ringer failed"))
        }
    }

    // ---- Volume (0..100) ----
    fun setVolume(level: Int): Map<String, Any> {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (level.coerceIn(0, 100) * max / 100)
        return try {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
            mapOf("ok" to true, "action" to "volume", "level" to level, "max" to max)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "volume failed"))
        }
    }

    fun adjustVolume(delta: Int): Map<String, Any> {
        val dir = if (delta > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, 0)
        return mapOf("ok" to true, "action" to "volume_adjust", "delta" to delta)
    }

    // ---- Vibrate ----
    fun vibrate(durationMs: Long): Map<String, Any> {
        return try {
            val vib: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vib.vibrate(durationMs)
                }
                mapOf("ok" to true, "action" to "vibrate", "durationMs" to durationMs)
            } else {
                mapOf("ok" to false, "error" to "No vibrator on this device.")
            }
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "vibrate failed"))
        }
    }

    // ---- Open app / URL ----
    fun open(intentData: String): Map<String, Any> {
        return try {
            val intent = Intent(Intent.ACTION_VIEW)
            intent.setData(android.net.Uri.parse(intentData))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            mapOf("ok" to true, "action" to "open", "target" to intentData)
        } catch (e: Exception) {
            mapOf("ok" to false, "error" to (e.message ?: "open failed"))
        }
    }

    // ---- Screenshot (needs MediaProjection consent) ----
    // A full screenshot requires MediaProjection (user consent per session).
    // We return an informative response so the UI knows it needs an Activity.
    fun screenshotRequest(): Map<String, Any> =
        mapOf("ok" to false, "needsActivity" to true, "action" to "screenshot",
              "error" to "Screenshot requires MediaProjection permission (user consent).")

    private fun notificationPolicyAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.isNotificationPolicyAccessGranted
        } else true

    /** True if the app can write system settings (needed for brightness/rotate). */
    fun canWriteSettings(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.System.canWrite(context)

    fun canUseNotificationPolicy(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .isNotificationPolicyAccessGranted
}
