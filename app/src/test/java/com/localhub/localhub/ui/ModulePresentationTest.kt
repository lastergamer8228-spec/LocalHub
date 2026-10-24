package com.localhub.localhub.ui

import com.localhub.localhub.model.ModuleInfo
import com.localhub.localhub.ui.screen.ModulePresentation
import org.junit.Assert.*
import org.junit.Test

class ModulePresentationTest {
    private fun item(id:String,enabled:Boolean=true)=ModuleInfo(id,id,"description","1",enabled)
    @Test fun featureSwitchesComeBeforeInfoOnlyComponents() {
        val list=listOf(item("assistant.mind"),item("core.server"),item("ai"),item("core.media"),item("files"))
        assertEquals(listOf("files","core.media","ai"),ModulePresentation.features(list).map { it.id })
        assertEquals(setOf("assistant.mind","core.server"),ModulePresentation.components(list).map { it.id }.toSet())
    }
    @Test fun switchingDoesNotMoveAnItem() {
        val a=listOf(item("files"),item("core.media"),item("ai"))
        val b=a.map { if(it.id=="files")it.copy(enabled=false) else it }
        assertEquals(ModulePresentation.features(a).map { it.id },ModulePresentation.features(b).map { it.id })
        assertEquals(2,ModulePresentation.features(b).count { it.enabled })
    }
    @Test fun emptyRegistryProducesNoPhantomRows() {
        assertTrue(ModulePresentation.features(emptyList()).isEmpty())
        assertTrue(ModulePresentation.components(emptyList()).isEmpty())
    }
}
