package com.localhub.localhub.server

import org.junit.Assert.*
import org.junit.Test

/**
 * Policy checks for the HTTPS fix: a shipped/shared private key must not exist,
 * and TLS must fail closed when no per-install identity is available.
 */
class TlsFailureTest {

    @Test fun noBundledKeystoreResourceRemains() {
        val rawDir = java.io.File("src/main/res/raw")
        val bundled = rawDir.listFiles()?.firstOrNull { it.name.contains("keystore", ignoreCase = true) }
        assertNull(
            "a bundled keystore would share one private key across every install",
            bundled
        )
    }

    @Test fun noHardcodedKeystorePasswordInSource() {
        val sources = java.io.File("src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
        for (file in sources) {
            val text = file.readText()
            assertFalse(
                "hardcoded keystore password in ${file.name}",
                text.contains("\"localhub\"") && text.contains("keystore", ignoreCase = true)
            )
        }
    }

    @Test fun tlsManagerFailsClosedWithoutAKeystoreProvider() {
        // On the JVM the Android keystore is unavailable, so the manager must
        // return null instead of silently falling back to a bundled key.
        val keystore = com.localhub.localhub.system.TlsCertificateManager.keystoreOrNull()
        assertNull("no usable keystore should be reported on the JVM", keystore)
        assertFalse(com.localhub.localhub.system.TlsCertificateManager.hasIdentity())
    }
}
