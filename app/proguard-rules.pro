# Keep the single, intentionally small JavaScript bridge if shrinking is enabled later.
-keepclassmembers class com.qingyan.editor.MainActivity$ImageBridge {
    @android.webkit.JavascriptInterface <methods>;
}
