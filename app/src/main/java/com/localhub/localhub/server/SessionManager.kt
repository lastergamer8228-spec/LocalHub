package com.localhub.localhub.server

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Secure session store + authentication primitives for the LocalHub web UI.
 *
 * Roles:
 *   - "admin": full access (server control, dev tools, config, logs, modules)
 *   - "user":  standard web user (files, media, dashboard, limited assistant)
 *
 * Security features:
 *   - Passwords stored as salted SHA-256 hashes (never plaintext).
 *   - Sessions are random 256-bit tokens bound to role + IP + expiry.
 *   - Login rate limiting + brute-force lockout per IP.
 *   - Constant-time credential comparison.
 * All state is in-memory (cleared on process restart).
 */
class SessionManager {

    data class Session(
        val token: String,
        val role: String,
        val ip: String,
        val createdAt: Long,
        var lastSeen: Long,
        var expiresAt: Long
    )

    private val sessions = ConcurrentHashMap<String, Session>()

    // Login attempt tracking per IP: deque of timestamps.
    private val loginAttempts = ConcurrentHashMap<String, ConcurrentLinkedQueue<Long>>()
    private val lockouts = ConcurrentHashMap<String, Long>() // ip -> unlock time

    /** Short session TTL (no "remember me"): 30 minutes of inactivity. */
    private val defaultTtlMs = 30L * 60 * 1000

    /** Long session TTL ("remember me"): 30 days. */
    private val rememberTtlMs = 30L * 24 * 60 * 60 * 1000

    // Rate-limit config: allow up to 5 attempts per 5 minutes per IP, then lock 10 minutes.
    private val maxAttempts = 5
    private val windowMs = 5L * 60 * 1000
    private val lockoutMs = 10L * 60 * 1000

    private val secureRandom = SecureRandom()

    // ---- Sessions ----

    fun create(role: String, ip: String, remember: Boolean): Session {
        val token = newToken()
        val now = System.currentTimeMillis()
        val ttl = if (remember) rememberTtlMs else defaultTtlMs
        val s = Session(token, role, ip, now, now, now + ttl)
        sessions[token] = s
        return s
    }

    /** Validates a token and bumps lastSeen. Returns the session or null. */
    fun validate(token: String, ip: String): Session? {
        if (token.isBlank()) return null
        val s = sessions[token] ?: return null
        val now = System.currentTimeMillis()
        if (now > s.expiresAt) { sessions.remove(token); return null }
        if (s.ip != ip) return null
        s.lastSeen = now
        return s
    }

    fun role(token: String): String? = sessions[token]?.role

    fun revoke(token: String) { sessions.remove(token) }

    fun revokeAll() { sessions.clear() }

    fun count(): Int = sessions.size

    fun hasRole(token: String, requiredRole: String): Boolean {
        val r = role(token) ?: return false
        return if (requiredRole == "admin") r == "admin" else r == "admin" || r == "user"
    }

    // ---- Login rate limiting / brute-force protection ----

    /** Returns true if the IP is currently locked out. */
    fun isLockedOut(ip: String): Boolean {
        val unlock = lockouts[ip] ?: return false
        if (System.currentTimeMillis() < unlock) return true
        lockouts.remove(ip)
        return false
    }

    /** Records a failed attempt; locks the IP if the window threshold is exceeded. */
    fun recordFailedAttempt(ip: String) {
        val now = System.currentTimeMillis()
        val q = loginAttempts.computeIfAbsent(ip) { ConcurrentLinkedQueue() }
        q.add(now)
        // Prune attempts older than the window.
        while (q.peek() != null && now - q.peek()!! > windowMs) q.poll()
        if (q.size >= maxAttempts) {
            lockouts[ip] = now + lockoutMs
            q.clear()
        }
    }

    /** Clears failed-attempt tracking for an IP after a successful login. */
    fun clearAttempts(ip: String) {
        loginAttempts.remove(ip)
        lockouts.remove(ip)
    }

    fun attemptsRemaining(ip: String): Int {
        val q = loginAttempts[ip] ?: return maxAttempts
        val now = System.currentTimeMillis()
        while (q.peek() != null && now - q.peek()!! > windowMs) q.poll()
        return (maxAttempts - q.size).coerceAtLeast(0)
    }

    // ---- Password hashing ----

    /**
     * Hashes a password with a random 16-byte salt (hex). Format: saltHex:hashHex.
     * Never stores the plaintext password.
     */
    fun hashPassword(password: String): String {
        val salt = ByteArray(16)
        secureRandom.nextBytes(salt)
        val hash = sha256(salt + password.toByteArray(Charsets.UTF_8))
        return salt.toHex() + ":" + hash
    }

    /** Verifies a plaintext password against a stored "salt:hash" string. */
    fun verifyPassword(password: String, stored: String): Boolean {
        if (stored.isBlank()) return false
        val parts = stored.split(":")
        if (parts.size != 2) {
            // Legacy: stored as raw value; compare directly (constant-time) for backward compat.
            return constantEquals(password, stored)
        }
        val salt = parts[0].hexToBytes() ?: return false
        val expected = parts[1]
        val actual = sha256(salt + password.toByteArray(Charsets.UTF_8))
        return constantEquals(actual, expected)
    }

    /** True if the stored credential is still a plaintext/default (needs re-hash). */
    fun needsRehash(stored: String): Boolean = !stored.contains(":")

    fun newToken(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return bytes.toHex()
    }

    fun sha256(input: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(input).toHex()

    fun sha256(input: String): String = sha256(input.toByteArray(Charsets.UTF_8))

    /** Constant-time string comparison. */
    fun constantEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.hexToBytes(): ByteArray? = runCatching {
        ByteArray(length / 2) { i -> this.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }.getOrNull()
}
