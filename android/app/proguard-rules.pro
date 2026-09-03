# R8 rules for the release build.
#
# App and Google SDK classes are intentionally not retained package-wide. Pappal
# registers its ReactPackage classes directly, while React Native, Firebase, Play
# Services, Credential Manager, Hermes, Reanimated, Worklets and Sentry ship the
# consumer rules for their own indirect entry points. Android's guidance is to
# keep rules at the reflection/JNI boundary, not around entire dependency trees.
# https://developer.android.com/topic/performance/app-optimization/keep-rules-best-practices

# Keep line numbers so a minified stack trace can still be symbolicated in
# Sentry, but drop the source file name from the binary.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# react-native-webrtc / libjingle_peerconnection: the Java bindings are called
# from native and via reflection (observers, SDP callbacks), so R8 cannot see the
# references and would strip them. WebRTC ships no consumer rules of its own.
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }

# react-native-mmkv v4 and react-native-nitro-modules ship no consumer rules;
# MMKV's HybridObject subclasses are otherwise kept only transitively via
# nitro-sound's global rule, which breaks the day nitro-sound is removed. Keep
# the Nitro core surface explicitly.
-keep class com.margelo.nitro.core.** { *; }
-keep class * extends com.margelo.nitro.core.HybridObject { *; }
-dontwarn com.margelo.nitro.**

# Cashfree Verification Suite (1-Click Onboarding) SDK + its PG base dependency.
# The AAR ships no consumer ProGuard rules, so R8 would strip the SDK surface and
# the WebView JS-bridge classes the native module bridges to (CFVerificationService,
# CF1ClickOnboardingCallback, the models). Keep the whole com.cashfree tree.
-keep class com.cashfree.** { *; }
-keepclassmembers class com.cashfree.** { *; }
-dontwarn com.cashfree.**
