# ZeroGravity

ZeroGravity is a lightweight, mobile-first browser app with an Android WebView wrapper, responsive Home/Chat/Explore/Memory/Settings destinations, accessible controls, and an animated particle orb. Chat and image generation connect to user-configured API providers.

## Run

Serve the project over HTTP (for example, `python3 -m http.server 8000`) and open it in a modern browser. The Google Fonts connection is optional; system fallbacks are included. The configured provider must permit browser requests from the app origin with CORS.

## Module 7: Own API

Settings → **Own API** shows separate provider cards for Chat AI, reasoning, voice, STT, TTS, image/video generation, Internet Search, weather, browsing, vision, OCR, translation, embeddings, coding, audio/music, and custom APIs. Each function has its own provider list, enabled/default/backup routing, and priority. Use **Add configuration** or **Edit configuration** to manage providers; deleting a saved configuration asks for confirmation.

Implemented adapters are **OpenAI-compatible Chat Completions** for Chat AI, and the OpenAI Images and configurable JSON image adapters documented in Module 10. Image-provider tests perform a real image generation request that may use provider quota; the test image is not saved. Chat requests use the configured default provider and try a configured backup only if the primary request fails. **Custom HTTP** on other functions supports a configurable GET/POST connectivity check only; it does not implement STT, TTS, video generation, search, or those functions' request/response protocols. Other function-specific adapters are not implemented. Provider CORS policy applies to browser requests.

**Development-only security warning:** This project has no secure backend proxy. API keys, custom header values, custom static request bodies, and arbitrary optional request settings are held in page memory only—not browser storage—and are lost when the page reloads. They may still be exposed to scripts, extensions, browser tooling, or someone with access to the active session. Provider endpoint/model and allow-listed non-secret image/search/weather field mappings are saved locally. Use a trusted backend proxy for production or sensitive credentials. Conversation text remains stored locally in the browser. The Android project defines an `EncryptedCredentialStore` contract only; it does not yet implement encrypted API credential storage.

Tests show a real request result, HTTP status where available, latency, and troubleshooting information; the app does not invent successful test results. Provider calls and validation are isolated in `ai-provider.js`.

## Module 8: Offline AI foundation

Settings → **Offline mode** offers **Automatic**, **Online-only**, and **Offline-only** routing. Automatic evaluates supported local tools first, then can use the enabled Chat AI provider when the browser reports a network connection. Online-only routes chat to that provider and does not substitute local tools. Offline-only blocks new chat requests and provider connection tests from reaching online providers; unsupported requests say explicitly that no online request was sent. Switching modes does not recall a request that was already in progress. The network indicator reflects `navigator.onLine`, not verified Internet reachability.

The current browser build genuinely handles simple arithmetic, local date/time formatting, basic text transformations/counting, local searches of saved conversation history, and explicit local-memory save/read/clear commands without an AI provider. Automatic and Offline-only modes use those tools. Preferences, conversation history, and the optional memory note remain in browser storage on this device; there is no sync. Local tool exchanges are labelled and excluded from later online prompt context. Settings includes separate actions to clear conversation history and local memory.

No on-device inference runtime or model is bundled or installed here. The local-model panel therefore reports no inference engine, does not invent model availability, and never loads or downloads a model. `offline-services.js` defines a browser/native engine boundary for discovery, selection, resource-checked loading, inference, import, unload, and user-confirmed downloads. The Kotlin Android contracts add model discovery/import/download/select/load/unload/inference and a resource checker that inspects available RAM and app storage before loading. They remain interfaces only: the Android app has no inference engine or APK built. No background inference or offline voice recognition is claimed. Browser speech recognition and speech synthesis remain dependent on the browser/OS and are not guaranteed offline; wake-word detection, local STT, and local TTS engines are not active.

Searching local conversation history does not index arbitrary files. Previously indexed external content and general local AI answers require an actual local index or compatible installed model/runtime, neither of which is included. Automatic mode does not silently invent a response when neither a local tool/model nor the configured online provider is available. The Own API UI continues to warn that direct-browser credentials are development-only.

## Module 4 voice

