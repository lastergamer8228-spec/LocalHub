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

    @Synchronized fun setEnabled(id: String, enabled: Boolean) {
        require(id in ModulePolicy.controllable) { "This component is not an independent on/off module." }
        val module = requireNotNull(getModule(id)) { "Unknown module: $id" }
        if (module.isEnabled == enabled) return
        if (enabled) module.start() else module.stop()
        module.isEnabled = enabled
    }

    fun blocked(path: String, audioVideoContent: Boolean = false): String? =
        ModulePolicy.blocked(path, { id -> getModule(id)?.isEnabled == true }, audioVideoContent)

    fun restoreEnabled(saved: Map<String, Boolean>) {
        getModules().filter { it.id in ModulePolicy.controllable }.forEach { module ->
            val legacy = if (module.id == "files") saved["core.files"] ?: true else true
            setEnabled(module.id, (saved[module.id] ?: true) && legacy)
        }
    }

    fun guardStream(path: String, media: Boolean, input: java.io.InputStream): java.io.InputStream =
        object : java.io.FilterInputStream(input) {
            override fun read(): Int = if (blocked(path, media) == null) `in`.read() else -1
            override fun read(buffer: ByteArray, off: Int, len: Int): Int =
                if (blocked(path, media) == null) `in`.read(buffer, off, len) else -1
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
