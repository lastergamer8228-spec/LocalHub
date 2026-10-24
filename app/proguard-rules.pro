# LocalHub ProGuard / R8 rules
#
# LocalHub is a *server*: most of its classes are reached through reflection,
# through the manifest (services/receivers) or through JSON. Anything R8 cannot
# prove is reachable must be pinned here, otherwise the release build shrinks
# away a feature that works perfectly in debug.

# ---------------------------------------------------------------------------
# NanoHTTPD / NanoWSD - the whole HTTP + WebSocket surface
# ---------------------------------------------------------------------------
-keep class fi.iki.elonen.** { *; }
-dontwarn fi.iki.elonen.**
-keepclassmembers class fi.iki.elonen.** { *; }

# ---------------------------------------------------------------------------
# Gson - JSON is our wire format. Kotlin data-class field names ARE the API.
# ---------------------------------------------------------------------------
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**
# Models shipped to the browser / dashboard / WebSocket clients.
-keep class com.localhub.localhub.model.** { *; }
-keep class com.localhub.localhub.data.local.entity.** { *; }
-keep class com.localhub.localhub.data.backup.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
# Gson falls back to reflection for any type it meets; keep the reflective
# constructors/fields alive for anything we hand to toJson/fromJson.
-keepclassmembers class com.localhub.localhub.** {
    <init>(...);
}

# ---------------------------------------------------------------------------
# Room - generated DAOs + entities are instantiated by generated code, and the
# database class itself is looked up by the generated implementation.
# ---------------------------------------------------------------------------
-keep class androidx.room.** { *; }
-dontwarn androidx.room.**
-keep class * extends androidx.room.RoomDatabase { *; }
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao class * { *; }
-keep class com.localhub.localhub.data.local.** { *; }

# ---------------------------------------------------------------------------
# Coroutines - the Main dispatcher is discovered reflectively.
# ---------------------------------------------------------------------------
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

# ---------------------------------------------------------------------------
# ffmpeg-kit (LGPL native decoder for AC-3/E-AC-3 -> AAC).
# Native code calls back into Java by name; stripping any of it breaks audio
# adaptation at runtime, not at compile time.
# ---------------------------------------------------------------------------
-keep class com.arthenica.ffmpegkit.** { *; }
-dontwarn com.arthenica.ffmpegkit.**

# ---------------------------------------------------------------------------
# ZXing (QR codes on the connect screen) - pure Java, but keep for safety.
# ---------------------------------------------------------------------------
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**

# ---------------------------------------------------------------------------
# Android entry points declared in the manifest (AGP keeps these automatically,
# listed explicitly so a manifest refactor cannot silently drop them).
# ---------------------------------------------------------------------------
-keep class com.localhub.localhub.LocalHubApplication { *; }
-keep class com.localhub.localhub.service.** { *; }
-keep class com.localhub.localhub.system.RemoteAccessService { *; }
-keep class com.localhub.localhub.ui.MainActivity { *; }
-keep class com.localhub.localhub.ui.MirrorActivity { *; }
-keep class * extends android.app.Service
-keep class * extends android.content.BroadcastReceiver
-keep class * extends android.app.Activity

# ---------------------------------------------------------------------------
# Web assets in src/main/assets are NOT touched by R8 or resource shrinking.
# Nothing to keep; documented here so nobody "optimises" them away.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Keep Kotlin metadata for reflection over our own classes (Compose tooling).
# ---------------------------------------------------------------------------
-keepclassmembers class com.localhub.localhub.** {
    *** Companion;
}
-keepclassmembers class com.localhub.localhub.**$* {
    <init>(...);
}
