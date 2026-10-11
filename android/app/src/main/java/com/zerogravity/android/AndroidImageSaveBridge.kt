package com.zerogravity.android

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

class AndroidImageSaveBridge(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val allowedPagePrefix = "https://appassets.androidplatform.net/assets/zerogravity/"
    private val executor = Executors.newSingleThreadExecutor()
    private val allowedMimeTypes = setOf("image/png", "image/jpeg", "image/webp", "image/gif")

    @JavascriptInterface
    fun saveImage(dataUrl: String, mimeType: String, filename: String, callbackId: String) {
        if (callbackId.length !in 1..120 || !callbackId.matches(Regex("[A-Za-z0-9_-]+"))) {
            return
        }
        activity.runOnUiThread {
            if (!isTrustedPage()) {
                complete(callbackId, "failure", "Image saving is accepted only from the bundled ZeroGravity app.")
                return@runOnUiThread
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                complete(callbackId, "unsupported", "Saving to Android Photos through MediaStore requires Android 10 or newer.")
                return@runOnUiThread
            }
            if (mimeType !in allowedMimeTypes) {
                complete(callbackId, "failure", "This image format is not supported for Android Photos.")
                return@runOnUiThread
            }
            if (!dataUrl.startsWith("data:$mimeType;base64,") || dataUrl.length > MAX_ENCODED_LENGTH) {
                complete(callbackId, "failure", "The image data is invalid or exceeds the 20 MB save limit.")
                return@runOnUiThread
            }
            executor.execute {
                saveDecodedImage(dataUrl.substringAfter(','), mimeType, filename, callbackId)
            }
        }
    }

    private fun saveDecodedImage(encoded: String, mimeType: String, filename: String, callbackId: String) {
        var imageUri: Uri? = null
        try {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            if (bytes.isEmpty() || bytes.size > MAX_IMAGE_BYTES) {
                complete(callbackId, "failure", "The image data is empty or exceeds the 20 MB save limit.")
                return
            }
            val safeFilename = filename
                .replace(Regex("[^A-Za-z0-9_-]"), "-")
                .trim('-')
                .take(80)
                .ifEmpty { "ZeroGravity-image" }
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "$safeFilename.${mimeType.substringAfter('/')}")
                put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/ZeroGravity")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val resolver = activity.contentResolver
            val savedUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Android could not create a Photos item.")
            imageUri = savedUri
            resolver.openOutputStream(savedUri, "w")?.use { output ->
                output.write(bytes)
            } ?: throw IllegalStateException("Android could not open the image file.")
            val published = ContentValues().apply {
                put(MediaStore.Images.Media.IS_PENDING, 0)
            }
            if (resolver.update(savedUri, published, null, null) != 1) {
                throw IllegalStateException("Android could not finish saving the image.")
            }
            complete(callbackId, "success", "Image saved to Pictures/ZeroGravity and available in Android Photos.")
        } catch (error: Exception) {
            val cleanupFailed = imageUri?.let { uri ->
                try {
                    activity.contentResolver.delete(uri, null, null) != 1
                } catch (_: Exception) {
                    true
                }
            } ?: false
            val message = (error.message ?: "Android could not save this image.") +
                if (cleanupFailed) " Android could not remove the incomplete Photos item; check your gallery." else ""
            complete(callbackId, "failure", message)
        }
    }

    private fun isTrustedPage(): Boolean = webView.url?.startsWith(allowedPagePrefix) == true

    private fun complete(callbackId: String, status: String, message: String) {
        if (callbackId.length !in 1..120 || !callbackId.matches(Regex("[A-Za-z0-9_-]+"))) return
        val callback = JSONObject.quote(callbackId)
        val result = JSONObject()
            .put("status", status)
            .put("message", message)
        val payload = JSONObject.quote(result.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.ZeroGravityImageSaveResult?.($callback, JSON.parse($payload))",
                null
            )
        }
    }

    companion object {
        private const val MAX_IMAGE_BYTES = 20 * 1024 * 1024
        private const val MAX_ENCODED_LENGTH = 28 * 1024 * 1024
    }
}