Tap **Start voice input** on Home or Chat (or in Settings → Voice) to request microphone permission. Supported browsers use their native speech-recognition API; recognized words appear in the editable chat composer and are not sent until you press **Send**. Recognition is browser-managed and may be processed by the browser vendor. This app does not save audio recordings or forward them to the configured AI provider. Tap **Stop voice** or **Stop listening** to end recognition and release permission-probe microphone tracks.

Enable **spoken replies** in Settings → Voice to have assistant responses read aloud. Choose an available device voice, preview English/Hindi/Hinglish sample phrases, adjust playback rate (0.5×–2×), and reset voice preferences there. Clear chat instructions such as “switch to a male voice,” “thoda dheere bolo,” and “return to normal speed” are handled locally before AI routing; mixed requests containing another question remain ordinary chat. Gender matching only uses explicit `male`/`female` labels in the device voice name or URI, and otherwise reports the available device voices rather than guessing. Speech can be stopped from Chat or Settings, and starting voice input interrupts playback. Browser APIs and installed voices vary; use HTTPS (or localhost) and test the target Android browser/device. These are not bundled neural voices, Hindi/Hinglish pronunciation and offline availability are not guaranteed, and automatic voice-activity or background-speech interruption is not implemented.

## Module 5 wake-word foundation

Settings → Voice → Wake Word stores an enable preference and configurable phrase, shows the listening mode and browser microphone permission status, and provides explicit start/stop controls. In this browser build there is **no wake-word detector**: ordinary Web Speech recognition is not treated as a reliable or offline wake-word engine. Starting the unavailable feature explains the limitation without requesting microphone permission. Push-to-talk remains available as the voice-input fallback. No audio is recorded, saved, or uploaded for wake-word listening.

The voice service exposes a `ZeroGravityNativeWakeWord` integration boundary with `isAvailable`, `start({ phrase, sensitivity, onWakeWord, onState, onError })`, `stop`, optional `getCapabilities` (including `sensitivity` and `batteryAware`), and optional `getPermissionStatus` methods. A future Android implementation must provide local detection, configurable phrase, permission-aware foreground microphone lifecycle, battery-aware operation, UI start/stop communication, and obey Android's microphone indicator and background restrictions. No native Android service is included; wake listening does not continue after the browser tab closes. Detection alone never starts full-conversation recording: the user must explicitly start voice input.

## Module 1

- Home, Chat, Explore, Memory, and Settings as the primary destinations, with existing tools and secondary screens kept reachable
- Canvas-rendered particle sphere with a reduced-motion setting
- Adjustable orb brightness, persisted locally
- Responsive layout with safe-area spacing

Native wake-word listening, always-listening background services, and general phone automation are not included beyond the explicitly implemented Phone Actions.

## Module 6 Android foundation

The existing `index.html`/JavaScript/CSS application remains the browser app. The Kotlin Android app now bundles the web UI in a local WebView and exposes a narrowly scoped JavaScript phone-action bridge restricted to its trusted bundled asset origin. Implemented native handlers use Android intents/APIs for installed-app launch, Settings, alarm/timer drafts, explicitly confirmed calls, SMS drafts, calendar event drafts, active notification reading, notification-access Settings, and media-session controls. This bridge does not add a wake-word engine, foreground listening service, or local inference runtime.

Permission requests occur only after an invoked action requires one. Calls display a native confirmation before Android can request `CALL_PHONE`; notification reading requires the user to separately enable notification-listener access in Android Settings. SMS only opens a prefilled draft, and calendar/alarm/timer actions open drafts in other Android apps; ZeroGravity does not send messages or silently save calendar entries. Contact-name lookup, direct calendar database access, location, Bluetooth, and other unimplemented actions remain unavailable. Media commands require notification access and an active compatible media session; Android dispatch is not a guarantee that the media app changed playback.

### Android build prerequisites

- Android Studio or Android SDK command-line tools with Android SDK Platform 36 and a compatible Android Build Tools installation.
- JDK 17 (the GitHub Actions build uses Temurin 17).
- Access to Google's Maven repository, Maven Central, and the Gradle distribution service on the first build.
- An Android device/emulator for installation and runtime validation.

The existing Kotlin app is the Android wrapper; its application ID is `com.zerogravity.android`, display name is **ZeroGravity**, and version is `0.1.0` (version code 1). Android SDK Platform 36, Build Tools 36.0.0, JDK 17, and Gradle 8.13 are configured. Its launcher uses a pure-black background and centered white **Zero** word, with density-specific PNGs for legacy launchers and an adaptive icon for Android 8.0 and newer. The system launch window uses the same black background.

