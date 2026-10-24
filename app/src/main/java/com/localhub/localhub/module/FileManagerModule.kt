package com.localhub.localhub.module

import com.localhub.localhub.model.ModuleInfo
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response

/**
 * Official File Manager module. The actual pages/assets are served by the
 * server's [com.localhub.localhub.server.AssetServer] (the `/files` route); this
 * module exists so File Manager appears as a first-class, discoverable and
 * toggleable module in the dashboard and `/api/modules`.
 */
class FileManagerModule : LocalModule {
    override val id: String = "files"
    override val name: String = "File Manager"
    override val description: String = "Full browser-based file manager with preview, search, and file operations."
    override val version: String = "1.0.0"
    @Volatile override var isEnabled: Boolean = true

    override fun start() {}
    override fun stop() {}

    override fun handleRequest(session: IHTTPSession, path: String): Response? = null

    override fun toInfo(): ModuleInfo = ModuleInfo(
        id = id,
        name = name,
        description = description,
        version = version,
        enabled = isEnabled,
        registeredAt = 0
    )
}
