package com.localhub.localhub.system

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Calendar
import java.util.GregorianCalendar
import javax.security.auth.x500.X500Principal

/**
 * Per-install TLS identity.
 *
 * The previous build shipped one private key inside the APK
 * (`res/raw/localhub_keystore.p12`, password hardcoded), so every installation
 * shared the same key: anyone extracting the APK could decrypt HTTPS traffic to
 * any device. This generates a keypair inside the device's Android Keystore on
 * first use; the private key never leaves the keystore and is not extractable.
 *
 * The certificate is self-signed, so browsers still warn — HTTPS here protects
 * local traffic from passive sniffing, it is not a public-trust certificate.
 */
object TlsCertificateManager {
    private const val ALIAS = "localhub_host_tls"
    private const val PROVIDER = "AndroidKeyStore"
    private const val SUBJECT = "CN=localhub.local, O=LocalHub"
    private const val KEY_SIZE = 2048
    private const val VALIDITY_YEARS = 10

    /** Returns a keystore ready for TLS, or null when the device cannot provide one. */
    fun keystoreOrNull(): KeyStore? = runCatching {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        if (!keyStore.containsAlias(ALIAS)) generate(keyStore)
        val chain = keyStore.getCertificateChain(ALIAS)
        val key = keyStore.getKey(ALIAS, null)
        if (chain.isNullOrEmpty() || chain.first() !is X509Certificate || key == null) return null
        keyStore
    }.getOrNull()

    /** True when a usable self-signed identity already exists (no key generated). */
    fun hasIdentity(): Boolean = runCatching {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        keyStore.containsAlias(ALIAS) && !keyStore.getCertificateChain(ALIAS).isNullOrEmpty()
    }.getOrDefault(false)

    private fun generate(keyStore: KeyStore) {
        val start = GregorianCalendar()
        val end = GregorianCalendar().apply { add(Calendar.YEAR, VALIDITY_YEARS) }
        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setKeySize(KEY_SIZE)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
            .setCertificateSubject(X500Principal(SUBJECT))
            .setCertificateSerialNumber(BigInteger.ONE)
            .setCertificateNotBefore(start.time)
            .setCertificateNotAfter(end.time)
            .build()

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER)
        generator.initialize(spec)
        generator.generateKeyPair()
        keyStore.load(null) // refresh view so the new chain is visible
    }
}