From the repository root, open `android/` in Android Studio and sync Gradle, or build with the included wrapper:

```sh
cd android
./gradlew :app:assembleDebug
```

Install a successfully built debug APK on a connected device with:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Android build packages the existing HTML, JavaScript, and CSS locally for offline screen loading; remote APIs still need network access. The WebView keeps arbitrary file/content access disabled, restricts its JavaScript bridges and system file picker to the trusted bundled origin, and returns user-selected document URIs only to the active file input. The Android system document picker supports local file inspection and JSON memory import without broad storage permissions. External HTTP(S) links open in an installed browser, and Back navigation returns through previously visited app screens. The manifest requests only Internet, microphone, phone-call, and location permissions used by existing features; sensitive permissions are requested at runtime only when invoked. Approximate location is sufficient when the user declines precise access. Notifications use Android's separately user-approved notification-listener access.

GitHub Actions builds the debug APK on pushes, pull requests, and manual runs using Java 17 and Android SDK 36. To download it, open the successful **Android debug APK** run under the repository's **Actions** tab and download the `zerogravity-debug-apk` artifact (retained for 14 days). The workflow is [`.github/workflows/android-apk.yml`](./.github/workflows/android-apk.yml); it needs no signing or provider secrets. A debug artifact is not a Play Store release APK.

The local Codespace currently has Java 25 and no configured Android SDK, so an Android APK has not been built or verified here. Actual device installation, runtime permission prompts, voice/geolocation behavior, and native phone/image actions still require testing on Android. No native offline model, wake-word service, encrypted memory store, or encrypted credential storage is implemented.

On first use, test on a real Android device. Calls require granting the runtime call permission after confirmation; notification reading/media control require granting notification access in Android Settings. The browser version reports phone actions as unsupported and never claims to control the device. Intent-launched drafts still require user review in the target Android app. App/device behavior, permission flows, media sessions, and notification access require Android runtime testing.

## Module 9: Android phone actions

The Phone Actions settings panel lists available actions and permission requirements, tests commands, and keeps a page-session-only history containing action names and result statuses (not message bodies or phone numbers). Supported text commands can also be submitted through chat or speech recognition; recognized phone actions are intercepted before AI/offline routing. The web browser has no device-control path and explicitly reports these actions as unsupported.

In the Android app, each consequential action presents a native confirmation. Calls use Android's direct call intent only after confirmation and runtime permission. SMS commands open a prefilled composer but never send. Calendar, alarm, and timer commands open user-reviewable drafts. Notification text is read only when the user invokes it and has granted Android notification-listener access; enabling that access requires a second explicit confirmation and the system Settings approval. Media commands are dispatched only to a compatible active session and may require that same access. Contact-name lookup is not implemented. No action runs silently in the background, and command history is not persisted by the Phone Actions panel.

## Module 10: ZeroGravity Image Studio

Open Modules → **Image Generator** or **Image Gallery**. Image Generation uses the existing Own API provider list, default-provider routing, session-only credentials, endpoint/model fields, and provider dashboard. It does not fall back to Chat AI or simulate an image. Offline-only mode blocks image requests.

Two image adapters are implemented:

- **OpenAI Images API** sends a JSON `POST` using `model`, `prompt`, and `size`. The aspect-ratio selector maps to `1024x1024`, `1024x1792`, `1792x1024`, and `1024x768`. Model/account support differs; provider HTTP errors are shown rather than treated as generated output. Bearer authentication is the default.
- **Custom image JSON API** sends JSON to the configured endpoint. Use Own API → Image Generation → Optional request settings to map prompt/model/negative-prompt/aspect/quality/style fields, aspect values, auth (`bearer`, custom `header`, or `none`), and response URL/base64 paths. For example:

  ```json
  {
    "timeoutMs": 60000,
    "imageGeneration": {
      "promptField": "input.prompt",
      "modelField": "model_id",
      "negativePromptField": "input.negative",
      "aspectRatioField": "image.ratio",
      "aspectRatioValues": { "1:1": "square", "9:16": "portrait", "16:9": "landscape", "4:3": "classic" },
      "qualityField": "image.quality",
      "styleField": "image.style",
      "authentication": { "mode": "header", "headerName": "X-API-Key" },
      "response": { "urlPath": "result.url", "base64Path": "result.base64", "mimeType": "image/png" }
    }
  }
  ```

