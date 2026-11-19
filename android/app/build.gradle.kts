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
        versionCode = 2
        versionName = "1.1.0"
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
