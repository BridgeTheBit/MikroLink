plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val mikrolinkVersion = providers.gradleProperty("mikrolinkVersion").orElse("0.1.0").get()
val mikrolinkVersionCode = providers.gradleProperty("mikrolinkVersionCode").orElse("1").get().toInt()
val targetAbi = providers.gradleProperty("targetAbi").orNull
val supportedAbis = setOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
require(targetAbi == null || targetAbi in supportedAbis) { "Unsupported targetAbi: $targetAbi" }

val releaseKeystorePath = System.getenv("MIKROLINK_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("MIKROLINK_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("MIKROLINK_KEY_ALIAS")
val releaseKeyPassword = System.getenv("MIKROLINK_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.mikrolink.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mikrolink.app"
        minSdk = 26
        targetSdk = 35
        versionCode = mikrolinkVersionCode
        versionName = mikrolinkVersion
        targetAbi?.let { abi -> ndk { abiFilters += abi } }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(releaseKeystorePath))
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":strongswan"))
    implementation("com.wireguard.android:tunnel:1.0.20260102")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.3")
}
