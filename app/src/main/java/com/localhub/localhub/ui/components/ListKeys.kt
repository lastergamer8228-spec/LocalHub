package com.localhub.localhub.ui.components

import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.ModuleInfo

/**
 * Stable, collision-proof keys for Compose lazy lists.
 *
 * WHY THIS EXISTS
 *   On 2026-10-23 a release build crashed in the field with
 *   `IllegalArgumentException: Key "0" was already used`. The cause: log entries
 *   created in memory (AppLogger) all carry the default `id = 0`, and the
 *   dashboards used `items(logs, key = { it.id })`. Two rows, one key, crash.
 *
 * RULES ENFORCED HERE
 *   1. Never key a row by a single field that can repeat (an unset/default id
 *      is the classic trap - every unsaved row shares it).
 *   2. Namespace every list, so two `items()` blocks in the same LazyColumn can
 *      never fight over the same key even if their data overlaps.
 *   3. Include the index as the final tie-breaker: it makes the key unique by
 *      construction, which is what the crash actually requires.
 *
 * These helpers are deliberately dumb strings - the point is uniqueness, not
 * identity across recompositions.
 */
object ListKeys {

    /** Log rows. `id` may legitimately be 0 for entries that never touched Room. */
    fun log(index: Int, entry: LogEntry): String =
        "log:${entry.id}:${entry.timestamp}:${index}"

    /**
     * Connected clients. Two clients can legitimately report the same id (same IP
     * and user-agent over HTTP and WebSocket), so the index is part of the key.
     */
    fun client(index: Int, client: ConnectedClient): String =
        "client:${client.id}:$index"

    /** Module rows. `prefix` separates the "features" and "components" blocks. */
    fun module(prefix: String, module: ModuleInfo): String =
        "$prefix:${module.id}"

    const val FEATURE = "feature"
    const val COMPONENT = "component"
}
