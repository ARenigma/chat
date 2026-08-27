# R8 rules for the release build.
#
# React Native, Hermes, Reanimated, Worklets, Sentry and AsyncStorage all ship
# consumer ProGuard rules inside their AARs, so nothing needs restating here.
# The two rules below cover the app's own surface.

# Reflection entry points for the New Architecture's module/component registry.
-keep class com.companionchat.** { *; }

# Keep line numbers so a minified stack trace can still be symbolicated in
# Sentry, but drop the source file name from the binary.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# JNI: any class with native methods must not be renamed, or the native symbol
# lookup fails at runtime. Broad on purpose — this is the one rule whose absence
# is a silent crash.
-keepclasseswithmembernames class * {
    native <methods>;
}

# react-native-webrtc / libjingle_peerconnection: the Java bindings are called
# from native and via reflection (observers, SDP callbacks), so R8 cannot see the
# references and would strip them. WebRTC ships no consumer rules of its own.
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-dontwarn org.webrtc.**

# Firebase / Play Services (messaging): reflection-heavy; keep and silence.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
