package com.zerogravity.android

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.os.StatFs

enum class AndroidCapability(val permissions: List<String>) {
    MICROPHONE(listOf(Manifest.permission.RECORD_AUDIO)),
    NOTIFICATIONS(if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()),
    CONTACTS(listOf(Manifest.permission.READ_CONTACTS)),
    PHONE_CALLS(listOf(Manifest.permission.CALL_PHONE)),
    SMS_COMPOSE(emptyList()),
    CALENDAR(emptyList()),
    READ_NOTIFICATIONS(emptyList()),
    LOCATION(listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)),
    BLUETOOTH(if (Build.VERSION.SDK_INT >= 31) listOf(Manifest.permission.BLUETOOTH_CONNECT) else emptyList()),
    APP_LAUNCH(emptyList()),
    ANDROID_SETTINGS(emptyList()),
    ALARMS_REMINDERS(emptyList()),
    MEDIA_CONTROLS(emptyList()),
    DEVICE_INFO(emptyList())
}

enum class PermissionState {
    GRANTED,
    DENIED,
    NOT_REQUIRED
}

data class CapabilityPermissionResult(
    val capability: AndroidCapability,
    val state: PermissionState,
    val deniedPermissions: List<String> = emptyList()
)

class PermissionManager(private val activity: MainActivity) {
    private var pendingResult: ((CapabilityPermissionResult) -> Unit)? = null
    private var pendingCapability: AndroidCapability? = null

    fun hasPermission(capability: AndroidCapability): Boolean {
        val grants = capability.permissions.map { permission ->
            activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        }
        return if (capability == AndroidCapability.LOCATION) grants.any { it } else grants.all { it }
    }

    fun requestForUserAction(
        capability: AndroidCapability,
        callback: (CapabilityPermissionResult) -> Unit
    ) {
        val required = capability.permissions
        if (required.isEmpty()) {
            callback(CapabilityPermissionResult(capability, PermissionState.NOT_REQUIRED))
            return
        }
        if (hasPermission(capability)) {
            callback(CapabilityPermissionResult(capability, PermissionState.GRANTED))
            return
        }
        check(pendingResult == null) { "A permission request is already in progress." }
        pendingCapability = capability
        pendingResult = callback
        activity.requestPermissions(required.toTypedArray(), REQUEST_CODE)
    }

    fun onRequestPermissionsResult(
        requestCode: Int,
        grantResults: IntArray
    ): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val capability = pendingCapability ?: return false
        val callback = pendingResult ?: return false
        pendingCapability = null
        pendingResult = null
        val denied = capability.permissions.filterIndexed { index, _ ->
            grantResults.getOrNull(index) != PackageManager.PERMISSION_GRANTED
        }
        callback(
            CapabilityPermissionResult(
                capability = capability,
                state = if (hasPermission(capability)) PermissionState.GRANTED else PermissionState.DENIED,
                deniedPermissions = denied
            )
        )
        return true
    }

    fun clearPendingRequest() {
        pendingResult = null
        pendingCapability = null
    }

    companion object {
        private const val REQUEST_CODE = 7401
    }
}

data class CapabilityDescriptor(
    val capability: AndroidCapability,
    val requiresUserConfirmation: Boolean,
    val available: Boolean,
    val unavailableReason: String? = null
)

class CapabilityRegistry(
    availableCapabilities: Set<AndroidCapability> = emptySet()
) {
    private val descriptors = AndroidCapability.entries.associateWith { capability ->
        val available = capability in availableCapabilities
        CapabilityDescriptor(
            capability = capability,
            requiresUserConfirmation = capability in setOf(
                AndroidCapability.PHONE_CALLS,
                AndroidCapability.SMS_COMPOSE,
                AndroidCapability.CALENDAR,
                AndroidCapability.ALARMS_REMINDERS
            ),
            available = available,
            unavailableReason = if (available) null else "No native action provider is registered."
        )
    }

    fun get(capability: AndroidCapability): CapabilityDescriptor =
        checkNotNull(descriptors[capability])

    fun all(): List<CapabilityDescriptor> = descriptors.values.toList()
}

