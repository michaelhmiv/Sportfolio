# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve line numbers in crash stack traces while overwriting source file
# names to the constant "SourceFile".
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Capacitor bridge ──────────────────────────────────────────────────────────
# R8/ProGuard cannot statically trace which plugin methods are called from JS.
# Keep all Capacitor bridge, plugin, and WebView interface classes intact.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Custom Sportfolio Capacitor plugins (Java side)
-keep class sportfolio.market.AndroidRewardedAdsPlugin { *; }
-keep class sportfolio.market.AndroidPlayBillingPlugin { *; }

# ── WebView JavaScript interface ──────────────────────────────────────────────
# Any class that is accessed from JS via @JavascriptInterface must not be
# renamed or removed.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Google Play Billing ───────────────────────────────────────────────────────
-keep class com.android.billingclient.** { *; }
-dontwarn com.android.billingclient.**

# ── Google Mobile Ads (AdMob) ─────────────────────────────────────────────────
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.ads.** { *; }
-dontwarn com.google.android.gms.ads.**

# ── Firebase / Google Play Services ──────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ── Cordova/Capacitor plugin bridge (capacitor-cordova-android-plugins) ───────
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── Kotlin metadata (required for reflection-based libraries) ─────────────────
-keepattributes RuntimeVisibleAnnotations
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
