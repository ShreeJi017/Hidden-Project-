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
  assert.match(workflow, /java-version:\s*'17'/);
  assert.match(workflow, /:app:assembleDebug/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});
