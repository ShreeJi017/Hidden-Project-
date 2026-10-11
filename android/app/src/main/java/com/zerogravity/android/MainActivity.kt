package com.zerogravity.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.PermissionRequest
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var permissionManager: PermissionManager
    private lateinit var phoneActionBridge: AndroidPhoneActionsBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        permissionManager = PermissionManager(this)

        val registry = CapabilityRegistry(
            setOf(
                AndroidCapability.APP_LAUNCH,
                AndroidCapability.ANDROID_SETTINGS,
                AndroidCapability.ALARMS_REMINDERS,
                AndroidCapability.PHONE_CALLS,
                AndroidCapability.SMS_COMPOSE,
                AndroidCapability.CALENDAR,
                AndroidCapability.READ_NOTIFICATIONS,
                AndroidCapability.MEDIA_CONTROLS
            )
        )
        val capabilityManager = CapabilityManager(
            permissionManager,
            registry,
            AndroidPhoneActionExecutor(this)
        )
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setGeolocationEnabled(true)
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.safeBrowsingEnabled = true
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        if (!isTrustedOrigin(request.origin)
                            || request.resources.toSet() != setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            request.deny()
                            return@runOnUiThread
                        }
                        try {
                            permissionManager.requestForUserAction(AndroidCapability.MICROPHONE) { result ->
                                if (result.state == PermissionState.GRANTED && isTrustedOrigin(request.origin)) {
                                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                                } else {
                                    request.deny()
                                }
                            }
                        } catch (_: IllegalStateException) {
                            request.deny()
                        }
                    }
                }

                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: GeolocationPermissions.Callback
                ) {
                    val uri = Uri.parse(origin)
                    if (!isTrustedOrigin(uri)) {
                        callback.invoke(origin, false, false)
                        return
                    }
                    try {
                        permissionManager.requestForUserAction(AndroidCapability.LOCATION) { result ->
                            callback.invoke(
                                origin,
                                result.state == PermissionState.GRANTED && isTrustedOrigin(uri),
                                false
                            )
                        }
                    } catch (_: IllegalStateException) {
                        callback.invoke(origin, false, false)
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val response = assetLoader.shouldInterceptRequest(request.url)
                    if (response != null) return response
                    if (request.url.host == "appassets.androidplatform.net") {
                        return WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            404,
                            "Not Found",
                            emptyMap(),
                            ByteArrayInputStream(ByteArray(0))
                        )
                    }
                    return null
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest
                ): Boolean {
                    val uri = request.url
                    if (uri.toString().startsWith(TRUSTED_PAGE_PREFIX)) return false
                    if (request.isForMainFrame && uri.scheme in setOf("http", "https")) {
                        runCatching {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                        }.onFailure {
                            Toast.makeText(this@MainActivity, "No app could open this web link.", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return true
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    if (url?.startsWith(TRUSTED_PAGE_PREFIX) != true) {
                        view?.loadUrl(TRUSTED_PAGE_URL)
                    } else {
                        view?.evaluateJavascript("window.ZeroGravityRefreshPhoneCapabilities?.()", null)
                    }
                }
            }
        }
        phoneActionBridge = AndroidPhoneActionsBridge(
            activity = this,
            webView = webView,
            capabilityManager = capabilityManager,
            registry = registry,
            permissionManager = permissionManager
        )
        webView.addJavascriptInterface(phoneActionBridge, "ZeroGravityNativePhoneActions")
        webView.addJavascriptInterface(AndroidImageSaveBridge(this, webView), "ZeroGravityNativeImages")
        setContentView(webView)
        if (savedInstanceState == null) {
            webView.loadUrl(TRUSTED_PAGE_URL)
        } else {
            webView.restoreState(savedInstanceState) ?: webView.loadUrl(TRUSTED_PAGE_URL)
        }
    }

    @Deprecated("Use requestForUserAction through PermissionManager for capability permissions.")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permissionManager.onRequestPermissionsResult(requestCode, grantResults)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized && webView.url?.startsWith(TRUSTED_PAGE_PREFIX) == true) {
            webView.evaluateJavascript("window.ZeroGravityRefreshPhoneCapabilities?.()", null)
        }
    }

    @Deprecated("Use the Android back dispatcher when migrating the host Activity.")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        permissionManager.clearPendingRequest()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("ZeroGravityNativePhoneActions")
            webView.removeJavascriptInterface("ZeroGravityNativeImages")
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val TRUSTED_PAGE_URL = "https://appassets.androidplatform.net/assets/zerogravity/index.html"
        private const val TRUSTED_PAGE_PREFIX = "https://appassets.androidplatform.net/assets/zerogravity/"
    }

    private fun isTrustedOrigin(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == "appassets.androidplatform.net"
}
