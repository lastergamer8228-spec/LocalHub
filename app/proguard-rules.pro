# LocalHub ProGuard rules

# Keep NanoHTTPD / NanoWSD (referenced via reflection-free explicit API, but keep for safety)
-keep class fi.iki.elonen.** { *; }
-dontwarn fi.iki.elonen.**

# Gson model classes used for JSON serialization over the REST API / WebSocket
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.localhub.localhub.model.** { *; }
-keep class com.localhub.localhub.data.local.entity.** { *; }

# Gson reflection
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# Keep data classes used with Gson
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
