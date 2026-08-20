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
