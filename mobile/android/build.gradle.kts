allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// توحيد compileSdk لكل المشاريع الفرعية (الإضافات) — بعض الإضافات
// (مثل file_picker) ما زالت تُجمع ضد android-34 بينما
// flutter_plugin_android_lifecycle يشترط ≥36 (checkReleaseAarMetadata
// في بناء AAB). أقل قيمة مقبولة: أكبر شرط بين الإضافات = 36.
subprojects {
    afterEvaluate {
        if (project.plugins.hasPlugin("com.android.library") ||
            project.plugins.hasPlugin("com.android.application")) {
            extensions.configure<com.android.build.gradle.BaseExtension> {
                val current = compileSdkVersion.substringAfter("android-").toIntOrNull() ?: 0
                if (current < 36) {
                    compileSdkVersion = "android-36"
                }
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