Leave unsupported option fields unset; the screen disables those controls. Provider protocols and model limits vary. The browser request must pass the provider's CORS policy. The API key is required again after reload and is never saved. Safe image option mappings/auth mode and response paths are saved with provider metadata; custom static bodies, headers, and authentication prefixes stay in page memory. The Own API screen warns that direct browser credentials are not secure; use a trusted backend proxy for production. **No API key or provider account is bundled**; configure an endpoint, model, and key or explicitly select unauthenticated access where your provider allows it.

The gallery saves prompt/provider/model/date/aspect metadata in the existing browser storage and stores returned base64 image files as `Blob`s in IndexedDB, never base64 in localStorage. Provider-returned image URLs are kept as links only; they are marked as potentially temporary and may expire or become inaccessible. Downloading those URLs requires provider CORS access. Browser download/share behavior depends on the browser and device and cannot silently write to arbitrary folders.

In the native Android app, **Save to device** uses Android MediaStore to save supported PNG/JPEG/WebP/GIF images to `Pictures/ZeroGravity` on Android 10 or newer (maximum 20 MB); this scoped API does not request broad storage permission. Older Android versions report the native save as unsupported. Test the native flow on a device. Image generation progress is indeterminate because these adapters do not expose provider progress.

## Module 11: Live Internet, Search & Weather

Modules → **Search & Wikipedia** and **Weather & Local time** open the live-data screens. Search-result titles, summaries, sources, URLs, and dates are displayed only when returned by the provider; URLs are checked for HTTP(S), and chat answers include clickable source citations. Wikipedia uses its public MediaWiki search API and is labelled separately from general web search. The chat/voice input recognizes explicit current-search and Wikipedia requests plus English and common Hindi/transliterated weather questions; ordinary chat still uses the existing router. Local date/time is read from the device/runtime and is not a calendar integration.

In Settings → **Own API** → **Internet Search**, choose **Brave Search API** (endpoint `https://api.search.brave.com/res/v1/web/search`, subscription key required) or **Custom search JSON API**. The custom adapter supports GET/POST and maps fields under `requestSettings.search`; for example:

```json
{
  "timeoutMs": 30000,
  "search": {
    "method": "GET",
    "queryField": "q",
    "resultsPath": "results",
    "titlePath": "title",
    "summaryPath": "description",
    "urlPath": "url",
    "sourcePath": "source",
    "publishedAtPath": "publishedAt",
    "authentication": { "mode": "bearer" }
  }
}
```

Under **Weather**, **Open-Meteo** uses its public forecast and geocoding APIs and does not require a key. Configure endpoint `https://api.open-meteo.com/v1/forecast`; model is not required. Manual city lookup uses Open-Meteo's public geocoding endpoint even when a custom forecast provider is selected. **Custom weather JSON API** supports GET/POST, configurable coordinate/unit parameter names, optional bearer/header/no-auth modes, and field paths under `requestSettings.weather.response`. The response mapping supports current temperature/feels-like/condition/humidity/wind/precipitation, provider update time, hourly/daily arrays and their fields, sunrise/sunset, and provider-supplied alerts. Set `units` to `celsius` or `fahrenheit` for custom response temperature values. Connection tests make a real search/forecast request; a search test can consume provider quota.

