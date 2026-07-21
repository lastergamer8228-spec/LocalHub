package com.localhub.localhub.server

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.Response.Status
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the bundled dashboard (HTML/CSS/JS) straight from the app assets.
 */
class AssetServer(private val context: Context) {

    fun serve(uri: String): Response? {
        val assetPath = resolve(uri) ?: return null
        return try {
            val input = context.assets.open(assetPath)
            val bytes = input.readBytes()
            input.close()
            val mime = NanoHTTPD.getMimeTypeForFile(assetPath)
            NanoHTTPD.newFixedLengthResponse(
                Status.OK,
                mime,
                ByteArrayInputStream(bytes),
                bytes.size.toLong()
            ).apply {
                addHeader("Access-Control-Allow-Origin", "*")
                addHeader("Cache-Control", "no-cache")
            }
        } catch (e: IOException) {
            null
        }
    }

    private fun resolve(uri: String): String? = when {
        uri == "/" || uri.isEmpty() || uri == "/index.html" -> "dashboard/index.html"
        uri == "/style.css" -> "dashboard/style.css"
        uri == "/app.js" -> "dashboard/app.js"
        uri.startsWith("/dashboard/") -> "dashboard/${uri.removePrefix("/dashboard/")}"
        uri.startsWith("/assets/") -> uri.removePrefix("/")
        else -> null
    }
}
