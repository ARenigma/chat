/**
 * Firebase Auth carries AsyncStorage as an optional React Native persistence
 * peer. Pappal supplies its own MMKV adapter and never imports AsyncStorage, so
 * linking that native project only adds an incompatible KSP plugin to Android.
 *
 * React Native CLI's documented project-level opt-out:
 * https://github.com/react-native-community/cli/blob/main/docs/autolinking.md
 */
module.exports = {
  dependencies: {
    '@react-native-async-storage/async-storage': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
