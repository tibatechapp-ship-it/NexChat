plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// FCM: تُطبَّق إضافة Google Services شرطياً عند وجود google-services.json —
// بهذا يبقى البناء يعمل في بيئة التطوير بلا ملف Firebase، وبمجرد وضع
// الملف في مكانه تُنشَّط الإعدادات تلقائياً (docs/PUSH-SETUP.md).
// بلوك plugins في Kotlin DSL لا يتيح استدعاء file() (Unresolved reference:
// اكتشفه بناء AAB الأول) — التطبيق الشرطي هنا هو النمط الصحيح لأن
// الإضافة معلنة في settings.gradle.kts بـ apply false.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.rasan.rasan_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications يتطلب Java 8+ API desugaring —
        // اكتشفه بناء AAB (checkReleaseAarMetadata).
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.rasan.rasan_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // firebase_core 3.x يتطلب minSdk ≥ 23 (Firebase Android SDK requirements).
        minSdk = maxOf(23, flutter.minSdkVersion)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // يلزم مع isCoreLibraryDesugaringEnabled — أعلى إصدار مطلوب بواسطة
    // flutter_local_notifications (java.time وغيرها على minSdk 23).
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
