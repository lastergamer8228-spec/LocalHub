package com.localhub.localhub.system

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * RemoteAccessService — full bina-root control of any app via AccessibilityService.
 *
 * Supports (all public API, no root):
 *   - click by text / content-desc / resource-id
 *   - long press by text
 *   - set text (typing) into an input field
 *   - scroll up / down / to-top / to-bottom
 *   - swipe / drag gestures (left, right, up, down, custom)
 *   - focus an element (then click)
 *   - dump the visible window text tree
 *   - global actions: back / home / recents
 *
 * Commands are posted via [request] and executed on the active window. GUI-element
 * level (no raw pixel touch injection — that needs root/adb).
 */
class RemoteAccessService : AccessibilityService() {

    companion object {
        @Volatile var instance: RemoteAccessService? = null
            private set

        val queue = ConcurrentLinkedQueue<Command>()
        data class Command(val kind: String, val text: String, val extra: String)

        fun request(kind: String, text: String = "", extra: String = "") {
            val service = instance ?: return
            queue.add(Command(kind, text, extra))
            android.os.Handler(android.os.Looper.getMainLooper()).post { service.drainQueue() }
        }

        val isEnabled: Boolean get() = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        drainQueue()
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        queue.clear()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        queue.clear()
        super.onDestroy()
    }

    private fun drainQueue() {
        var cmd = queue.poll()
        while (cmd != null) {
            perform(cmd)
            cmd = queue.poll()
        }
    }

    private fun perform(cmd: Command) {
        val root = rootInActiveWindow ?: return
        when (cmd.kind) {
            "click" -> clickByText(root, cmd.text)
            "clickdesc" -> clickByDesc(root, cmd.text)
            "clickid" -> clickByResourceId(root, cmd.text)
            "longpress" -> longPressByText(root, cmd.text)
            "focus" -> focusByText(root, cmd.text)
            "type" -> setText(root, cmd.text)
            "scroll" -> scroll(root, cmd.text)            // down | up | top | bottom
            "swipe" -> swipe(cmd.text)                     // left|right|up|down
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recent" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "dump" -> { /* handled via dumpScreen() */ }
        }
    }

    // ---- helpers ----

    private fun clickByText(root: AccessibilityNodeInfo, text: String) {
        findNode(root) { n -> n.isClickable && n.text?.toString()?.equals(text, ignoreCase = true) == true }
            ?.let { it.performAction(AccessibilityAction.ACTION_CLICK.id) }
    }

    private fun clickByDesc(root: AccessibilityNodeInfo, desc: String) {
        findNode(root) { n -> n.isClickable && n.contentDescription?.toString()?.contains(desc, ignoreCase = true) == true }
            ?.let { it.performAction(AccessibilityAction.ACTION_CLICK.id) }
    }

    private fun clickByResourceId(root: AccessibilityNodeInfo, id: String) {
        findNode(root) { n -> n.isClickable && n.viewIdResourceName?.contains(id) == true }
            ?.let { it.performAction(AccessibilityAction.ACTION_CLICK.id) }
    }

    private fun longPressByText(root: AccessibilityNodeInfo, text: String) {
        findNode(root) { n -> n.text?.toString()?.contains(text, ignoreCase = true) == true }
            ?.let { it.performAction(AccessibilityAction.ACTION_LONG_CLICK.id) }
    }

    private fun focusByText(root: AccessibilityNodeInfo, text: String) {
        findNode(root) { n -> n.isFocusable && n.text?.toString()?.contains(text, ignoreCase = true) == true }
            ?.let { it.performAction(AccessibilityAction.ACTION_FOCUS.id) }
    }

    /** Types [text] into an editable node (the focused input, or first editable). */
    private fun setText(root: AccessibilityNodeInfo, text: String) {
        val editable = findNode(root) { n -> n.isEditable }
            ?: return
        val args = android.os.Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        editable.performAction(AccessibilityAction.ACTION_SET_TEXT.id, args)
    }

    /** Scrolls the first scrollable container: down|up|top|bottom. */
    private fun scroll(root: AccessibilityNodeInfo, dir: String) {
        val scrollable = findNode(root) { it.isScrollable } ?: return
        val action = when (dir) {
            "up" -> AccessibilityAction.ACTION_SCROLL_BACKWARD.id
            "top" -> AccessibilityAction.ACTION_SCROLL_BACKWARD.id
            "bottom" -> AccessibilityAction.ACTION_SCROLL_FORWARD.id
            else -> AccessibilityAction.ACTION_SCROLL_FORWARD.id // "down"
        }
        scrollable.performAction(action)
    }

    /** Performs a swipe / drag gesture across the screen bounds. */
    private fun swipe(dir: String) {
        val wm = getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager
        @Suppress("DEPRECATION")
        val metrics = android.util.DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
        val w = metrics.widthPixels
        val h = metrics.heightPixels
        val (startX, startY, endX, endY) = when (dir) {
            "left" -> arrayOf(w * 0.85, h * 0.5, w * 0.15, h * 0.5)
            "right" -> arrayOf(w * 0.15, h * 0.5, w * 0.85, h * 0.5)
            "up" -> arrayOf(w * 0.5, h * 0.8, w * 0.5, h * 0.2)
            "down" -> arrayOf(w * 0.5, h * 0.2, w * 0.5, h * 0.8)
            else -> arrayOf(w * 0.5, h * 0.8, w * 0.5, h * 0.2) // up
        }
        val path = Path().apply {
            moveTo(startX.toFloat(), startY.toFloat())
            lineTo(endX.toFloat(), endY.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
            .build()
        dispatchGesture(gesture, null, null)
    }

    // ---- dump visible text tree ----
    fun dumpScreen(): String {
        val root = rootInActiveWindow ?: return "no active window"
        val sb = StringBuilder()
        collectText(root, sb, 0, 60)
        return sb.toString()
    }

    private fun collectText(node: AccessibilityNodeInfo, sb: StringBuilder, depth: Int, limit: Int) {
        if (sb.length > limit * 20 || depth > 20) return
        val t = node.text?.toString()
        val cd = node.contentDescription?.toString()
        if (!t.isNullOrBlank()) sb.append("T:").append(t).append("\n")
        if (!cd.isNullOrBlank()) sb.append("D:").append(cd).append("\n")
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectText(child, sb, depth + 1, limit)
        }
    }

    private fun findNode(root: AccessibilityNodeInfo, pred: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (pred(root)) return root
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            val hit = findNode(child, pred)
            if (hit != null) return hit
        }
        return null
    }
}
