package com.localhub.localhub.module

import com.localhub.localhub.model.ModuleInfo
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response

/**
 * Default module that represents the built-in dashboard. The actual static
 * assets are served by the server's [com.localhub.localhub.server.AssetServer];
 * this module exists so the dashboard is discoverable and toggleable like any
 * other module.
 */
class DashboardModule : LocalModule {
    override val id: String = "dashboard"
    override val name: String = "Dashboard"
    override val description: String = "Serves the built-in responsive dashboard over HTTP."
    override val version: String = "1.0.0"
    override var isEnabled: Boolean = true

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
