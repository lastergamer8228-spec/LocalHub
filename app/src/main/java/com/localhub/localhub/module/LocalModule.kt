package com.localhub.localhub.module

import com.localhub.localhub.model.ModuleInfo
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response

/**
 * Contract every LocalHub module must implement. Modules can contribute HTTP
 * routes through [handleRequest] and expose metadata through [toInfo].
 */
interface LocalModule {
    val id: String
    val name: String
    val description: String
    val version: String
    var isEnabled: Boolean

    fun start()
    fun stop()

    /** Return a [Response] to handle [path], or null to defer to the next module. */
    fun handleRequest(session: IHTTPSession, path: String): Response?

    fun toInfo(): ModuleInfo
}
