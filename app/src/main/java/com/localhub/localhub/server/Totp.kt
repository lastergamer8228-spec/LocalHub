package com.localhub.localhub.server

import java.nio.ByteBuffer
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Minimal TOTP (RFC 6238) implementation — used for optional 2FA for the admin.
 *
 * No external dependency: HMAC-SHA1 via the JDK, base32 secret encoding, and
 * the standard 30-second / 6-digit window. Deterministic and offline.
 *
 * SECURITY NOTE: real apps should use time-step verification with a small
 * allowable skew (e.g. ±1 step) and should store the secret only in DataStore.
 */
object Totp {

    /** Default TOTP period (seconds) and digits. */
    private const val PERIOD_SECONDS = 30L
    private const val DIGITS = 6

    /** Base32 alphabet (RFC 4648, no padding). */
    private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /**
     * Generates a random 160-bit (20 byte) base32 secret for enrollment.
     * 160 bits matches the HMAC-SHA1 key size and is the recommended default.
     */
    fun generateSecret(byteCount: Int = 20): String {
        val bytes = ByteArray(byteCount)
        java.security.SecureRandom().nextBytes(bytes)
        return encodeBase32(bytes).replace("=", "")
    }

    /** Encode bytes to base32 (RFC 4648). */
    fun encodeBase32(data: ByteArray): String {
        val sb = StringBuilder()
        var buffer = 0
        var bits = 0
        for (b in data) {
            buffer = (buffer shl 8) or (b.toInt() and 0xFF)
            bits += 8
            while (bits >= 5) {
                sb.append(BASE32[(buffer shr (bits - 5)) and 0x1F])
                bits -= 5
            }
        }
        if (bits > 0) sb.append(BASE32[(buffer shl (5 - bits)) and 0x1F])
        // add padding
        while (sb.length % 8 != 0) sb.append("=")
        return sb.toString()
    }

    /** Decode base32 (RFC 4648, ignores padding/whitespace). */
    fun decodeBase32(input: String): ByteArray {
        var clean = input.uppercase().replace("=", "").replace(" ", "")
        val bytesOut = java.io.ByteArrayOutputStream()
        var buffer = 0
        var bits = 0
        for (c in clean) {
            val v = BASE32.indexOf(c)
            if (v < 0) continue
            buffer = (buffer shl 5) or v
            bits += 5
            if (bits >= 8) {
                bytesOut.write((buffer shr (bits - 8)) and 0xFF)
                bits -= 8
            }
        }
        return bytesOut.toByteArray()
    }

    /** The current TOTP code for [secret] (base32), based on [timeMs]. */
    fun code(secret: String, timeMs: Long = System.currentTimeMillis()): String {
        val key = decodeBase32(secret)
        val counter = timeMs / 1000 / PERIOD_SECONDS
        val msg = ByteBuffer.allocate(8).putLong(counter).array()
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key, "HmacSHA1"))
        val hash = mac.doFinal(msg)
        val offset = hash[hash.size - 1].toInt() and 0x0F
        val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                (hash[offset + 3].toInt() and 0xFF)
        val otp = binary % Math.pow(10.0, DIGITS.toDouble()).toInt()
        return otp.toString().padStart(DIGITS, '0')
    }

    /**
     * Verifies a submitted [code] against [secret], allowing [skew] steps of
     * +/- around the current time (default 1). Constant-time-safe enough for
     * local use; use a lockout wrapper for production.
     */
    fun verify(secret: String, code: String, skew: Int = 1, timeMs: Long = System.currentTimeMillis()): Boolean {
        if (secret.isBlank() || code.isBlank()) return false
        val given = code.trim()
        for (delta in -skew..skew) {
            val t = timeMs + delta * PERIOD_SECONDS * 1000
            if (constantEquals(this.code(secret, t), given)) return true
        }
        return false
    }

    private fun constantEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }
}
