package com.localhub.localhub.server

import java.io.File

/**
 * File operations used by the AI assistant and the file manager.
 * Existing listing stays in [FileManager]; this adds the mutation/read/search
 * operations the AI needs. Every destructive action requires [confirm] == true.
 */
class FileOperations(private val rootPath: String = "/storage/emulated/0") {

    /** Resolves a folder for uploads under the storage root (rejects traversal). */
    fun directory(raw: String?): File = File(sanitize(raw ?: rootPath))

    fun exists(path: String): Boolean = File(sanitize(path)).exists()

    fun isDirectory(path: String): Boolean = File(sanitize(path)).isDirectory

    fun list(path: String?, maxEntries: Int = FileManager.DEFAULT_LIST_LIMIT): Map<String, Any> =
        FileManager(rootPath).list(path, maxEntries)

    fun search(query: String, dir: String?, maxDepth: Int = 3, limit: Int = 200): Map<String, Any> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return mapOf("query" to query, "matches" to emptyList<Any>())
        val start = File(sanitize(dir ?: rootPath))
        if (!start.isDirectory) return mapOf("query" to query, "matches" to emptyList<Any>())

        val matches = mutableListOf<Map<String, Any>>()
        fun walk(f: File, depth: Int) {
            if (matches.size >= limit || depth > maxDepth) return
            val list = f.listFiles() ?: return
            for (child in list) {
                if (matches.size >= limit) return
                if (child.name.lowercase().contains(q)) {
                    matches.add(
                        mapOf(
                            "name" to child.name,
                            "path" to child.absolutePath,
                            "isDir" to child.isDirectory,
                            "size" to if (child.isFile) child.length() else 0L
                        )
                    )
                }
                if (child.isDirectory) walk(child, depth + 1)
            }
        }
        walk(start, 0)
        return mapOf("query" to query, "matches" to matches)
    }

    fun read(path: String, maxBytes: Int = 512_000): Map<String, Any> {
        val f = File(sanitize(path))
        if (!f.exists() || !f.isFile) return mapOf("ok" to false, "error" to "not found")
        val content = runCatching {
            val bytes = f.readBytes()
            if (bytes.size > maxBytes) bytes.copyOfRange(0, maxBytes) else bytes
        }.getOrNull() ?: return mapOf("ok" to false, "error" to "read failed")
        return mapOf(
            "ok" to true,
            "path" to f.absolutePath,
            "size" to f.length(),
            "content" to String(content, Charsets.UTF_8)
        )
    }

    fun write(path: String, content: String): Map<String, Any> = runCatching {
        val f = File(sanitize(path))
        f.parentFile?.mkdirs()
        f.writeText(content, Charsets.UTF_8)
        mapOf("ok" to true, "path" to f.absolutePath)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "write failed")) }

    fun mkdir(parent: String, name: String): Map<String, Any> = runCatching {
        val p = File(sanitize(parent))
        if (!p.isDirectory) return mapOf("ok" to false, "error" to "parent not found")
        val dir = File(p, name)
        if (dir.exists()) return mapOf("ok" to false, "error" to "already exists")
        if (!dir.mkdirs()) return mapOf("ok" to false, "error" to "create failed")
        mapOf("ok" to true, "path" to dir.absolutePath)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "mkdir failed")) }

    fun rename(path: String, newName: String): Map<String, Any> = runCatching {
        val f = File(sanitize(path))
        if (!f.exists()) return mapOf("ok" to false, "error" to "not found")
        if (newName.isBlank() || newName.contains('/')) return mapOf("ok" to false, "error" to "invalid name")
        val dest = File(f.parentFile, newName)
        if (dest.exists()) return mapOf("ok" to false, "error" to "already exists")
        if (!f.renameTo(dest)) return mapOf("ok" to false, "error" to "rename failed")
        mapOf("ok" to true, "path" to dest.absolutePath)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "rename failed")) }

    fun move(path: String, destDir: String): Map<String, Any> = runCatching {
        val f = File(sanitize(path))
        if (!f.exists()) return mapOf("ok" to false, "error" to "not found")
        val d = File(sanitize(destDir))
        if (!d.isDirectory) return mapOf("ok" to false, "error" to "dest not found")
        val dest = File(d, f.name)
        if (dest.exists()) return mapOf("ok" to false, "error" to "already exists")
        if (!f.renameTo(dest)) return mapOf("ok" to false, "error" to "move failed")
        mapOf("ok" to true, "path" to dest.absolutePath)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "move failed")) }

    fun copy(path: String, destDir: String): Map<String, Any> = runCatching {
        val f = File(sanitize(path))
        if (!f.exists()) return mapOf("ok" to false, "error" to "not found")
        val d = File(sanitize(destDir))
        if (!d.isDirectory) return mapOf("ok" to false, "error" to "dest not found")
        val dest = File(d, f.name)
        if (dest.exists()) return mapOf("ok" to false, "error" to "already exists")
        copyRecursive(f, dest)
        mapOf("ok" to true, "path" to dest.absolutePath)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "copy failed")) }

    private fun copyRecursive(src: File, dst: File) {
        if (src.isDirectory) {
            dst.mkdirs()
            src.listFiles()?.forEach { copyRecursive(it, File(dst, it.name)) }
        } else {
            src.copyTo(dst, overwrite = true)
        }
    }

    /** Destructive. [confirm] must be true, otherwise no-op. */
    fun delete(path: String, confirm: Boolean): Map<String, Any> {
        if (!confirm) return mapOf("ok" to false, "error" to "confirmation required")
        val f = File(sanitize(path))
        if (!f.exists()) return mapOf("ok" to false, "error" to "not found")
        val ok = f.deleteRecursively()
        return if (ok) mapOf("ok" to true, "path" to f.absolutePath)
        else mapOf("ok" to false, "error" to "delete failed")
    }

    // ---- Metadata / info ---------------------------------------------------

    /** Returns rich metadata for a path (name, size, modified, mime, category). */
    fun info(path: String): Map<String, Any> {
        val f = File(sanitize(path))
        if (!f.exists()) return mapOf("ok" to false, "error" to "not found")
        val ext = extensionOf(f.name)
        val mime = Mime.mimeFor(f.name)
        return mapOf(
            "ok" to true,
            "name" to f.name,
            "path" to f.absolutePath,
            "isDir" to f.isDirectory,
            "size" to if (f.isFile) f.length() else 0L,
            "modified" to f.lastModified(),
            "extension" to ext,
            "mime" to mime,
            "category" to Mime.categoryFor(ext)
        )
    }

    /** Opens the file for content serving. Null if missing / not a file. */
    fun open(path: String): File? {
        val f = File(sanitize(path))
        return if (f.exists() && f.isFile) f else null
    }

    // ---- Zip / unzip -------------------------------------------------------

    /** Creates a zip archive at [destZip] from the given [paths]. */
    fun zip(paths: List<String>, destZip: String): Map<String, Any> = runCatching {
        val dest = File(sanitize(destZip))
        dest.parentFile?.mkdirs()
        java.util.zip.ZipOutputStream(dest.outputStream().buffered()).use { zos ->
            val seen = HashSet<String>()
            for (raw in paths) {
                val src = File(sanitize(raw))
                if (!src.exists()) continue
                addToZip(src, "", zos, seen)
            }
        }
        mapOf("ok" to true, "path" to dest.absolutePath, "count" to paths.size)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "zip failed")) }

    private fun addToZip(src: File, prefix: String, zos: java.util.zip.ZipOutputStream, seen: HashSet<String>) {
        val name = prefix + src.name
        if (!seen.add(name)) return
        if (src.isDirectory) {
            zos.putNextEntry(java.util.zip.ZipEntry(name + "/"))
            zos.closeEntry()
            src.listFiles()?.forEach { addToZip(it, name + "/", zos, seen) }
        } else {
            zos.putNextEntry(java.util.zip.ZipEntry(name))
            src.inputStream().use { it.copyTo(zos) }
            zos.closeEntry()
        }
    }

    /** Extracts [zipPath] into [destDir]. */
    fun unzip(zipPath: String, destDir: String): Map<String, Any> = runCatching {
        val zipFile = File(sanitize(zipPath))
        if (!zipFile.exists()) return mapOf("ok" to false, "error" to "not found")
        val dest = File(sanitize(destDir))
        dest.mkdirs()
        var count = 0
        java.util.zip.ZipFile(zipFile).use { zf ->
            val entries = zf.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                val outFile = File(dest, entry.name)
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    zf.getInputStream(entry).use { it.copyTo(outFile.outputStream()) }
                    count++
                }
            }
        }
        mapOf("ok" to true, "path" to dest.absolutePath, "count" to count)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "unzip failed")) }

    // ---- Upload ------------------------------------------------------------

    /**
     * Writes raw [bytes] as a file named [name] inside [dir].
     * Security: creates [dir] if missing, sanitizes the filename, blocks path
     * traversal, and refuses to overwrite unless [overwrite] is true.
     */
    fun upload(dir: String, name: String, bytes: ByteArray, overwrite: Boolean = true): Map<String, Any> = runCatching {
        val d = File(sanitize(dir))
        d.mkdirs()
        if (!d.isDirectory) return mapOf("ok" to false, "error" to "dir not found")
        val safeName = sanitizeFilename(name)
        if (safeName.isEmpty()) return mapOf("ok" to false, "error" to "invalid name")
        val f = File(d, safeName)
        if (f.exists() && !overwrite) return mapOf("ok" to false, "error" to "already exists")
        if (bytes.size > MAX_UPLOAD_BYTES) return mapOf("ok" to false, "error" to "file too large")
        f.writeBytes(bytes)
        mapOf("ok" to true, "path" to f.absolutePath, "name" to safeName, "size" to bytes.size)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "upload failed")) }

    /**
     * Parses a multipart/form-data body and writes every uploaded file into
     * [destDir]. Multiple files are supported in a single request.
     */
    fun uploadMultipart(data: ByteArray, boundary: String, destDir: String, overwrite: Boolean = true): Map<String, Any> {
        val d = File(sanitize(destDir))
        d.mkdirs()
        if (!d.isDirectory) return mapOf("ok" to false, "error" to "dir not found")
        if (boundary.isBlank()) return mapOf("ok" to false, "error" to "invalid boundary")

        val boundaryBytes = ("--" + boundary).toByteArray(Charsets.US_ASCII)
        val results = mutableListOf<Map<String, Any>>()
        var saved = 0
        var pos = indexOf(data, boundaryBytes, 0)

        while (pos >= 0) {
            val next = indexOf(data, boundaryBytes, pos + boundaryBytes.size)
            if (next < 0) break
            val start = pos + boundaryBytes.size
            var pe = next
            if (pe > start + 1 && data[pe - 1] == '\n'.code.toByte()) pe--
            if (pe > start + 1 && data[pe - 1] == '\r'.code.toByte()) pe--
            val part = data.copyOfRange(start, pe)

            val hdrSep = indexOf(part, "\r\n\r\n".toByteArray(), 0)
            if (hdrSep > 0) {
                val headers = String(part, 0, hdrSep, Charsets.US_ASCII)
                val content = part.copyOfRange(hdrSep + 4, part.size)
                val filename = extractMultipartFilename(headers)
                if (filename != null) {
                    val safeName = sanitizeFilename(filename)
                    if (safeName.isNotEmpty()) {
                        val f = File(d, safeName)
                        if (f.exists() && !overwrite) {
                            results.add(mapOf("name" to safeName, "ok" to false, "error" to "already exists"))
                        } else if (content.size > MAX_UPLOAD_BYTES) {
                            results.add(mapOf("name" to safeName, "ok" to false, "error" to "file too large"))
                        } else {
                            f.writeBytes(content)
                            saved++
                            results.add(mapOf("name" to safeName, "ok" to true, "path" to f.absolutePath, "size" to content.size))
                        }
                    }
                }
            }
            pos = next
        }
        return mapOf("ok" to (saved > 0), "saved" to saved, "results" to results)
    }

    /** Writes the given paths (files and/or folders) to a temp zip and returns it. */
    fun createZipTemp(paths: List<String>): File? = runCatching {
        val tmp = File(rootPath, "lh_dl_${System.currentTimeMillis()}_${(Math.random() * 1000).toInt()}.zip")
        val res = zip(paths, tmp.absolutePath)
        if (res["ok"] == true) tmp else null
    }.getOrNull()

    /** Deletes LocalHub-generated temp files (zip caches). Returns bytes freed. */
    fun clearCache(): Map<String, Any> = runCatching {
        val root = File(rootPath)
        var freed = 0L; var count = 0
        root.listFiles()?.forEach { f ->
            if (f.isFile && f.name.startsWith("lh_dl_") && f.name.endsWith(".zip")) {
                freed += f.length(); f.delete(); count++
            }
        }
        mapOf("ok" to true, "deleted" to count, "freedBytes" to freed)
    }.getOrElse { mapOf("ok" to false, "error" to (it.message ?: "clear cache failed")) }

    /** Blocks path traversal and strips unsafe characters from a filename. */
    private fun sanitizeFilename(name: String): String {
        var n = name.replace("\\", "/")
        if (n.contains('/')) n = n.substringAfterLast('/')
        n = n.replace("..", "").replace("\u0000", "").trim()
        return n
    }

    /** Extracts the original filename from a multipart Content-Disposition header. */
    private fun extractMultipartFilename(headers: String): String? {
        val cd = headers.split("\r\n").firstOrNull { it.startsWith("Content-Disposition") } ?: return null
        val m = Regex("filename=\"([^\"]*)\"").find(cd) ?: return null
        val name = m.groupValues[1]
        return if (name.isBlank()) null else name
    }

    /** Byte-array indexOf (needle -> first index, or -1). */
    private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int): Int {
        if (needle.isEmpty()) return -1
        outer@ for (i in from..haystack.size - needle.size) {
            for (j in needle.indices) {
                if (haystack[i + j] != needle[j]) continue@outer
            }
            return i
        }
        return -1
    }

    companion object {
        /** Optional upload size cap (bytes). 512 MB. */
        const val MAX_UPLOAD_BYTES = 512L * 1024 * 1024
    }

    // ---- Analysis helpers --------------------------------------------------

    /** Top [limit] largest files under [dir] (one level deep + recursion). */
    fun largestFiles(dir: String, limit: Int = 20): Map<String, Any> {
        val start = File(sanitize(dir))
        if (!start.isDirectory) return mapOf("ok" to false, "error" to "not found")
        val found = mutableListOf<Pair<File, Long>>()
        fun walk(f: File, depth: Int) {
            if (depth > 4) return
            val list = f.listFiles() ?: return
            for (child in list) {
                if (child.isFile) found.add(child to child.length())
                else if (child.isDirectory) walk(child, depth + 1)
            }
        }
        walk(start, 0)
        val top = found.sortedByDescending { it.second }.take(limit)
        return mapOf(
            "ok" to true,
            "items" to top.map { mapOf("name" to it.first.name, "path" to it.first.absolutePath, "size" to it.second) }
        )
    }

    /** Empty directories under [dir] (recursive). */
    fun emptyFolders(dir: String): Map<String, Any> {
        val start = File(sanitize(dir))
        if (!start.isDirectory) return mapOf("ok" to false, "error" to "not found")
        val empty = mutableListOf<String>()
        fun walk(f: File, depth: Int) {
            if (depth > 6) return
            val children = f.listFiles() ?: return
            if (children.isEmpty()) empty.add(f.absolutePath)
            else children.filter { it.isDirectory }.forEach { walk(it, depth + 1) }
        }
        walk(start, 0)
        return mapOf("ok" to true, "items" to empty)
    }

    /**
     * Finds duplicate files under [dir] by (size, then name) — a fast, deterministic
     * heuristic that groups likely-duplicate files without reading every byte.
     * Full byte-level hashing is intentionally omitted to keep scans fast on large trees.
     */
    fun duplicates(dir: String): Map<String, Any> {
        val start = File(sanitize(dir))
        if (!start.isDirectory) return mapOf("ok" to false, "error" to "not found")
        val bySize = mutableMapOf<Long, MutableList<File>>()
        fun walk(f: File, depth: Int) {
            if (depth > 5) return
            val list = f.listFiles() ?: return
            for (child in list) {
                if (child.isFile && child.length() > 0) {
                    bySize.getOrPut(child.length()) { mutableListOf() }.add(child)
                } else if (child.isDirectory) walk(child, depth + 1)
            }
        }
        walk(start, 0)
        val groups = mutableListOf<MutableList<Map<String, Any>>>()
        bySize.values.forEach { list ->
            if (list.size > 1) {
                // group by filename too
                val byName = list.groupBy { it.name }
                byName.values.forEach { same ->
                    if (same.size > 1) {
                        groups.add(same.map { mapOf("name" to it.name, "path" to it.absolutePath, "size" to it.length()) }.toMutableList())
                    }
                }
            }
        }
        // limit to top 20 groups to keep the response bounded
        return mapOf("ok" to true, "groups" to groups.take(20))
    }

    /**
     * Category scan: total + file count per extension category (video/audio/image/
     * document/archive/other) under [dir]. Used by the storage cleanup dashboard.
     */
    fun categories(dir: String): Map<String, Any> {
        val start = File(sanitize(dir))
        if (!start.isDirectory) return mapOf("ok" to false, "error" to "not found")
        val totals = mutableMapOf<String, Long>()
        val counts = mutableMapOf<String, Int>()
        fun walk(f: File, depth: Int) {
            if (depth > 5) return
            val list = f.listFiles() ?: return
            for (child in list) {
                if (child.isFile) {
                    val cat = Mime.categoryFor(extensionOf(child.name))
                    totals[cat] = (totals[cat] ?: 0L) + child.length()
                    counts[cat] = (counts[cat] ?: 0) + 1
                } else if (child.isDirectory) walk(child, depth + 1)
            }
        }
        walk(start, 0)
        return mapOf("ok" to true, "categories" to totals, "counts" to counts)
    }

    /**
     * Fast media catalog scan across standard public storage folders.
     * Groups files into videos, audio, photos, and documents for the Media Lounge.
     */
    fun mediaCatalog(limitPerCategory: Int = 40): Map<String, Any> {
        val root = File(rootPath)
        val videos = mutableListOf<Map<String, Any>>()
        val audio = mutableListOf<Map<String, Any>>()
        val photos = mutableListOf<Map<String, Any>>()
        val docs = mutableListOf<Map<String, Any>>()

        if (!root.exists()) return mapOf("ok" to true, "videos" to emptyList<Any>(), "audio" to emptyList<Any>(), "photos" to emptyList<Any>(), "documents" to emptyList<Any>())

        val candidates = listOf("Movies", "Download", "DCIM", "Pictures", "Music", "Documents", "Podcasts")
            .map { File(root, it) }
            .filter { it.isDirectory }
        val scanRoots = if (candidates.isNotEmpty()) candidates else listOf(root)

        for (dir in scanRoots) {
            fun walk(f: File, depth: Int) {
                if (depth > 3) return
                val list = f.listFiles() ?: return
                for (child in list) {
                    val name = child.name
                    if (name.startsWith(".")) continue
                    if (child.isDirectory) {
                        walk(child, depth + 1)
                    } else if (child.isFile) {
                        val ext = extensionOf(name)
                        val cat = Mime.categoryFor(ext)
                        val item = mapOf(
                            "name" to name,
                            "path" to child.absolutePath,
                            "size" to child.length(),
                            "modified" to child.lastModified(),
                            "ext" to ext,
                            "category" to cat
                        )
                        when (cat) {
                            "video" -> if (videos.size < limitPerCategory) videos.add(item)
                            "audio" -> if (audio.size < limitPerCategory) audio.add(item)
                            "image" -> if (photos.size < limitPerCategory) photos.add(item)
                            "document" -> if (docs.size < limitPerCategory) docs.add(item)
                        }
                    }
                }
            }
            walk(dir, 0)
        }
        return mapOf(
            "ok" to true,
            "videos" to videos.sortedByDescending { (it["modified"] as? Long) ?: 0L },
            "audio" to audio.sortedByDescending { (it["modified"] as? Long) ?: 0L },
            "photos" to photos.sortedByDescending { (it["modified"] as? Long) ?: 0L },
            "documents" to docs.sortedByDescending { (it["modified"] as? Long) ?: 0L }
        )
    }

    private fun extensionOf(name: String): String {
        val i = name.lastIndexOf('.')
        return if (i < 0) "" else name.substring(i + 1).lowercase()
    }

    private fun sanitize(rawPath: String): String {
        // Normalize separators, strip null bytes, and reject explicit traversal.
        var p = rawPath.replace("\\", "/").replace("\u0000", "").trim()
        if (p.isEmpty()) return rootPath
        // Resolve "." / ".." segments; collapse duplicate slashes.
        val segments = java.util.ArrayDeque<String>()
        for (seg in p.split("/")) {
            when (seg) {
                "", "." -> {}
                ".." -> { /* reject traversal out of the root */ }
                else -> segments.addLast(seg)
            }
        }
        val canonical = "/" + segments.joinToString("/")
        // Force the result to live under the storage root.
        return if (canonical.startsWith(rootPath)) canonical else rootPath
    }

    /** Content-type / category helper shared with the router and file manager. */
    object Mime {
        private val EXT_MIME = mapOf(
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png",
            "webp" to "image/webp", "gif" to "image/gif", "bmp" to "image/bmp",
            "svg" to "image/svg+xml",
            "mp4" to "video/mp4", "mkv" to "video/x-matroska", "avi" to "video/x-msvideo",
            "webm" to "video/webm", "mov" to "video/quicktime",
            "mp3" to "audio/mpeg", "wav" to "audio/wav", "ogg" to "audio/ogg",
            "oga" to "audio/ogg", "m4a" to "audio/mp4", "flac" to "audio/flac",
            "aac" to "audio/aac",
            "pdf" to "application/pdf",
            "txt" to "text/plain", "md" to "text/markdown", "log" to "text/plain",
            "json" to "application/json", "xml" to "application/xml",
            "html" to "text/html", "htm" to "text/html", "css" to "text/css",
            "js" to "application/javascript", "kt" to "text/x-kotlin", "kts" to "text/x-kotlin",
            "java" to "text/x-java", "py" to "text/x-python", "sh" to "text/x-shellscript",
            "csv" to "text/csv",
            "zip" to "application/zip", "tar" to "application/x-tar", "gz" to "application/gzip",
            "apk" to "application/vnd.android.package-archive"
        )

        private val EXT_CATEGORY = mapOf(
            "jpg" to "image", "jpeg" to "image", "png" to "image", "webp" to "image",
            "gif" to "image", "bmp" to "image", "svg" to "image",
            "mp4" to "video", "mkv" to "video", "avi" to "video", "webm" to "video", "mov" to "video",
            "mp3" to "audio", "wav" to "audio", "ogg" to "audio", "oga" to "audio",
            "m4a" to "audio", "flac" to "audio", "aac" to "audio",
            "pdf" to "pdf",
            "txt" to "text", "md" to "text", "log" to "text", "json" to "text",
            "xml" to "text", "html" to "text", "css" to "text", "js" to "text",
            "kt" to "text", "kts" to "text", "java" to "text", "py" to "text",
            "sh" to "text", "csv" to "text",
            "zip" to "archive", "apk" to "archive"
        )

        fun mimeFor(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase()
            return EXT_MIME[ext] ?: "application/octet-stream"
        }

        fun categoryFor(ext: String): String = EXT_CATEGORY[ext.lowercase()] ?: "binary"

        /** True if the file can be safely shown as UTF-8 text. */
        fun isText(name: String): Boolean {
            val c = categoryFor(name.substringAfterLast('.', ""))
            return c == "text"
        }
    }
}
