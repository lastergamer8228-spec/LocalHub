package com.localhub.localhub.module

import com.localhub.localhub.model.ModuleInfo
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Tracks registered modules, dispatches HTTP requests to them, and exposes
 * their metadata for the dashboard / REST API.
 */
class ModuleManager {

    private val modules = CopyOnWriteArrayList<LocalModule>()

    fun register(module: LocalModule) {
        if (modules.none { it.id == module.id }) {
            modules.add(module)
            if (module.isEnabled) module.start()
        }
    }

    fun unregister(id: String) {
        val module = getModule(id) ?: return
        if (module.isEnabled) module.stop()
        modules.remove(module)
    }

    fun getModule(id: String): LocalModule? = modules.firstOrNull { it.id == id }

    fun getModules(): List<LocalModule> = modules.toList()

    fun getEnabledModules(): List<LocalModule> = modules.filter { it.isEnabled }

    fun toInfoList(): List<ModuleInfo> = modules.map { it.toInfo() }

    fun setEnabled(id: String, enabled: Boolean) {
        val module = getModule(id) ?: return
        module.isEnabled = enabled
        if (enabled) module.start() else module.stop()
    }

    /** Give every enabled module a chance to answer [path]; first non-null wins. */
    fun findHandler(session: IHTTPSession, path: String): Response? {
        for (module in getEnabledModules()) {
            runCatching { module.handleRequest(session, path) }
                .getOrNull()
                ?.let { return it }
        }
        return null
    }
}
