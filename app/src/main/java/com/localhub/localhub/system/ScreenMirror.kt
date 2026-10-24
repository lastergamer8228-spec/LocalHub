package com.localhub.localhub.system

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.view.WindowManager

/**
 * Screen Mirror — captures the device screen via MediaProjection (public API,
 * no root) and makes the latest frame available as a JPEG byte array that the
 * embedded server streams to a web page.
 *
 * USAGE (bina root):
 *   1. Activity launches MediaProjectionManager.createScreenCaptureIntent() and
 *      calls [start] with the returned resultCode + data.
 *   2. The server exposes the latest JPEG via a streaming endpoint.
 *   3. The web page shows it live (dekhna).
 *
 * AUDIO: capturing screen audio requires MediaProjection's AudioPlaybackCapture
 * + a separate audio pipeline. Video streaming is provided here; audio is a
 * follow-up and is intentionally out of scope of this single class.
 *
 * CONTENT: only captures frames while running. Stop via [stop].
 */
class ScreenMirror(private val context: Context) {

    @Volatile private var mediaProjection: MediaProjection? = null
    @Volatile private var virtualDisplay: VirtualDisplay? = null
    @Volatile private var imageReader: ImageReader? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null

    /** Latest JPEG frame (null when not capturing). Guarded by [frameLock]. */
    @Volatile private var latestJpeg: ByteArray? = null
    private val frameLock = Any()

    /** Set to the size of the screen we capture. */
    @Volatile private var captureWidth = 1080
    @Volatile private var captureHeight = 1920

    val isRunning: Boolean
        get() = mediaProjection != null && virtualDisplay != null

    /** Last start/error message (for the status API to surface). */
    @Volatile var lastError: String? = null
        private set

    /** Start capturing with the result of createScreenCaptureIntent(). */
    /** Start capturing with the result of createScreenCaptureIntent().
     *  [serviceContext] must be the foreground MediaProjection service context
     *  (required on Android 14+). */
    fun start(serviceContext: Context, resultCode: Int, resultData: Intent?): Boolean {
        if (mediaProjection != null) return true
        return try {
            val mpm = serviceContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            require(resultCode == android.app.Activity.RESULT_OK && resultData != null) { "Screen capture consent is required" }
            val proj = mpm.getMediaProjection(resultCode, resultData) ?: return false
            mediaProjection = proj // retained early so startup errors release it

            // Screen metrics (use current window bounds when available)
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            runCatching {
                (serviceContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
                    .defaultDisplay.getRealMetrics(metrics)
            }.onFailure {
                metrics.setToDefaults()
            }
            var w = metrics.widthPixels
            var h = metrics.heightPixels
            val maxDim = 1280
            if (w > 0 && h > 0) {
                if (maxOf(w, h) > maxDim) {
                    val scale = maxDim.toFloat() / maxOf(w, h)
                    w = (w * scale).toInt()
                    h = (h * scale).toInt()
                }
                captureWidth = if (w % 2 == 0) w else w - 1
                captureHeight = if (h % 2 == 0) h else h - 1
            } else {
                // Fallback to a sane default if real metrics are unavailable.
                captureWidth = 720
                captureHeight = 1280
            }
            lastError = null

            // Dedicated handler thread for capture callbacks
            captureThread = HandlerThread("mirror-capture").apply { start() }
            captureHandler = Handler(captureThread!!.looper)

            val callback = object : MediaProjection.Callback() {
                override fun onStop() {
                    stop()
                    context.stopService(Intent(context, com.localhub.localhub.service.MirrorService::class.java))
                }
            }
            projectionCallback = callback
            proj.registerCallback(callback, captureHandler) // required before virtual display on Android 14+

            val reader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
            reader.setOnImageAvailableListener({ r -> onFrame(r) }, captureHandler)
            imageReader = reader

            // Create the virtual display directly on the MediaProjection. Use an
            // explicit Surface + Handler so the (Java) overload resolves cleanly.
            val outSurface: android.view.Surface = reader.surface
            virtualDisplay = proj.createVirtualDisplay(
                "LocalHubMirror",
                captureWidth,
                captureHeight,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                outSurface,
                null,
                captureHandler
            )
            mediaProjection = proj
            lastError = null
            true
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            stop()
            false
        }
    }

    /** Capture callback -> encode the Image to JPEG and store it. */
    private fun onFrame(reader: ImageReader) {
        var image: Image? = null
        try {
            image = reader.acquireLatestImage() ?: return
            val buffer = image.planes[0].buffer
            val width = image.width
            val height = image.height
            val pixelStride = image.planes[0].pixelStride
            val rowStride = image.planes[0].rowStride
            val rowPadding = rowStride - pixelStride * width

            // Build a Bitmap from the RGBA buffer, then encode to JPEG.
            val bmp = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(buffer)
            val cropped = Bitmap.createBitmap(bmp, 0, 0, width, height)
            val out = java.io.ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.JPEG, 60, out)
            synchronized(frameLock) {
                latestJpeg = out.toByteArray()
            }
            if (cropped !== bmp) cropped.recycle()
            bmp.recycle()
        } catch (e: Exception) {
            // skip a frame on transient errors
        } finally {
            image?.close()
        }
    }

    /** Returns the latest JPEG frame, or null if not capturing. */
    fun latestFrame(): ByteArray? {
        synchronized(frameLock) { return latestJpeg }
    }

    fun stop() {
        synchronized(frameLock) { latestJpeg = null }
        try { virtualDisplay?.release() } catch (_: Exception) {}
        virtualDisplay = null
        try { imageReader?.close() } catch (_: Exception) {}
        imageReader = null
        val projection = mediaProjection
        mediaProjection = null
        try { projectionCallback?.let { projection?.unregisterCallback(it) } } catch (_: Exception) {}
        projectionCallback = null
        try { projection?.stop() } catch (_: Exception) {}
        captureThread?.quitSafely()
        captureThread = null
        captureHandler = null
    }
}