Example custom forecast settings (adapt the paths and units to the provider's actual JSON response):

```json
{
  "timeoutMs": 30000,
  "weather": {
    "method": "GET",
    "latitudeField": "latitude",
    "longitudeField": "longitude",
    "unitsField": "units",
    "windSpeedUnit": "km/h",
    "precipitationUnit": "mm",
    "response": {
      "current": "current",
      "updatedAt": "updated_at",
      "timezone": "timezone",
      "temperaturePath": "temp_c",
      "feelsLikePath": "feels_like_c",
      "conditionPath": "condition",
      "humidityPath": "humidity",
      "windSpeedPath": "wind_kmh",
      "precipitationPath": "precip_mm",
      "daily": "daily",
      "dailyDatePath": "date",
      "highPath": "high_c",
      "lowPath": "low_c",
      "dailyPrecipitationChancePath": "rain_chance",
      "sunrisePath": "sunrise",
      "sunsetPath": "sunset",
      "units": "celsius"
    }
  }
}
```

Provider endpoint/model and allow-listed non-secret search/weather mappings persist in browser storage. Keys and custom headers remain in page memory and must be entered again after reload. Direct browser providers must allow the app origin through CORS; no API credential is bundled. Wikipedia and Open-Meteo do not require user API keys. A backend proxy is preferred for production credentials.

Weather starts in Celsius and can be changed to Fahrenheit. Selecting **Use my location** first explains why coordinates are needed and asks for confirmation; browser/device permission is then requested. Coordinates are sent to the configured weather provider. If access is denied or unsupported, enter a city manually. No calendar events are invented or read. Open-Meteo provides forecasts and sunrise/sunset but not alerts; alerts appear only if a configured custom provider supplies them.

Search/Wikipedia/weather obey Automatic, Online-only, and Offline-only settings. Offline-only makes no live search, Wikipedia, geocoding, or weather calls; exact previous results can be shown with cached/original retrieval timestamps and are not described as current. Automatic may fall back to a saved result when a provider is unavailable. Browser storage holds a small bounded cache of provider metadata/results, not weather images or large files. Online-only requires a working connection/provider and does not use cached results.

## Module 12: Memory, Personalization, and Calm Mode

Modules → **Memory & Personalization** manages user-approved memories, response language/length, personalization, Calm Mode, and online-sharing controls. Chat recognizes **“Remember this: …”**, **“Forget: …”**, **“What do you remember about me?”**, and **“Forget everything you remember about me.”** Private mode in Chat prevents memory lookup, memory saves, and personalization for that conversation; chat messages themselves remain in the existing browser conversation history. The older Module 8 “remember that …” / local-memory note commands remain available separately for compatibility.

The structured memory store is versioned and bounded, with categories, timestamps, optional expiry, duplicate detection, and replacement of conflicting language/style/length preferences. Secrets such as passwords, API keys, and tokens are rejected. Heuristic checks flag some sensitive information for confirmation but cannot detect every sensitive detail. JSON import validates schema, size, record limits, timestamps, categories, secrets, and duplicates; importing replaces existing memories and resets online-sharing approvals to off. User-provided content is inserted with text APIs rather than HTML.

The memory manager is enabled by default so users can review and manage stored data; personalization and online sharing are off by default. Personalization must be enabled, global online sharing explicitly enabled, and each memory separately marked eligible before a saved memory is added to an online Chat AI request. Private and Offline-only requests never include saved memories in online requests. In Automatic mode the currently enabled/selected preferences can be available to a connected local model; no local language model is bundled by this project. Online providers receive ordinary conversation messages when selected by the existing routing mode. Calm Mode is an explicit style preference, gently slows supported speech output, and does not diagnose emotions. “Make this simpler” and “One step at a time” ask the current assistant to reformulate its previous response.

Memory, response settings, and the legacy local note are stored in browser storage on this device. Browser storage is not encrypted and may be accessible to scripts running on the site, browser extensions, and people with access to the browser profile. No authenticated backend exists, so no backend adapter is active. Android assets include the web memory UI and its adapter boundary, but the Android project does not yet implement encrypted native memory storage. Exported JSON is a user-accessible plain-text file; protect or delete it appropriately. Use a trusted backend proxy for online providers and do not save credentials in memory.

## Validation

Run `npm test` to execute Android app configuration/asset/workflow checks, command parser/bridge, image-generation/gallery, live-data, and memory-store tests plus browser checks for navigation/back history, mobile canvas rendering, provider configuration, mock search/Wikipedia/weather routing, citations, location denial/manual city selection, units, cached/offline behavior, chat and image responses, retries, gallery persistence/deletion, memory consent/import/export/CRUD, disabled and private memory behavior, opt-in online sharing, Offline-only network blocking, 320px layout, locally restored conversation history, mocked browser speech-recognition/synthesis, and wake-word interfaces. These are mocked provider responses; they do not establish real provider account/CORS access or live weather/search success. Android source compilation and actual image saving/action behavior require the SDK and device prerequisites above; browser mocks do not establish Android runtime success.