enum class NativeActionType(
    val capability: AndroidCapability,
    val requiresUserConfirmation: Boolean = false
) {
    OPEN_INSTALLED_APP(AndroidCapability.APP_LAUNCH),
    OPEN_ANDROID_SETTINGS(AndroidCapability.ANDROID_SETTINGS),
    SET_ALARM(AndroidCapability.ALARMS_REMINDERS, requiresUserConfirmation = true),
    CREATE_ALARM(AndroidCapability.ALARMS_REMINDERS),
    CREATE_REMINDER(AndroidCapability.ALARMS_REMINDERS),
    CONTROL_MEDIA(AndroidCapability.MEDIA_CONTROLS),
    LOOK_UP_CONTACT(AndroidCapability.CONTACTS, requiresUserConfirmation = true),
    START_CALL(AndroidCapability.PHONE_CALLS, requiresUserConfirmation = true),
    OPEN_SMS_COMPOSER(AndroidCapability.SMS_COMPOSE, requiresUserConfirmation = true),
    CREATE_CALENDAR_EVENT(AndroidCapability.CALENDAR, requiresUserConfirmation = true),
    SET_TIMER(AndroidCapability.ALARMS_REMINDERS, requiresUserConfirmation = true),
    READ_NOTIFICATIONS(AndroidCapability.READ_NOTIFICATIONS),
    OPEN_NOTIFICATION_ACCESS_SETTINGS(AndroidCapability.READ_NOTIFICATIONS),
    POST_NOTIFICATION(AndroidCapability.NOTIFICATIONS),
    READ_DEVICE_INFO(AndroidCapability.DEVICE_INFO),
    GET_LOCATION(AndroidCapability.LOCATION, requiresUserConfirmation = true),
    CONTROL_BLUETOOTH(AndroidCapability.BLUETOOTH, requiresUserConfirmation = true)
}

data class NativeAction(
    val id: String,
    val type: NativeActionType,
    val arguments: Map<String, String> = emptyMap(),
    val confirmedByUser: Boolean = false
)

sealed interface NativeActionResult {
    data class Success(val message: String, val data: Map<String, String> = emptyMap()) : NativeActionResult
    data class Failure(val message: String) : NativeActionResult
    data class RequiresConfirmation(val message: String) : NativeActionResult
    data class PermissionRequired(val capability: AndroidCapability) : NativeActionResult
    data class Unsupported(val capability: AndroidCapability) : NativeActionResult
}

interface ActionExecutor {
    fun execute(action: NativeAction, callback: (NativeActionResult) -> Unit)
}

class CapabilityManager(
    private val permissions: PermissionManager,
    private val registry: CapabilityRegistry,
    private val executor: ActionExecutor
) {
    fun invoke(action: NativeAction, callback: (NativeActionResult) -> Unit) {
        val capability = action.type.capability
        val descriptor = registry.get(capability)
        if (!descriptor.available) {
            callback(NativeActionResult.Unsupported(capability))
            return
        }
        if ((descriptor.requiresUserConfirmation || action.type.requiresUserConfirmation)
            && !action.confirmedByUser
        ) {
            callback(NativeActionResult.RequiresConfirmation("Confirm this action before continuing."))
            return
        }
        permissions.requestForUserAction(capability) { result ->
            if (result.state == PermissionState.DENIED) {
                callback(NativeActionResult.PermissionRequired(capability))
                return@requestForUserAction
            }
            try {
                executor.execute(action, callback)
            } catch (error: Exception) {
                callback(NativeActionResult.Failure(error.message ?: "The native action failed."))
            }
        }
    }
}

interface VoiceService {
    val isRunning: Boolean
    fun start(callback: (Result<Unit>) -> Unit)
    fun stop(callback: (Result<Unit>) -> Unit)
}

interface EncryptedCredentialStore {
    fun get(providerId: String): Map<String, String>?
    fun put(providerId: String, credentials: Map<String, String>)
    fun delete(providerId: String)
}

data class LocalModelDescriptor(
    val id: String,
    val name: String,
    val sizeBytes: Long,
    val minimumMemoryBytes: Long,
    val installed: Boolean
) {
    init {
        require(id.isNotBlank() && name.isNotBlank()) { "A model needs an identifier and display name." }
        require(sizeBytes >= 0 && minimumMemoryBytes >= 0) { "Model resource requirements cannot be negative." }
    }
}

data class LocalModelResourceStatus(
    val canLoad: Boolean,
    val availableMemoryBytes: Long,
    val availableStorageBytes: Long,
    val reason: String? = null
)

