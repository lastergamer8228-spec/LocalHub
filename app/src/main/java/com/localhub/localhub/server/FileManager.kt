package com.localhub.localhub.server

import java.io.File

/**
 * Lists folders and files on the phone's public storage for the browser file
 * manager. Hidden folders are omitted; user-created folders remain visible.
 */
class FileManager(private val rootPath: String = "/storage/emulated/0") {

    /** Bounded so a folder with thousands of items cannot stall the browser. */
    fun list(rawPath: String?, maxEntries: Int = DEFAULT_LIST_LIMIT): Map<String, Any> {
        val limit = maxEntries.coerceIn(MIN_LIST_LIMIT, MAX_LIST_LIMIT)
        val current = sanitize(rawPath ?: rootPath)
        val dir = File(current)

        if (!dir.exists() || !dir.isDirectory) {
            return emptyResult(current, limit)
        }

        val entries = dir.listFiles() ?: emptyArray()

        val folders = entries
            .filter { it.isDirectory && !it.name.startsWith(".") }
            .sortedBy { it.name.lowercase() }
            .map {
                mapOf(
                    "name" to it.name,
                    "path" to it.absolutePath,
                    "size" to 0L,
                    "modified" to it.lastModified(),
                    "isDir" to true
                )
            }

        val files = entries
            .filter { it.isFile }
            .sortedBy { it.name.lowercase() }
            .map {
                val ext = it.name.substringAfterLast('.', "").lowercase()
                mapOf(
                    "name" to it.name,
                    "path" to it.absolutePath,
                    "size" to it.length(),
                    "modified" to it.lastModified(),
                    "isDir" to false,
                    "mime" to FileOperations.Mime.mimeFor(it.name),
                    "category" to FileOperations.Mime.categoryFor(ext)
                )
            }

        val total = folders.size + files.size
        // Folders are kept first (navigation stays usable), then files fill the rest.
        val keptFolders = folders.take(limit)
        val keptFiles = files.take((limit - keptFolders.size).coerceAtLeast(0))
        val shown = keptFolders.size + keptFiles.size
        return mapOf(
            "path" to dir.absolutePath,
            "name" to (dir.name.ifBlank { "/" }),
            "parent" to (dir.parentFile?.absolutePath ?: ""),
            "folders" to keptFolders,
            "files" to keptFiles,
            "truncated" to (shown < total),
            "shown" to shown,
            "total" to total,
            "limit" to limit
        )
    }

    companion object {
        const val DEFAULT_LIST_LIMIT = 500
        const val MIN_LIST_LIMIT = 20
        const val MAX_LIST_LIMIT = 2000
    }

    private fun emptyResult(path: String, limit: Int = DEFAULT_LIST_LIMIT): Map<String, Any> = mapOf(
        "path" to path,
        "name" to (File(path).name.ifBlank { "/" }),
        "parent" to (File(path).parentFile?.absolutePath ?: ""),
        "folders" to emptyList<Any>(),
        "files" to emptyList<Any>(),
        "truncated" to false,
        "shown" to 0,
        "total" to 0,
        "limit" to limit
    )

    /** Normalizes a path, rejects traversal, and forces it under the storage root. */
    private fun sanitize(rawPath: String): String {
        var p = rawPath.replace("\\", "/").replace("\u0000", "").trim()
        if (p.isEmpty()) return rootPath
        val segments = java.util.ArrayDeque<String>()
        for (seg in p.split("/")) {
            when (seg) {
                "", "." -> {}
                ".." -> {}
                else -> segments.addLast(seg)
            }
        }
        val canonical = "/" + segments.joinToString("/")
        return if (canonical.startsWith(rootPath)) canonical else rootPath
    }
}
