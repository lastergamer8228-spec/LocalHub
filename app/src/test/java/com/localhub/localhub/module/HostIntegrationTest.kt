package com.localhub.localhub.module

import org.junit.Assert.*
import org.junit.Test

class HostIntegrationTest {
    private fun manager()=ModuleManager().apply {
        register(DashboardModule());register(FileManagerModule());register(AIAssistantModule())
        AssistantCapabilities.all().forEach { register(it) }
        CoreCapabilities.all().filter { it.id!="core.files" }.forEach { register(it) }
    }
    @Test fun onlyEnforcedFeaturesAndRequiredComponentsAreAdvertised() {
        val host=HostIntegration.describe(manager(),"user",emptyMap(),8080,"http",100,200)
        @Suppress("UNCHECKED_CAST") val features=host["features"] as List<Map<String,Any>>
        assertEquals(ModulePolicy.controllable+setOf("core.server","core.security"),features.map { it["id"] }.toSet())
        assertFalse(features.any { it["id"]=="core.automation" || it["id"]=="core.files" })
        assertEquals(1,host["schemaVersion"])
        assertEquals("android-host-read-only",host["source"])
    }
    @Test fun disabledConfigurationAndDependenciesRemainVisible() {
        val m=manager();m.setEnabled("files",false)
        val host=HostIntegration.describe(m,"admin",emptyMap(),9090,"https",100,200)
        @Suppress("UNCHECKED_CAST") val features=host["features"] as List<Map<String,Any>>
        assertEquals(false,features.first { it["id"]=="files" }["enabled"])
        assertEquals(listOf("files"),features.first { it["id"]=="core.media" }["requires"])
        assertEquals("required",features.first { it["id"]=="core.security" }["control"])
        @Suppress("UNCHECKED_CAST") val server=host["server"] as Map<String,Any>
        assertEquals(9090,server["port"]);assertEquals("https",server["protocol"])
    }
    @Test fun userCannotBeAdvertisedAsDisruptiveRepairAdmin() {
        val host=HostIntegration.describe(manager(),"user",emptyMap(),8080,"http",100,200)
        @Suppress("UNCHECKED_CAST") val access=host["access"] as Map<String,Any>
        assertEquals(false,access["canRequestDisruptiveChange"])
    }
    @Test fun unknownPermissionValuesAndPrivateExtraFieldsAreNotEchoed() {
        val host=HostIntegration.describe(manager(),"private-token",mapOf("storage" to "private-token","rawToken" to "private-token"),8080,"http",100,200)
        @Suppress("UNCHECKED_CAST") val permissions=host["permissions"] as Map<String,String>
        assertEquals(HostIntegration.permissionKeys,permissions.keys)
        assertEquals("UNKNOWN",permissions["storage"])
        assertFalse(host.toString().contains("private-token"))
    }
    @Test fun policyIsReadRecoveryNotBlanketSystemControl() {
        val host=HostIntegration.describe(manager(),"admin",emptyMap(),8080,"http",100,200)
        @Suppress("UNCHECKED_CAST") val policy=host["chatRecoveryPolicy"] as Map<String,Any>
        assertEquals("bounded-read-recovery",policy["mode"])
        assertTrue(policy["approvalRequired"].toString().contains("file edits/deletes"))
        assertTrue(policy["neverAutomatic"].toString().contains("intentionally disabled"))
        assertFalse(policy["automatic"].toString().contains("restart"))
    }
}