interface LocalModelResourceChecker {
    fun check(model: LocalModelDescriptor): LocalModelResourceStatus
}

class AndroidLocalModelResourceChecker(context: Context) : LocalModelResourceChecker {
    private val applicationContext = context.applicationContext

    override fun check(model: LocalModelDescriptor): LocalModelResourceStatus {
        val activityManager = applicationContext.getSystemService(ActivityManager::class.java)
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        val availableStorageBytes = StatFs(applicationContext.filesDir.absolutePath).availableBytes
        val enoughMemory = memoryInfo.availMem >= model.minimumMemoryBytes
        val enoughStorage = availableStorageBytes >= model.sizeBytes
        val reason = when {
            !model.installed -> "Install or import the model before loading it."
            !enoughMemory -> "Not enough available memory to load this model."
            !enoughStorage -> "Not enough free device storage for this model."
            else -> null
        }
        return LocalModelResourceStatus(
            canLoad = model.installed && enoughMemory && enoughStorage,
            availableMemoryBytes = memoryInfo.availMem,
            availableStorageBytes = availableStorageBytes,
            reason = reason
        )
    }
}

interface LocalInferenceEngine {
    fun isModelCompatible(model: LocalModelDescriptor): Boolean
    fun discoverModels(callback: (Result<List<LocalModelDescriptor>>) -> Unit)
    fun importModel(source: Uri, userInitiated: Boolean, callback: (Result<LocalModelDescriptor>) -> Unit)
    fun downloadModel(
        modelId: String,
        userConfirmed: Boolean,
        onProgress: (Long, Long) -> Unit,
        callback: (Result<LocalModelDescriptor>) -> Unit
    )
    fun selectModel(modelId: String, callback: (Result<Unit>) -> Unit)
    fun loadModel(modelId: String, callback: (Result<Unit>) -> Unit)
    fun unloadModel(callback: (Result<Unit>) -> Unit)
    fun infer(prompt: String, callback: (Result<String>) -> Unit)
}

class LocalModelManager(
    private val engine: LocalInferenceEngine,
    private val resources: LocalModelResourceChecker
) {
    private var knownModels: Map<String, LocalModelDescriptor> = emptyMap()
    private var selectedModelId: String? = null
    private var loadedModelId: String? = null

    fun discoverModels(callback: (Result<List<LocalModelDescriptor>>) -> Unit) {
        engine.discoverModels { result ->
            result.onSuccess { discovered ->
                knownModels = discovered.associateBy { it.id }
            }
            callback(result)
        }
    }

    fun importModel(source: Uri, userInitiated: Boolean, callback: (Result<LocalModelDescriptor>) -> Unit) {
        if (!userInitiated) {
            callback(Result.failure(IllegalStateException("Choose and import a model explicitly before using device storage.")))
            return
        }
        engine.importModel(source, userInitiated = true) { result ->
            result.onSuccess { model -> knownModels = knownModels + (model.id to model) }
            callback(result)
        }
    }

    fun downloadModel(
        modelId: String,
        userConfirmed: Boolean,
        onProgress: (Long, Long) -> Unit,
        callback: (Result<LocalModelDescriptor>) -> Unit
    ) {
        if (!userConfirmed) {
            callback(Result.failure(IllegalStateException("Confirm the model download before using network or device storage.")))
            return
        }
        val model = knownModels[modelId]
        if (model == null) {
            callback(Result.failure(IllegalArgumentException("Discover the model before requesting its download.")))
            return
        }
        if (resources.check(model).availableStorageBytes < model.sizeBytes) {
            callback(Result.failure(IllegalStateException("Not enough free device storage for this model download.")))
            return
        }
        engine.downloadModel(modelId, userConfirmed = true, onProgress = onProgress) { result ->
            result.onSuccess { model -> knownModels = knownModels + (model.id to model) }
            callback(result)
        }
    }

    fun selectModel(modelId: String, callback: (Result<Unit>) -> Unit) {
        if (knownModels[modelId]?.installed != true) {
            callback(Result.failure(IllegalArgumentException("Select an installed local model.")))
            return
        }
        engine.selectModel(modelId) { result ->
            result.onSuccess { selectedModelId = modelId }
            callback(result)
        }
    }

    fun loadSelectedModel(callback: (Result<Unit>) -> Unit) {
        val modelId = selectedModelId
        val model = modelId?.let(knownModels::get)
        if (model == null) {
            callback(Result.failure(IllegalStateException("Discover and select an installed local model first.")))
            return
        }
        if (!engine.isModelCompatible(model)) {
            callback(Result.failure(IllegalStateException("This model is not compatible with the device's available inference capabilities.")))
            return
        }
        val status = resources.check(model)
        if (!status.canLoad) {
            callback(Result.failure(IllegalStateException(status.reason ?: "Device resources are insufficient to load this model.")))
            return
        }
        engine.loadModel(model.id) { result ->
            result.onSuccess { loadedModelId = model.id }
            callback(result)
        }
    }

    fun unloadModel(callback: (Result<Unit>) -> Unit) {
        if (loadedModelId == null) {
            callback(Result.success(Unit))
            return
        }
        engine.unloadModel { result ->
            result.onSuccess { loadedModelId = null }
            callback(result)
        }
    }

    fun infer(prompt: String, callback: (Result<String>) -> Unit) {
        if (loadedModelId == null || selectedModelId != loadedModelId) {
            callback(Result.failure(IllegalStateException("Load a selected local model before inference.")))
            return
        }
        if (prompt.isBlank()) {
            callback(Result.failure(IllegalArgumentException("Enter a prompt for local inference.")))
            return
        }
        engine.infer(prompt, callback)
    }
}

