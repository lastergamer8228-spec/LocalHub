package com.localhub.localhub.server

import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Manages short-lived, unauthenticated LAN share links.
 *
 * An admin creates a share for a file/folder and gets a random token that lets
 * anyone on the LAN open/download it WITHOUT logging in, for a limited time.
 * This is a convenience feature for a trusted local network — tokens are
 * random (128-bit), expire, and can be revoked. It never exposes anything the
 * admin didn't explicitly share.
 */
class ShareTokenManager {

    data class Share(
        val token: String,
        val path: String,
        val createdAt: Long,
        val expiresAt: Long,
        val isFolder: Boolean
    )

    private val shares = ConcurrentHashMap<String, Share>()
    private val secureRandom = SecureRandom()

    /** Default TTL: 1 hour. */
    fun create(path: String, isFolder: Boolean, ttlMs: Long = 3_600_000L): Share {
        val token = newToken()
        val now = System.currentTimeMillis()
        val share = Share(token, path, now, now + ttlMs, isFolder)
        shares[token] = share
        return share
    }

    /** Returns the share for [token] if valid and not expired; else null. */
    fun resolve(token: String): Share? {
        if (token.isBlank()) return null
        val s = shares[token] ?: return null
        if (System.currentTimeMillis() > s.expiresAt) {
            shares.remove(token)
            return null
        }
        return s
    }

    fun revoke(token: String) { shares.remove(token) }

    fun list(): List<Share> = shares.values.sortedByDescending { it.createdAt }

    fun count(): Int = shares.size

    private fun newToken(): String {
        val bytes = ByteArray(16) // 128-bit
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
