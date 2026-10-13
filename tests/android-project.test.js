const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Android application ID, display name, and version are configured', () => {
  const gradle = read('android/app/build.gradle.kts');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(gradle, /applicationId\s*=\s*"com\.zerogravity\.android"/);
  assert.match(gradle, /versionName\s*=\s*"0\.1\.0"/);
  assert.match(gradle, /versionCode\s*=\s*1/);
  assert.match(manifest, /android:label="ZeroGravity"/);
});

test('Android launcher uses black-and-white density icons and an adaptive icon', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const adaptiveIcon = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  const colors = read('android/app/src/main/res/values/colors.xml');
  const styles = read('android/app/src/main/res/values/styles.xml');
  const splashStyles = read('android/app/src/main/res/values-v31/styles.xml');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher"/);
  assert.match(adaptiveIcon, /<background android:drawable="@color\/launcher_background"/);
  assert.match(adaptiveIcon, /<foreground android:drawable="@drawable\/ic_launcher_foreground"/);
  assert.match(colors, /name="launcher_background">#000000</);
  assert.match(styles, /name="ZeroGravityTheme"/);
  assert.match(styles, /android:windowBackground/);
  assert.match(splashStyles, /android:windowSplashScreenBackground">@color\/launcher_background/);

  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192
  })) {
    const iconPath = `android/app/src/main/res/mipmap-${density}/ic_launcher.png`;
    const icon = fs.readFileSync(path.join(root, iconPath));
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${iconPath} must be PNG`);
    assert.equal(icon.readUInt32BE(16), size, `${iconPath} width`);
    assert.equal(icon.readUInt32BE(20), size, `${iconPath} height`);
  }

  const foregroundPath = 'android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png';
  const foreground = fs.readFileSync(path.join(root, foregroundPath));
  assert.equal(foreground.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(foreground.readUInt32BE(16), 432);
  assert.equal(foreground.readUInt32BE(20), 432);
  assert.equal(foreground[25], 6, 'adaptive foreground must retain transparency');
});

test('Android WebView exposes the system file picker only to its bundled app', () => {
  const activity = read('android/app/src/main/java/com/zerogravity/android/MainActivity.kt');
  assert.match(activity, /override fun onShowFileChooser/);
  assert.match(activity, /webView\?\.url\?\.startsWith\(TRUSTED_PAGE_PREFIX\)/);
  assert.match(activity, /fileChooserParams\.createIntent\(\)/);
  assert.match(activity, /WebChromeClient\.FileChooserParams\.parseResult/);
  assert.match(activity, /FILE_CHOOSER_REQUEST_CODE/);
  assert.match(activity, /fileChooserCallback\?\.onReceiveValue\(null\)/);
});

test('Android geolocation remains available when the user grants approximate location only', () => {
  const contracts = read('android/app/src/main/java/com/zerogravity/android/NativeContracts.kt');
  assert.match(contracts, /capability == AndroidCapability\.LOCATION\) grants\.any/);
  assert.match(contracts, /state = if \(hasPermission\(capability\)\) PermissionState\.GRANTED else PermissionState\.DENIED/);
});

test('Android asset bundle includes every web app script and stylesheet', () => {
  const html = read('index.html');
  const gradle = read('android/app/build.gradle.kts');
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.(?:js|css))"[^>]*>/g)]
    .map((match) => match[1])
    .filter((asset) => !asset.startsWith('http'));
  for (const asset of assets) {
    assert.ok(fs.existsSync(path.join(root, asset)), `Missing web asset: ${asset}`);
    assert.ok(gradle.includes(`"${asset}"`), `Android bundle does not include ${asset}`);
  }
  assert.match(gradle, /WebViewAssetLoader|zerogravityAssets/);
});

test('Android manifest keeps only feature-required permissions and no broad storage access', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const requested = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(requested.sort(), [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CALL_PHONE',
    'android.permission.INTERNET',
    'android.permission.RECORD_AUDIO'
  ]);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
});

test('GitHub Actions uses Java 17 and uploads only the successful debug APK', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /java-version:\s*["']17["']/);
  assert.match(workflow, /app:assembleDebug/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});
