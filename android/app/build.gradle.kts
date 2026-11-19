import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val playerUrl: String = (project.findProperty("playerUrl") as String?) ?: "https://tv.updown.com.br/player/"

android {
    namespace = "br.com.updown.digital"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.updown.digital"
        minSdk = 21          // Android 5.0: cobre TVs e TV boxes antigas
        targetSdk = 34
        versionCode = 3
        versionName = "1.2.0"
        buildConfigField("String", "PLAYER_URL", "\"$playerUrl\"")
    }

    signingConfigs {
        // Chave fixa do projeto: permite atualizar o app nas TVs sem desinstalar.
        // Para usar outra chave, defina UDS_KEYSTORE/UDS_KEYSTORE_PASSWORD/UDS_KEY_ALIAS/UDS_KEY_PASSWORD.
        create("updown") {
            storeFile = file(System.getenv("UDS_KEYSTORE") ?: "../keystore/updown-digital.jks")
            storePassword = System.getenv("UDS_KEYSTORE_PASSWORD") ?: "updown-digital"
            keyAlias = System.getenv("UDS_KEY_ALIAS") ?: "updown-digital"
            keyPassword = System.getenv("UDS_KEY_PASSWORD") ?: "updown-digital"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("updown")
        }
        debug {
            signingConfig = signingConfigs.getByName("updown")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

// Publica o APK para o servidor: frontend/app/updown-digital.apk + version.json
// (as TVs com o app instalado se atualizam sozinhas a partir dele).
//   ./gradlew publishApk
tasks.register("publishApk") {
    dependsOn("assembleRelease")
    doLast {
        val apk = layout.buildDirectory.file("outputs/apk/release/app-release.apk").get().asFile
        val dest = rootProject.file("../frontend/app")
        dest.mkdirs()
        val target = File(dest, "updown-digital.apk")
        apk.copyTo(target, overwrite = true)
        val sha = MessageDigest.getInstance("SHA-256").digest(target.readBytes())
            .joinToString("") { "%02x".format(it) }
        val cfg = android.defaultConfig
        File(dest, "version.json").writeText(
            """{"versionCode": ${cfg.versionCode}, "versionName": "${cfg.versionName}", """ +
                """"url": "/app/updown-digital.apk", "sha256": "$sha"}""" + "\n"
        )
        println("Publicado: ${target} (v${cfg.versionName}, sha256 $sha)")
    }
}
