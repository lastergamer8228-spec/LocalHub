package com.localhub.localhub.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Bounded directory listing.
 *
 * Real filesystem (JUnit TemporaryFolder), no Android framework: this proves the
 * server cannot be asked to serialise an unbounded folder into one response.
 */
class FileManagerTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun manager(root: File = tmp.root) = FileManager(root.absolutePath)

    @Suppress("UNCHECKED_CAST")
    private fun entries(map: Map<String, Any>, key: String): List<Map<String, Any>> =
        map[key] as List<Map<String, Any>>

    private fun fill(dir: File, folders: Int, files: Int) {
        repeat(folders) { File(dir, "folder-%03d".format(it)).mkdirs() }
        repeat(files) { File(dir, "file-%03d.txt".format(it)).writeText("x") }
    }

    @Test
    fun `a huge folder is capped and reports truncation honestly`() {
        val dir = tmp.newFolder("big")
        fill(dir, folders = 30, files = 300)

        val result = manager().list(dir.absolutePath, maxEntries = 50)

        assertEquals(50, result["shown"])
        assertEquals(330, result["total"])
        assertEquals(50, result["limit"])
        assertEquals(true, result["truncated"])
        assertEquals(50, entries(result, "folders").size + entries(result, "files").size)
    }

    @Test
    fun `folders survive truncation before files so navigation stays usable`() {
        val dir = tmp.newFolder("nav")
        fill(dir, folders = 10, files = 100)

        val result = manager().list(dir.absolutePath, maxEntries = 20)

        assertEquals(10, entries(result, "folders").size)
        assertEquals(10, entries(result, "files").size)
        assertEquals(true, result["truncated"])
    }

    @Test
    fun `a small folder is not marked truncated`() {
        val dir = tmp.newFolder("small")
        fill(dir, folders = 2, files = 3)

        val result = manager().list(dir.absolutePath, maxEntries = 100)

        assertEquals(5, result["shown"])
        assertEquals(5, result["total"])
        assertEquals(false, result["truncated"])
    }

    @Test
    fun `limit is clamped into the supported range`() {
        val dir = tmp.newFolder("clamp")
        fill(dir, folders = 0, files = 60)

        val tooSmall = manager().list(dir.absolutePath, maxEntries = 1)
        assertEquals(FileManager.MIN_LIST_LIMIT, tooSmall["limit"])
        assertEquals(FileManager.MIN_LIST_LIMIT, tooSmall["shown"])

        val tooBig = manager().list(dir.absolutePath, maxEntries = 500_000)
        assertEquals(FileManager.MAX_LIST_LIMIT, tooBig["limit"])
        assertEquals(60, tooBig["shown"])
    }

    @Test
    fun `default limit is the documented 500`() {
        val dir = tmp.newFolder("default")
        fill(dir, folders = 0, files = 600)

        val result = manager().list(dir.absolutePath)

        assertEquals(FileManager.DEFAULT_LIST_LIMIT, result["limit"])
        assertEquals(500, result["shown"])
        assertEquals(600, result["total"])
        assertEquals(true, result["truncated"])
    }

    @Test
    fun `hidden folders are hidden but real folders stay visible`() {
        val dir = tmp.newFolder("hidden")
        File(dir, ".thumbnails").mkdirs()
        File(dir, "Downloads").mkdirs()

        val result = manager().list(dir.absolutePath)

        val names = entries(result, "folders").map { it["name"] }
        assertTrue(names.contains("Downloads"))
        assertFalse(names.any { it.toString().startsWith(".") })
    }

    @Test
    fun `listing is sorted case-insensitively`() {
        val dir = tmp.newFolder("sort")
        File(dir, "zebra.txt").writeText("z")
        File(dir, "Apple.txt").writeText("a")
        File(dir, "mango.txt").writeText("m")

        val result = manager().list(dir.absolutePath)

        assertEquals(listOf("Apple.txt", "mango.txt", "zebra.txt"), entries(result, "files").map { it["name"] })
    }

    @Test
    fun `a missing or non-directory path returns an empty, non-truncated result`() {
        val missing = manager().list(File(tmp.root, "nope").absolutePath)
        assertEquals(0, missing["shown"])
        assertEquals(0, missing["total"])
        assertEquals(false, missing["truncated"])
        assertEquals(FileManager.DEFAULT_LIST_LIMIT, missing["limit"])

        val file = tmp.newFile("plain.txt")
        val notADir = manager().list(file.absolutePath)
        assertEquals(0, notADir["shown"])
        assertEquals(false, notADir["truncated"])
    }

    @Test
    fun `traversal above the root is refused`() {
        val root = tmp.newFolder("root")
        File(root, "inside").mkdirs()
        val secret = tmp.newFolder("outside")

        // "../.." segments are dropped, so the path can never climb above root.
        val climbed = manager(root).list("${root.absolutePath}/../../etc/passwd")
        assertTrue(
            "path escaped the storage root: ${climbed["path"]}",
            climbed["path"].toString().startsWith(root.absolutePath)
        )
        assertEquals(0, climbed["shown"])

        // A path that is not under the storage root at all falls back to root.
        val foreign = manager(root).list(secret.absolutePath)
        assertEquals(root.absolutePath, foreign["path"])
        assertEquals(1, entries(foreign, "folders").size)
    }

    @Test
    fun `every entry carries the fields the web file manager renders`() {
        val dir = tmp.newFolder("shape")
        File(dir, "clip.mp4").writeText("v")
        File(dir, "sub").mkdirs()

        val result = manager().list(dir.absolutePath)
        val file = entries(result, "files").first()

        assertEquals("clip.mp4", file["name"])
        assertEquals("video/mp4", file["mime"])
        assertEquals("video", file["category"])
        assertEquals(false, file["isDir"])
        assertEquals(true, entries(result, "folders").first()["isDir"])
        assertTrue(file["path"].toString().endsWith("clip.mp4"))
    }
}
