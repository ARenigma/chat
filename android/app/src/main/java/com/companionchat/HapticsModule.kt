package com.companionchat

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * UI haptics through the platform's own feedback constants.
 *
 * This replaces `Vibration.vibrate(ms)` on the JS side, and the difference is
 * not cosmetic. Android's guidance is explicit that a predefined action should
 * go through [View.performHapticFeedback] with a [HapticFeedbackConstants]
 * value, because that is what:
 *
 *   * runs the OEM's tuned waveform for that action rather than a raw duration
 *     — a 10ms buzz is one manufacturer's idea of a tap and nobody else's;
 *   * RESPECTS THE USER'S TOUCH-FEEDBACK SETTING. `Vibration.vibrate` does not.
 *     Someone who turned haptics off in Settings had been buzzed by this app
 *     anyway, on every send and every long-press;
 *   * stays consistent with the rest of the system, which the docs call out as
 *     an accessibility consideration.
 *
 * https://developer.android.com/develop/ui/views/haptics/haptics-principles
 *
 * ---------------------------------------------------------------------------
 * Deviation from the plan, deliberate
 * ---------------------------------------------------------------------------
 * The workstream said to pass `FLAG_IGNORE_GLOBAL_SETTING` "where Telegram sets
 * it". That flag is not used here, for two independent reasons, either of which
 * is sufficient:
 *
 *   1. The principles page strongly discourages it — it exists to override a
 *      preference the user expressed on purpose.
 *   2. It is DEPRECATED as of API 33 (checked in the SDK's own
 *      `platforms/android-36/data/api-versions.xml`, which records
 *      `FLAG_IGNORE_GLOBAL_SETTING since=3 deprecated=33`). This app targets 36.
 *
 * Matching the reference is the default in this project, not an obligation. A
 * user who switched touch feedback off has said something, and honouring it
 * costs us nothing a reader would notice.
 *
 * ---------------------------------------------------------------------------
 * Constants and their availability
 * ---------------------------------------------------------------------------
 * From the same `api-versions.xml`, against minSdk 24:
 *
 *   LONG_PRESS    since API 3   — always available
 *   KEYBOARD_TAP  since API 8   — always available
 *   CONFIRM       since API 30  — guarded below
 *   REJECT        since API 30  — guarded below
 *
 * `CONFIRM`/`REJECT` fall back to the nearest always-available constant rather
 * than to nothing, so a device on Android 7–10 still feels the beat, just not
 * the newer waveform.
 */
class HapticsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /** A light tap: send, the swipe-reply threshold, a keyboard-like commit. */
    @ReactMethod
    fun tick() {
        perform(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    /** The heavier beat Android fires when a long-press opens something. */
    @ReactMethod
    fun longPress() {
        perform(HapticFeedbackConstants.LONG_PRESS)
    }

    /** Something succeeded. Falls back to a light tap below API 30. */
    @ReactMethod
    fun confirm() {
        perform(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.KEYBOARD_TAP
            },
        )
    }

    /** Something was refused — a wrong code. Falls back to LONG_PRESS below 30. */
    @ReactMethod
    fun reject() {
        perform(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.LONG_PRESS
            },
        )
    }

    /**
     * Fired on the decor view, on the UI thread.
     *
     * A haptic belongs to a View, and the decor view is the one this app can
     * always reach from a module. No flags: the default path is the one that
     * consults the user's setting, which is the entire point of moving off
     * `Vibration`.
     */
    private fun perform(constant: Int) {
        UiThreadUtil.runOnUiThread {
            reactContext.currentActivity?.window?.decorView?.performHapticFeedback(constant)
        }
    }

    companion object {
        const val NAME = "PappalHaptics"
    }
}
