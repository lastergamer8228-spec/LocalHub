package com.localhub.localhub.module

import com.localhub.localhub.model.ModuleInfo
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response

/**
 * Official AI Assistant module. The AI panel lives at `/ai` and is served by
 * [com.localhub.localhub.server.AssetServer]; this module makes the assistant
 * discoverable and toggleable in the dashboard and `/api/modules`.
 */
class AIAssistantModule : LocalModule {
    override val id: String = "ai"
    override val name: String = "AI Assistant"
    override val description: String = "Built-in offline assistant that controls LocalHub through its internal APIs."
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
