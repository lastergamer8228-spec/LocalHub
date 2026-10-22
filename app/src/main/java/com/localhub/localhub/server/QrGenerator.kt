package com.localhub.localhub.server

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream

/**
 * Generates a QR code PNG for a given payload (e.g. a LocalHub URL) using ZXing.
 * Used by the dashboard to show a scannable link to the phone's LocalHub server.
 */
object QrGenerator {

    /**
     * Renders [text] as a QR code PNG byte array at [size]×[size] pixels.
     * Returns null if the payload cannot be encoded.
     */
    fun png(text: String, size: Int = 512): ByteArray? = runCatching {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bmp.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
            }
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        out.toByteArray()
    }.getOrNull()
}
