package com.localhub.localhub.server

import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * In-memory thread-safe state store for LocalHub Social & Sharing features:
 * - Shared Clipboard & Clip History
 * - Real-time LAN Chat Room
 * - Notice Board / Sticky Wall
 * - Shared Scratchpad / Quick Notes
 */
class HubStore {
    data class ClipItem(
        val id: String = UUID.randomUUID().toString(),
        val text: String,
        val author: String = "User",
        val timestamp: Long = System.currentTimeMillis()
    )

    data class ChatMessage(
        val id: String = UUID.randomUUID().toString(),
        val text: String,
        val author: String = "Guest",
        val color: String = "#38bdf8",
        val timestamp: Long = System.currentTimeMillis(),
        val ip: String = ""
    )

    data class WallNote(
        val id: String = UUID.randomUUID().toString(),
        val title: String = "",
        val content: String,
        val author: String = "User",
        val color: String = "yellow",
        val pinned: Boolean = false,
        val timestamp: Long = System.currentTimeMillis()
    )

    // Shared Clipboard
    @Volatile private var currentClip: ClipItem = ClipItem(text = "Welcome to LocalHub Shared Clipboard! Copy text here from any device on your Wi-Fi.")
    private val clipHistory = CopyOnWriteArrayList<ClipItem>()

    // LAN Chat Room (last 150 messages)
    private val chatMessages = CopyOnWriteArrayList<ChatMessage>()
    private val maxChatMessages = 150

    // Sticky Wall Notes
    private val wallNotes = CopyOnWriteArrayList<WallNote>()

    // Scratchpad Notes
    @Volatile private var scratchpadContent: String = ""
    @Volatile private var scratchpadUpdated: Long = System.currentTimeMillis()

    init {
        wallNotes.add(
            WallNote(
                title = "Welcome to LocalHub!",
                content = "Stream media, drop files wirelessly, chat with friends on this Wi-Fi, or copy text across devices without internet.",
                author = "LocalHub Host",
                color = "blue",
                pinned = true
            )
        )
        clipHistory.add(currentClip)
    }

    // Clipboard API
    fun getClipboard(): Map<String, Any> = mapOf(
        "ok" to true,
        "text" to currentClip.text,
        "author" to currentClip.author,
        "updatedAt" to currentClip.timestamp,
        "history" to clipHistory.takeLast(10).reversed().map {
            mapOf("id" to it.id, "text" to it.text, "author" to it.author, "time" to it.timestamp)
        }
    )

    fun setClipboard(text: String, author: String = "User"): Map<String, Any> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return mapOf("ok" to false, "error" to "empty text")
        val clip = ClipItem(text = trimmed, author = author.ifBlank { "User" })
        currentClip = clip
        clipHistory.add(clip)
        while (clipHistory.size > 30) clipHistory.removeAt(0)
        return mapOf("ok" to true, "text" to clip.text, "author" to clip.author, "updatedAt" to clip.timestamp)
    }

    // Chat API
    fun getChat(since: Long = 0L): Map<String, Any> {
        val list = if (since > 0L) {
            chatMessages.filter { it.timestamp > since }
        } else {
            chatMessages.takeLast(60)
        }
        return mapOf(
            "ok" to true,
            "messages" to list.map {
                mapOf(
                    "id" to it.id,
                    "text" to it.text,
                    "author" to it.author,
                    "color" to it.color,
                    "time" to it.timestamp
                )
            }
        )
    }

    fun postChatMessage(text: String, author: String, color: String, ip: String): Map<String, Any> {
        val clean = text.trim()
        if (clean.isEmpty()) return mapOf("ok" to false, "error" to "empty message")
        val msg = ChatMessage(
            text = clean.take(1000),
            author = author.trim().ifBlank { "Guest" }.take(30),
            color = if (color.startsWith("#")) color else "#38bdf8",
            ip = ip
        )
        chatMessages.add(msg)
        while (chatMessages.size > maxChatMessages) chatMessages.removeAt(0)
        return mapOf("ok" to true, "message" to mapOf(
            "id" to msg.id,
            "text" to msg.text,
            "author" to msg.author,
            "color" to msg.color,
            "time" to msg.timestamp
        ))
    }

    fun clearChat(): Map<String, Any> {
        chatMessages.clear()
        return mapOf("ok" to true, "message" to "chat cleared")
    }

    // Wall Notes API
    fun getWall(): Map<String, Any> = mapOf(
        "ok" to true,
        "notes" to wallNotes.sortedByDescending { if (it.pinned) 1L shl 60 else it.timestamp }.map {
            mapOf(
                "id" to it.id,
                "title" to it.title,
                "content" to it.content,
                "author" to it.author,
                "color" to it.color,
                "pinned" to it.pinned,
                "time" to it.timestamp
            )
        }
    )

    fun postWallNote(title: String, content: String, author: String, color: String, pinned: Boolean): Map<String, Any> {
        val cleanContent = content.trim()
        if (cleanContent.isEmpty()) return mapOf("ok" to false, "error" to "empty content")
        val note = WallNote(
            title = title.trim().take(60),
            content = cleanContent.take(2000),
            author = author.trim().ifBlank { "User" }.take(30),
            color = when (color.lowercase()) {
                "blue", "green", "pink", "purple", "orange" -> color.lowercase()
                else -> "yellow"
            },
            pinned = pinned
        )
        wallNotes.add(note)
        while (wallNotes.size > 50) wallNotes.removeAt(0)
        return mapOf("ok" to true, "note" to mapOf(
            "id" to note.id,
            "title" to note.title,
            "content" to note.content,
            "author" to note.author,
            "color" to note.color,
            "pinned" to note.pinned,
            "time" to note.timestamp
        ))
    }

    fun deleteWallNote(id: String): Map<String, Any> {
        val removed = wallNotes.removeIf { it.id == id }
        return mapOf("ok" to removed)
    }

    // Scratchpad
    fun getScratchpad(): Map<String, Any> = mapOf(
        "ok" to true,
        "content" to scratchpadContent,
        "updatedAt" to scratchpadUpdated
    )

    fun setScratchpad(content: String): Map<String, Any> {
        scratchpadContent = content.take(100_000)
        scratchpadUpdated = System.currentTimeMillis()
        return mapOf("ok" to true, "updatedAt" to scratchpadUpdated)
    }
}
