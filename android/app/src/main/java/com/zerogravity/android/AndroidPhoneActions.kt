package com.zerogravity.android

import android.app.Activity
import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.session.MediaSessionManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class NotificationAccessService : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        activeInstance = this
    }

    override fun onListenerDisconnected() {
        if (activeInstance === this) activeInstance = null
        super.onListenerDisconnected()
    }

    companion object {
        @Volatile
        private var activeInstance: NotificationAccessService? = null

        fun hasAccess(context: Context): Boolean {
            val enabledListeners = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ).orEmpty()
            val expected = ComponentName(context, NotificationAccessService::class.java)
            return enabledListeners.split(':').any { ComponentName.unflattenFromString(it) == expected }
        }

        fun readActiveNotifications(): List<StatusBarNotification>? {
            val service = activeInstance ?: return null
            return runCatching { service.getActiveNotifications()?.toList().orEmpty() }.getOrNull()
        }
    }
}

class AndroidPhoneActionExecutor(private val activity: Activity) : ActionExecutor {
    private val packageManager = activity.packageManager

    override fun execute(action: NativeAction, callback: (NativeActionResult) -> Unit) {
        try {
            when (action.type) {
                NativeActionType.OPEN_INSTALLED_APP -> openInstalledApp(action.arguments, callback)
                NativeActionType.OPEN_ANDROID_SETTINGS -> openSettings(action.arguments, callback)
                NativeActionType.SET_ALARM -> setAlarm(action.arguments, callback)
                NativeActionType.SET_TIMER -> setTimer(action.arguments, callback)
                NativeActionType.START_CALL -> startCall(action.arguments, callback)
                NativeActionType.OPEN_SMS_COMPOSER -> openSmsComposer(action.arguments, callback)
                NativeActionType.CREATE_CALENDAR_EVENT -> createCalendarDraft(action.arguments, callback)
                NativeActionType.CONTROL_MEDIA -> controlMedia(action.arguments, callback)
                NativeActionType.READ_NOTIFICATIONS -> readNotifications(callback)
                NativeActionType.OPEN_NOTIFICATION_ACCESS_SETTINGS -> openNotificationAccessSettings(callback)
                else -> callback(NativeActionResult.Unsupported(action.type.capability))
            }
        } catch (error: Exception) {
            callback(NativeActionResult.Failure(error.message ?: "Android could not complete this action."))
        }
    }

    private fun openInstalledApp(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val requestedName = arguments["appName"]?.trim().orEmpty()
        if (requestedName.isBlank()) {
            callback(NativeActionResult.Failure("Name the installed app you want to open."))
            return
        }
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val matches = packageManager.queryIntentActivities(launcherIntent, 0)
            .mapNotNull { info ->
                val label = info.loadLabel(packageManager)?.toString() ?: return@mapNotNull null
                Triple(label, info.activityInfo.packageName, info.activityInfo.name)
            }
            .filter { it.first.contains(requestedName, ignoreCase = true) }
        val exactMatches = matches.filter { it.first.equals(requestedName, ignoreCase = true) }
        val candidates = if (exactMatches.isNotEmpty()) exactMatches else matches
        if (candidates.size != 1) {
            val explanation = if (candidates.isEmpty()) {
                "No visible installed app matched “$requestedName”. Check its name or install it first."
            } else {
                "More than one installed app matched “$requestedName”. Use a more specific app name."
            }
            callback(NativeActionResult.Failure(explanation))
            return
        }
        val (label, packageName, className) = candidates.single()
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(packageName, className)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        callback(NativeActionResult.Success("Android launched $label."))
    }

