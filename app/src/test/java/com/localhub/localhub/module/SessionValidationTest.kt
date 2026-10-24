package com.localhub.localhub.module

import com.localhub.localhub.server.SessionManager
import org.junit.Assert.*
import org.junit.Test

/** JVM authentication primitives; not an HTTP/device test. */
class SessionValidationTest {
    @Test fun validSessionHasItsRole() {
        val manager=SessionManager()
        val session=manager.create("admin","192.168.1.10",false)
        assertEquals("admin",manager.validate(session.token,"192.168.1.10")?.role)
    }
    @Test fun expiredSessionCannotSupplyCurrentRole() {
        val manager=SessionManager()
        val session=manager.create("admin","192.168.1.10",false)
        session.expiresAt=System.currentTimeMillis()-1
        assertNull(manager.validate(session.token,"192.168.1.10"))
        assertNull(manager.role(session.token))
    }
    @Test fun wrongIpIsRejectedWithoutRevokingTheCorrectClient() {
        val manager=SessionManager()
        val session=manager.create("user","192.168.1.10",false)
        assertNull(manager.validate(session.token,"192.168.1.11"))
        assertEquals("user",manager.validate(session.token,"192.168.1.10")?.role)
    }
    @Test fun revokedAndEmptyTokensAreRejected() {
        val manager=SessionManager()
        val session=manager.create("admin","192.168.1.10",false)
        manager.revoke(session.token)
        assertNull(manager.validate(session.token,"192.168.1.10"))
        assertNull(manager.validate("","192.168.1.10"))
    }
}