interface LocalSpeechToTextEngine {
    val isAvailable: Boolean
    fun transcribe(audio: ByteArray, callback: (Result<String>) -> Unit)
}

interface LocalTextToSpeechEngine {
    val isAvailable: Boolean
    fun speak(text: String, callback: (Result<Unit>) -> Unit)
    fun stop()
}

interface WakeWordEngine {
    val isAvailable: Boolean
    val supportsSensitivity: Boolean
    fun start(phrase: String, sensitivity: Float?, onDetected: (String) -> Unit, callback: (Result<Unit>) -> Unit)
    fun stop(callback: (Result<Unit>) -> Unit)
}

interface ForegroundServiceManager {
    fun startAfterUserOptIn(configuration: ForegroundVoiceSessionConfiguration)
    fun stop()
}

data class ForegroundVoiceSessionConfiguration(
    val explicitUserOptIn: Boolean,
    val wakePhrase: String,
    val batteryAware: Boolean = true,
    val persistentNotificationRequired: Boolean = true,
    val saveRawAudio: Boolean = false,
    val uploadRawAudio: Boolean = false
) {
    init {
        require(explicitUserOptIn) { "Foreground microphone use requires explicit user opt-in." }
        require(wakePhrase.isNotBlank()) { "A wake phrase is required." }
        require(!saveRawAudio && !uploadRawAudio) { "Raw voice audio storage and upload are disabled by default." }
    }
}

interface WebToNativeBridge {
    fun onCommand(
        trustedOrigin: String,
        command: String,
        arguments: Map<String, String>,
        callback: (NativeActionResult) -> Unit
    )
}

class TrustedWebCommandBridge(
    private val capabilityManager: CapabilityManager,
    private val registry: CapabilityRegistry
) : WebToNativeBridge {
    override fun onCommand(
        trustedOrigin: String,
        command: String,
        arguments: Map<String, String>,
        callback: (NativeActionResult) -> Unit
    ) {
        if (trustedOrigin != TRUSTED_ORIGIN) {
            callback(NativeActionResult.Failure("Commands are accepted only from the bundled ZeroGravity app origin."))
            return
        }
        val actionType = runCatching { NativeActionType.valueOf(command) }.getOrNull()
        if (actionType == null) {
            callback(NativeActionResult.Failure("Unknown native action."))
            return
        }
        val descriptor = registry.get(actionType.capability)
        if (!descriptor.available) {
            callback(NativeActionResult.Unsupported(actionType.capability))
            return
        }
        capabilityManager.invoke(
            NativeAction(
                id = arguments["id"] ?: command,
                type = actionType,
                arguments = arguments,
                confirmedByUser = false
            ),
            callback
        )
    }

    companion object {
        const val TRUSTED_ORIGIN = "https://appassets.androidplatform.net"
    }
}

class NativeErrorHandler(private val report: (String) -> Unit) {
    fun report(error: Throwable, context: String) {
        this.report.invoke("$context: ${error.message ?: error::class.java.simpleName}")
    }
}