    private fun openSettings(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val action = when (arguments["screen"]?.lowercase(Locale.ROOT)) {
            "wifi", "wificonfig" -> Settings.ACTION_WIFI_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "app" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val intent = Intent(action)
        if (action == Settings.ACTION_APPLICATION_DETAILS_SETTINGS) {
            intent.data = Uri.fromParts("package", activity.packageName, null)
        }
        launchResolved(intent, "Android Settings opened.", callback)
    }

    private fun setAlarm(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val hour = arguments["hour"]?.toIntOrNull()
        val minute = arguments["minute"]?.toIntOrNull()
        if (hour == null || hour !in 0..23 || minute == null || minute !in 0..59) {
            callback(NativeActionResult.Failure("Provide a valid alarm time."))
            return
        }
        val label = arguments["label"]?.take(80)?.ifBlank { "ZeroGravity alarm" } ?: "ZeroGravity alarm"
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
        launchResolved(intent, "Android opened the alarm app with the requested time. Review and confirm the alarm there.", callback, AndroidCapability.ALARMS_REMINDERS)
    }

    private fun setTimer(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val seconds = arguments["seconds"]?.toIntOrNull()
        if (seconds == null || seconds !in 1..86400) {
            callback(NativeActionResult.Failure("Timer duration must be between 1 second and 24 hours."))
            return
        }
        val label = arguments["label"]?.take(80)?.ifBlank { "ZeroGravity timer" } ?: "ZeroGravity timer"
        val intent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
        launchResolved(intent, "Android opened the timer app. Review and start the timer there.", callback, AndroidCapability.ALARMS_REMINDERS)
    }

    private fun startCall(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val number = arguments["phoneNumber"]?.takeIf { it.matches(Regex("^\\+?[0-9]{7,20}$")) }
        if (number == null) {
            callback(NativeActionResult.Failure("Provide a valid phone number; contact lookup is not enabled."))
            return
        }
        val intent = Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null))
        launchResolved(intent, "Android initiated the confirmed phone call.", callback, AndroidCapability.PHONE_CALLS)
    }

    private fun openSmsComposer(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val recipient = arguments["recipient"]?.takeIf { it.matches(Regex("^\\+?[0-9]{7,20}$")) }
        val body = arguments["body"]?.takeIf { it.isNotBlank() && it.length <= 1000 }
        if (recipient == null || body == null) {
            callback(NativeActionResult.Failure("A valid phone number and draft message are required."))
            return
        }
        val intent = Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", recipient, null))
            .putExtra("sms_body", body)
        launchResolved(intent, "Android opened a prefilled SMS draft. ZeroGravity did not send the message.", callback, AndroidCapability.SMS_COMPOSE)
    }

    private fun createCalendarDraft(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        val title = arguments["title"]?.trim()?.take(120)
        val start = arguments["beginTimeMillis"]?.toLongOrNull()
        val end = arguments["endTimeMillis"]?.toLongOrNull()
        if (title.isNullOrBlank() || start == null || end == null || start <= 0 || end <= start) {
            callback(NativeActionResult.Failure("Provide an event title and valid future start and end times."))
            return
        }
        val intent = Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
        launchResolved(intent, "Android opened a calendar event draft. Review and save it in your calendar app.", callback, AndroidCapability.CALENDAR)
    }

    private fun readNotifications(callback: (NativeActionResult) -> Unit) {
        if (!NotificationAccessService.hasAccess(activity)) {
            callback(NativeActionResult.PermissionRequired(AndroidCapability.READ_NOTIFICATIONS))
            return
        }
        val notifications = NotificationAccessService.readActiveNotifications()
            ?: run {
                callback(NativeActionResult.Failure("Android notification access is enabled, but the listener is not connected. Reopen ZeroGravity and try again."))
                return
            }
        val visibleNotifications = notifications
            .filterNot { it.packageName == activity.packageName }
            .takeLast(20)
        if (visibleNotifications.isEmpty()) {
            callback(NativeActionResult.Success("There are no active notifications to read."))
            return
        }
        val summary = visibleNotifications.mapNotNull { item ->
            val extras = item.notification.extras
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(100).orEmpty()
            val text = (
                extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                    ?: extras.getCharSequence(Notification.EXTRA_TEXT)
                )?.toString()?.take(240).orEmpty()
            listOf(title, text).filter(String::isNotBlank).joinToString(": ").takeIf(String::isNotBlank)
        }.takeLast(10).joinToString("\n")
        callback(NativeActionResult.Success(if (summary.isBlank()) "Active notifications have no readable text." else summary))
    }

    private fun controlMedia(arguments: Map<String, String>, callback: (NativeActionResult) -> Unit) {
        if (!NotificationAccessService.hasAccess(activity)) {
            callback(NativeActionResult.PermissionRequired(AndroidCapability.READ_NOTIFICATIONS))
            return
        }
        val operation = arguments["operation"]
        val sessions = activity.getSystemService(MediaSessionManager::class.java)
            .getActiveSessions(ComponentName(activity, NotificationAccessService::class.java))
        val session = sessions.firstOrNull { controller ->
            val state = controller.playbackState?.state
            state == android.media.session.PlaybackState.STATE_PLAYING
                || state == android.media.session.PlaybackState.STATE_PAUSED
                || state == android.media.session.PlaybackState.STATE_BUFFERING
        }
        if (session == null) {
            callback(NativeActionResult.Unsupported(AndroidCapability.MEDIA_CONTROLS))
            return
        }
        val controls = session.transportControls
        val requiredAction = when (operation) {
            "PLAY" -> android.media.session.PlaybackState.ACTION_PLAY
            "PAUSE" -> android.media.session.PlaybackState.ACTION_PAUSE
            "NEXT", "SKIP" -> android.media.session.PlaybackState.ACTION_SKIP_TO_NEXT
            "PREVIOUS" -> android.media.session.PlaybackState.ACTION_SKIP_TO_PREVIOUS
            else -> 0L
        }
        val playbackState = session.playbackState
        if (requiredAction == 0L || playbackState == null || playbackState.actions.and(requiredAction) == 0L) {
            callback(NativeActionResult.Unsupported(AndroidCapability.MEDIA_CONTROLS))
            return
        }
        when (operation) {
            "PLAY" -> controls.play()
            "PAUSE" -> controls.pause()
            "NEXT", "SKIP" -> controls.skipToNext()
            "PREVIOUS" -> controls.skipToPrevious()
        }
        callback(NativeActionResult.Success("Playback command dispatched to ${session.packageName}; the media app controls playback."))
    }

    private fun openNotificationAccessSettings(callback: (NativeActionResult) -> Unit) {
        launchResolved(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS),
            "Android notification-access settings opened. Enable ZeroGravity there, then return and try again.",
            callback,
            AndroidCapability.READ_NOTIFICATIONS
        )
    }

    private fun launchResolved(
        intent: Intent,
        successMessage: String,
        callback: (NativeActionResult) -> Unit,
        capability: AndroidCapability = AndroidCapability.ANDROID_SETTINGS
    ) {
        if (intent.resolveActivity(packageManager) == null) {
            callback(NativeActionResult.Unsupported(capability))
            return
        }
        activity.startActivity(intent)
        callback(NativeActionResult.Success(successMessage))
    }
}

class AndroidPhoneActionsBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val capabilityManager: CapabilityManager,
    private val registry: CapabilityRegistry,
    private val permissionManager: PermissionManager
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val allowedPagePrefix = "https://appassets.androidplatform.net/assets/zerogravity/"

    @JavascriptInterface
    fun getCapabilities(callbackId: String) {
        mainHandler.post {
            if (!isTrustedPage()) {
                complete(callbackId, JSONObject().put("status", "failure").put("message", "Untrusted page origin."))
                return@post
            }
            val rows = JSONArray()
            val exposedActions = listOf(
                NativeActionType.OPEN_INSTALLED_APP,
                NativeActionType.OPEN_ANDROID_SETTINGS,
                NativeActionType.SET_ALARM,
                NativeActionType.SET_TIMER,
                NativeActionType.START_CALL,
                NativeActionType.OPEN_SMS_COMPOSER,
                NativeActionType.CREATE_CALENDAR_EVENT,
                NativeActionType.CONTROL_MEDIA,
                NativeActionType.READ_NOTIFICATIONS,
                NativeActionType.OPEN_NOTIFICATION_ACCESS_SETTINGS
            )
            exposedActions.forEach { action ->
                val descriptor = registry.get(action.capability)
                val permission = when (action.capability) {
                    AndroidCapability.PHONE_CALLS -> if (permissionManager.hasPermission(AndroidCapability.PHONE_CALLS)) "Granted" else "Not granted; asked only after call confirmation"
                    AndroidCapability.READ_NOTIFICATIONS -> if (NotificationAccessService.hasAccess(activity)) "Granted in Android Settings" else "Not granted"
                    AndroidCapability.MEDIA_CONTROLS -> if (NotificationAccessService.hasAccess(activity)) "Granted in Android Settings" else "Notification access required"
                    else -> "Not required"
                }
                rows.put(
                    JSONObject()
                        .put("id", action.name)
                        .put("label", action.name.lowercase(Locale.ROOT).replace('_', ' '))
                        .put("available", descriptor.available)
                        .put("permission", permission)
                        .put("reason", descriptor.unavailableReason ?: "")
                )
            }
            complete(callbackId, JSONObject().put("status", "success").put("message", "Capabilities refreshed.").put("capabilities", rows))
        }
    }

    @JavascriptInterface
    fun execute(actionName: String, argumentsJson: String, callbackId: String) {
        mainHandler.post {
            if (!isTrustedPage()) {
                complete(callbackId, JSONObject().put("status", "failure").put("message", "Phone commands are accepted only from the bundled ZeroGravity app."))
                return@post
            }
            val actionType = runCatching { NativeActionType.valueOf(actionName) }.getOrNull()
            if (actionType == null) {
                complete(callbackId, JSONObject().put("status", "unsupported").put("message", "Android does not support that phone action."))
                return@post
            }
            val arguments = try {
                val json = JSONObject(argumentsJson)
                json.keys().asSequence().associateWith { key -> json.opt(key)?.toString().orEmpty() }
            } catch (_: Exception) {
                complete(callbackId, JSONObject().put("status", "failure").put("message", "Phone-action arguments were invalid."))
                return@post
            }
            if (actionType == NativeActionType.OPEN_NOTIFICATION_ACCESS_SETTINGS) {
                confirmNotificationAccess(callbackId)
                return@post
            }
            if (actionType == NativeActionType.READ_NOTIFICATIONS
                && !NotificationAccessService.hasAccess(activity)
            ) {
                complete(
                    callbackId,
                    JSONObject().put("status", "permission-required")
                        .put("message", "Notification access has not been granted. Choose Grant access, approve it in Android Settings, then return.")
                )
                return@post
            }
            val sensitive = actionType.requiresUserConfirmation || actionType.capability == AndroidCapability.PHONE_CALLS
            val perform = {
                capabilityManager.invoke(
                    NativeAction(
                        id = callbackId,
                        type = actionType,
                        arguments = arguments,
                        confirmedByUser = sensitive
                    )
                ) { result -> mainHandler.post { complete(callbackId, result.toJson()) } }
            }
            if (sensitive) {
                AlertDialogFactory.show(
                    activity,
                    title = confirmationTitle(actionType),
                    message = confirmationMessage(actionType, arguments),
                    onConfirm = perform,
                    onCancel = {
                        complete(callbackId, JSONObject().put("status", "cancelled").put("message", "Cancelled. No Android action was started."))
                    }
                )
            } else {
                perform()
            }
        }
    }

    private fun confirmNotificationAccess(callbackId: String) {
        if (NotificationAccessService.hasAccess(activity)) {
            complete(callbackId, JSONObject().put("status", "success").put("message", "Android notification access is already enabled."))
            return
        }
        AlertDialogFactory.show(
            activity,
            title = "Notification access",
            message = "Android notification access lets ZeroGravity read active notification titles and text when you explicitly ask. Continue to Android Settings to grant or deny this access.",
            onConfirm = {
                try {
                    activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    complete(callbackId, JSONObject().put("status", "permission-required").put("message", "Grant or deny ZeroGravity notification access in Android Settings, then return."))
                } catch (_: Exception) {
                    complete(callbackId, JSONObject().put("status", "failure").put("message", "Android notification-access settings could not be opened."))
                }
            },
            onCancel = {
                complete(callbackId, JSONObject().put("status", "cancelled").put("message", "Notification access was not requested."))
            }
        )
    }

    private fun isTrustedPage(): Boolean = webView.url?.startsWith(allowedPagePrefix) == true

    private fun complete(callbackId: String, result: JSONObject) {
        val callback = JSONObject.quote(callbackId)
        val payload = JSONObject.quote(result.toString())
        webView.evaluateJavascript(
            "window.ZeroGravityPhoneActionCallbacks?.[$callback]?.(JSON.parse($payload))",
            null
        )
    }

    private fun confirmationTitle(action: NativeActionType): String = when (action) {
        NativeActionType.START_CALL -> "Confirm phone call"
        NativeActionType.OPEN_SMS_COMPOSER -> "Open message draft?"
        NativeActionType.CREATE_CALENDAR_EVENT -> "Open calendar draft?"
        NativeActionType.SET_ALARM -> "Open alarm app?"
        NativeActionType.SET_TIMER -> "Open timer app?"
        else -> "Confirm Android action"
    }

    private fun confirmationMessage(action: NativeActionType, arguments: Map<String, String>): String = when (action) {
        NativeActionType.START_CALL -> "Place a call to ${arguments["phoneNumber"] ?: "the requested number"}? Android will request CALL_PHONE permission if it has not been granted."
        NativeActionType.OPEN_SMS_COMPOSER -> "Open a prefilled SMS draft to ${arguments["recipient"] ?: "the requested number"}? ZeroGravity will not send it; review and send it yourself in your messaging app."
        NativeActionType.CREATE_CALENDAR_EVENT -> "Open a calendar draft for “${arguments["title"] ?: "the requested event"}”? Review and save it in your calendar app."
        NativeActionType.SET_ALARM -> "Open the Android alarm app for ${arguments["hour"]}:${arguments["minute"]}? Review and confirm the alarm there."
        NativeActionType.SET_TIMER -> "Open the Android timer app for ${arguments["seconds"]} seconds? Review and start the timer there."
        else -> "Continue with this Android action?"
    }

    private fun NativeActionResult.toJson(): JSONObject = when (this) {
        is NativeActionResult.Success -> JSONObject()
            .put("status", "success")
            .put("message", message)
            .put("data", JSONObject(data))
        is NativeActionResult.Failure -> JSONObject().put("status", "failure").put("message", message)
        is NativeActionResult.RequiresConfirmation -> JSONObject().put("status", "confirmation-required").put("message", message)
        is NativeActionResult.PermissionRequired -> JSONObject()
            .put("status", "permission-required")
            .put("message", if (capability == AndroidCapability.READ_NOTIFICATIONS)
                "Grant ZeroGravity notification-listener access in Android Settings before reading notifications."
            else "Android permission is required for this action. Enable it in app settings if you denied it.")
        is NativeActionResult.Unsupported -> JSONObject().put("status", "unsupported").put("message", "No Android handler is available for ${capability.name.lowercase(Locale.ROOT).replace('_', ' ')}.")
    }
}

private object AlertDialogFactory {
    fun show(activity: Activity, title: String, message: String, onConfirm: () -> Unit, onCancel: () -> Unit) {
        android.app.AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton("Cancel") { _, _ -> onCancel() }
            .setPositiveButton("Continue") { _, _ -> onConfirm() }
            .setOnCancelListener { onCancel() }
            .show()
    }
}
