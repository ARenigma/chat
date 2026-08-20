/**
 * No-op stand-in for the native RNG polyfill.
 *
 * The real package is a native module and cannot load under Jest. It exists to
 * install `crypto.getRandomValues` in Hermes; Node has provided that natively
 * since 19, so under test the global is already correct and there is nothing to
 * install. Mocking it keeps `webcrypto.ts` importable in tests without pretending
 * to supply randomness of its own.
 */
module.exports = {};
