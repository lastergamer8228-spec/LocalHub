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

    private companion object {
        /**
         * Any other root-level static file belongs to the dashboard bundle.
         *
         * Without this fallback every new dashboard asset silently 404s: on
         * 2026-10-24 theme-pro.css and nav.js shipped in the APK but were not in
         * the explicit map below, so the redesign rendered half-styled and with
         * no navigation. Extensions are allow-listed so this can never shadow
         * an API route or a page route such as /files or /player.
         */
        private val ROOT_DASHBOARD_ASSET =
            Regex("^/[A-Za-z0-9._-]+\\.(css|js|mjs|json|png|jpe?g|gif|svg|ico|webmanifest|txt|map|woff2?)$")
    }

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
        uri == "/login.html" -> "dashboard/login.html"
        uri == "/files" -> "dashboard/files.html"
        uri == "/player" -> "dashboard/player.html"
        uri == "/style.css" -> "dashboard/style.css"
        uri == "/app.js" -> "dashboard/app.js"
        uri == "/visuals.js" -> "dashboard/visuals.js"
        uri == "/core" -> "dashboard/core.html"
        uri == "/core.js" -> "dashboard/core.js"
        uri == "/mirror" -> "dashboard/mirror.html"
        uri == "/selfheal" -> "dashboard/selfheal.html"
        uri == "/selfheal.js" -> "dashboard/selfheal.js"
        uri == "/brain" -> "dashboard/brain.html"
        uri == "/brain.js" -> "dashboard/brain.js"
        uri == "/tts" -> "dashboard/tts.html"
        uri == "/animations.css" -> "animations.css"
        uri == "/animations.js" -> "animations.js"
        uri == "/manifest.webmanifest" -> "dashboard/manifest.webmanifest"
        uri == "/sw.js" -> "dashboard/sw.js"
        uri == "/icon-192.png" -> "dashboard/icon-192.png"
        uri == "/icon-512.png" -> "dashboard/icon-512.png"
        uri == "/os" || uri == "/os/" || uri == "/os/index.html" -> "os/index.html"
        uri.startsWith("/os/") -> "os/${uri.removePrefix("/os/")}"
        uri.startsWith("/dashboard/") -> "dashboard/${uri.removePrefix("/dashboard/")}"
        uri.startsWith("/assets/") -> uri.removePrefix("/")
        uri == "/ai" || uri == "/ai/index.html" -> "ai/index.html"
        uri.startsWith("/ai/") -> "ai/${uri.removePrefix("/ai/")}"
        ROOT_DASHBOARD_ASSET.matches(uri) -> "dashboard/${uri.removePrefix("/")}"
        else -> null
    }
}
