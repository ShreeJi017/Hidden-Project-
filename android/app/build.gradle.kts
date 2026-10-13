import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.api.tasks.Sync

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.zerogravity.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zerogravity.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/zerogravityAssets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}

val bundleZeroGravityWebApp by tasks.registering(Sync::class) {
    val webRoot = rootProject.projectDir.parentFile
    from(webRoot) {
        include(
            "index.html",
            "app.js",
            "ai-provider.js",
            "voice-services.js",
            "voice-settings.js",
            "offline-services.js",
            "memory-services.js",
            "memory-ui.js",
            "phone-actions.js",
            "image-generation.js",
            "image-generation-ui.js",
            "live-data.js",
            "live-data-ui.js",
            "styles.css"
        )
        into("zerogravity")
    }
    into(layout.buildDirectory.dir("generated/zerogravityAssets"))
}

tasks.configureEach {
    if (name == "preBuild") dependsOn(bundleZeroGravityWebApp)
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
