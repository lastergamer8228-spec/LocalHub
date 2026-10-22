package com.localhub.localhub.system

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TtsEngine — offline text-to-speech for LocalHub.
 *
 * Uses the **Android system TTS engine** (typically Google TTS) to synthesise
 * speech to a WAV file, then serves it over HTTP. This is **instant, fully
 * offline, and uses the phone's built-in voice engine** — no large neural model,
 * no cloud, no heavy CPU load. Works great on low-end devices (e.g. Hot 9).
 *
 * Architecture:
 *   Web UI (text) → POST /api/tts/synthesize → System TTS → WAV in cache
 *   → GET /api/tts/file?name=... → browser audio player
 *
 * Notes:
 * - English is the default; any language supported by the installed TTS engine
 *   works (e.g. add Hindi voice pack in Android Settings for Hindi).
 * - This replaced the earlier Pocket TTS (sherpa-onnx) engine, which was too
 *   slow on low-end hardware. Pocket TTS files can be removed from assets.
 *
 * This file is **code-reviewed only** in this project's build pipeline — the
 * Android SDK must be present to compile it. See README "Offline Neural TTS".
 */
class TtsEngine(private val context: Context) {

    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ready = AtomicBoolean(false)
    @Volatile private var lastError: String? = null

    /** Blocking init: wait for the system TTS engine to become ready. */
    private fun ensureInit(): TextToSpeech? {
        tts?.let { return it }
        val latch = CountDownLatch(1)
        var instance: TextToSpeech? = null
        instance = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ready.set(true)
                lastError = null
            } else {
                lastError = "TTS engine init failed (status=$status)"
            }
            latch.countDown()
        }
        tts = instance
        // Wait up to 5s for the engine (usually <1s).
        latch.await(5, TimeUnit.SECONDS)
        return if (ready.get()) instance else null
    }

    /** Set the default language for synthesis (best-effort). */
    fun setLanguage(lang: String?) {
        try {
            val engine = ensureInit() ?: return
            val loc = when {
                lang.isNullOrBlank() -> Locale.US
                lang.startsWith("hi", true) -> Locale("hi", "IN")
                else -> Locale(lang.replace("-", "_").take(2).ifEmpty { "en" })
            }
            engine.language = loc
            selectBestVoice(engine, loc)
        } catch (e: Exception) {
            lastError = e.message
        }
    }

    /**
     * Picks the most natural-sounding **offline** voice available on the phone
     * for [loc], preferring higher-quality neural/high-quality voices over
     * robotic defaults (e.g. eSpeak). Falls back gracefully to whatever the
     * engine provides. This is the main lever for a humanoid, non-robotic sound
     * with zero speed cost (no model download).
     */
    private fun selectBestVoice(engine: TextToSpeech, loc: Locale) {
        try {
            val voices = engine.voices ?: return
            if (voices.isEmpty()) return

            val langTag = loc.language.lowercase()

            // Candidate voices: same language (or language match), offline only.
            val candidates = voices.filter { v ->
                !v.isNetworkConnectionRequired &&
                    (v.locale.language.lowercase() == langTag ||
                        v.locale.language.equals("en", true) && langTag == "en")
            }
            if (candidates.isEmpty()) return

            // Score: prefer very-high/high quality, and names hinting at neural
            // / natural / enhanced / high-quality / Google voices.
            val best = candidates.maxWith(compareBy(
                { (if (it.name.contains("natural", true) || it.name.contains("neural", true)) 2000 else 0) +
                    (if (it.name.contains("high", true) || it.name.contains("enhanced", true)) 1000 else 0) +
                    (if (it.name.contains("google", true)) 500 else 0) +
                    it.quality },
                { -it.latency }
            ))
            if (best != null && best.name != engine.voice?.name) {
                engine.setVoice(best)
            }
        } catch (e: Exception) {
            // Non-fatal: keep whatever the engine defaulted to.
        }
    }

    /**
     * Synthesises [text] to a WAV file in [outDir]. Blocks until done.
     * Returns the generated file, or null on failure.
     */
    fun synthesize(
        text: String,
        outDir: File,
        speed: Float = 1.0f,
        lang: String? = "en-US"
    ): File? {
        if (text.isBlank()) { lastError = "Empty text"; return null }
        val engine = ensureInit() ?: return null
        setLanguage(lang)

        outDir.mkdirs()
        val out = File(outDir, "tts_${System.currentTimeMillis()}.wav")
        val done = CountDownLatch(1)
        val success = AtomicBoolean(false)

        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { success.set(true); done.countDown() }
            @Deprecated("Deprecated in Java")
            override fun onError(id: String?) { lastError = "TTS synthesis error"; done.countDown() }
            override fun onError(id: String?, errorCode: Int) { lastError = "TTS error $errorCode"; done.countDown() }
        })

        val params = android.os.Bundle().apply {
            // Use literal keys ("rate"/"pitch") — the same values as
            // TextToSpeech.Engine.KEY_PARAM_RATE/KEY_PARAM_PITCH but avoids a
            // version-specific unresolved-reference in the build.
            putFloat("rate", speed)
            putFloat("pitch", 1.0f)
        }
        val result = engine.synthesizeToFile(text, params, out, "localhub-tts")
        if (result != TextToSpeech.SUCCESS) {
            lastError = "synthesizeToFile failed (result=$result)"
            return null
        }
        // Wait for synthesis (usually fast).
        done.await(20, TimeUnit.SECONDS)

        return if (success.get() && out.exists() && out.length() > 0) out else {
            if (lastError == null) lastError = "TTS produced no audio"
            null
        }
    }

    /**
     * Voice cloning is NOT supported by the system TTS engine (it uses the
     * phone's built-in voices). Returned as an informative error so the UI can
     * explain, rather than silently failing.
     */
    fun synthesizeWithVoice(
        text: String,
        refWav: File,
        outDir: File,
        refText: String? = null,
        speed: Float = 1.0f
    ): File? {
        lastError = "Voice cloning requires a neural model (Pocket TTS). The system TTS engine only supports built-in voices."
        return null
    }

    /** The system TTS is always available (uses the phone's built-in engine). */
    val isConfigured: Boolean get() = ready.get()

    @Volatile var isBusy: Boolean = false
        private set

    fun modelDir(): File = File(context.getExternalFilesDir(null) ?: context.filesDir, "tts")

    fun release() {
        runCatching { tts?.shutdown() }
        tts = null
        ready.set(false)
    }

    fun status(): Map<String, Any?> {
        val cfg = ready.get()
        return mapOf(
            "ok" to true,
            "engine" to "Android System TTS (built-in)",
            "available" to cfg,
            "configured" to cfg,
            "bundled" to false,
            "busy" to isBusy,
            "languages" to "All languages supported by the phone's TTS engine (incl. Hindi with voice pack)",
            "needsModel" to false,
            "sampleRate" to 0,
            "voice" to (tts?.voice?.name ?: "engine default"),
            "voiceCount" to (tts?.voices?.size ?: 0),
            "lastError" to lastError
        )
    }
}
