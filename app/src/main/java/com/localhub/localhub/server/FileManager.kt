package com.localhub.localhub.server

import java.io.File

/**
 * Lists folders and files on the phone's public storage for the browser file
 * manager. Root view shows only the standard public folders; nested paths list
 * their sub-folders and files.
 */
class FileManager(private val rootPath: String = "/storage/emulated/0") {

    private val defaultFolders =
        listOf("Download", "Documents", "DCIM", "Pictures", "Movies", "Music")

    fun list(rawPath: String?): Map<String, Any> {
        val current = sanitize(rawPath ?: rootPath)
        val dir = File(current)

        if (!dir.exists() || !dir.isDirectory) {
            return emptyResult(current)
        }

        val entries = dir.listFiles() ?: emptyArray()
        val isRoot = dir.absolutePath == rootPath

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

        return mapOf(
            "path" to dir.absolutePath,
            "name" to (dir.name.ifBlank { "/" }),
            "parent" to (dir.parentFile?.absolutePath ?: ""),
            "folders" to folders,
            "files" to files
        )
    }

    private fun emptyResult(path: String): Map<String, Any> = mapOf(
        "path" to path,
        "name" to (File(path).name.ifBlank { "/" }),
        "parent" to (File(path).parentFile?.absolutePath ?: ""),
        "folders" to emptyList<Any>(),
        "files" to emptyList<Any>()
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
