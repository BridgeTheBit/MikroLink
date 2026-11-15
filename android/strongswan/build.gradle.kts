plugins {
    id("com.android.library")
}

val strongSwanApp = rootProject.projectDir.parentFile.resolve(
    "native/vendor/strongswan/src/frontends/android/app"
)
val targetAbi = providers.gradleProperty("targetAbi").orNull
val skipNativeBuild = providers.gradleProperty("skipStrongSwanNative").orNull == "true"
val supportedAbis = setOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
require(targetAbi == null || targetAbi in supportedAbis) { "Unsupported targetAbi: $targetAbi" }

if (!strongSwanApp.resolve("src/main/jni/Android.mk").isFile) {
    throw GradleException(
        "strongSwan sources are missing. Run scripts/prepare-strongswan.sh before Gradle."
    )
}

android {
    namespace = "org.strongswan.android"
    compileSdk = 35
    ndkVersion = "27.3.13750724"

    defaultConfig {
        minSdk = 26

        ndk {
            abiFilters += targetAbi?.let(::setOf) ?: supportedAbis
        }

        if (!skipNativeBuild) {
            externalNativeBuild {
                ndkBuild {
                    arguments += "-j${Runtime.getRuntime().availableProcessors()}"
                }
            }
        }
    }

    sourceSets.getByName("main") {
        java.srcDir(strongSwanApp.resolve("src/main/java"))
        res.srcDir(strongSwanApp.resolve("src/main/res"))
        manifest.srcFile("src/main/AndroidManifest.xml")
    }

    if (!skipNativeBuild) {
        externalNativeBuild {
            ndkBuild {
                path = strongSwanApp.resolve("src/main/jni/Android.mk")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.preference:preference:1.2.1")
    implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
}
