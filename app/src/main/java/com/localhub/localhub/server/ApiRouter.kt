package com.localhub.localhub.server

import com.google.gson.Gson
import com.localhub.localhub.core.Constants
import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.data.repository.StatisticsRepository
import com.localhub.localhub.module.ModuleManager
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.system.SystemInfoProvider
import com.localhub.localhub.util.AppLogger
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.Response.Status
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * REST API Router
 */
class ApiRouter(
    private val systemInfoProvider: SystemInfoProvider,
    private val moduleManager: ModuleManager,
    private val statisticsRepository: StatisticsRepository,
    private val logRepository: LogRepository,
    private val clientTracker: ClientTracker,
    private val gson: Gson,
    private val logger: AppLogger,
    private val preferencesManager: PreferencesManager
) {

    fun handle(session: IHTTPSession): Response {
        val uri = session.uri ?: "/"
        val path = uri.removePrefix("/api/").trimEnd('/')
        return try {
            when (session.method) {
                NanoHTTPD.Method.GET -> handleGet(path)
                NanoHTTPD.Method.POST -> handlePost(session, path)
                else -> methodNotAllowed()
            }
        } catch (e: Exception) {
            logger.error(TAG, "API error on $path: ${e.message}")
            error(Status.INTERNAL_ERROR, e.message ?: "internal error")
        }
    }

    private fun handleGet(path: String): Response = when (path) {
        "status" -> json(statusMap())
        "system" -> json(systemInfoProvider.lastSnapshot ?: systemInfoProvider.collectSnapshot())
        "device" -> json( systemInfoProvider.lastSnapshot.value?.device ?: systemInfoProvider.collectSnapshot().device)
        "network" -> json( systemInfoProvider.lastSnapshot.value?.network ?: systemInfoProvider.collectSnapshot().network)
        "storage" -> json(systemInfoProvider.lastSnapshot.value?.storage ?: systemInfoProvider.collectSnapshot().storage)
        "battery" -> json(systemInfoProvider.lastSnapshot.value?.battery ?: systemInfoProvider.collectSnapshot().battery)
        "cpu" -> json(systemInfoProvider.lastSnapshot.value?.cpu?: systemInfoProvider.collectSnapshot().cpu)
        "memory" -> json(systemInfoProvider.lastSnapshot.value?.memory ?: systemInfoProvider.collectSnapshot().memory)
        "modules" -> json(moduleManager.toInfoList())
        "clients" -> json(mapOf("clients" to clientTracker.clients.value))
        "logs" -> {
            val logs = runBlocking { logRepository.recent(50).first() }
            json(mapOf("logs" to logs))
        }
        "statistics" -> {
            val stats = runBlocking { statisticsRepository.recent(60).first() }
            json(mapOf("statistics" to stats))
        }
        else -> notFound()
    }

    private fun handlePost(session: IHTTPSession, path: String): Response {
        val body = readBody(session)
        return when (path) {
            "log" -> {
                logger.info("API", "Remote log: $body")
                json(mapOf("ok" to true))
            }
            "command" -> json(mapOf("ok" to true, "echo" to body))
            else -> notFound()
        }
    }

    private fun statusMap(): Map<String, Any> {
        val ip = systemInfoProvider.lastSnapshot.value?.network?.ipAddress ?: "127.0.0.1"
        val port = runBlocking { preferencesManager.portFlow.first() }
        val name = runBlocking { preferencesManager.serverNameFlow.first() }
        return mapOf(
            "running" to true,
            "version" to Constants.SERVER_VERSION,
            "name" to name,
            "port" to port,
            "host" to ip,
            "url" to "http://$ip:$port",
            "uptimeMs" to 0
        )
    }

    private fun readBody(session: IHTTPSession): String = runCatching {
        val len = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (len <= 0) return ""
        val raw = session.inputStream.readBytes()
        String(raw, Charsets.UTF_8)
    }.getOrDefault("")

    private fun json(obj: Any): Response =
        NanoHTTPD.newFixedLengthResponse(Status.OK, "application/json", gson.toJson(obj))
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun notFound(): Response =
        NanoHTTPD.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "404 Not Found")
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun methodNotAllowed(): Response =
        NanoHTTPD.newFixedLengthResponse(Status.METHOD_NOT_ALLOWED, NanoHTTPD.MIME_PLAINTEXT, "Method not allowed")
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    private fun error(status: Status, message: String): Response =
        NanoHTTPD.newFixedLengthResponse(status, NanoHTTPD.MIME_PLAINTEXT, message)
            .apply { addHeader("Access-Control-Allow-Origin", "*") }

    companion object {
        private const val TAG = "ApiRouter"
    }
}
