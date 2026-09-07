package com.companionchat

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import androidx.core.content.getSystemService
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Manages audio focus for an active call session.
 *
 * Uses AUDIOFOCUS_GAIN_TRANSIENT for VoIP: signals that prior audio (music) should
 * pause and resume when the call ends. Does not duck on LOSS_TRANSIENT_CAN_DUCK;
 * voice apps mute rather than duck.
 *
 * API 26+ uses AudioFocusRequest (developer.android.com/media/optimize/audio-focus).
 * API 24–25 falls back to the deprecated listener-based overload.
 * Audio focus MUST be requested after the foreground service has started, because
 * API 35+ (targetSdk 36) rejects focus requests from background processes.
 */
class CallAudioFocusManager(private val context: Context) {

    private val audioManager: AudioManager =
        context.getSystemService<AudioManager>()!!

    // API 26+ path
    private var focusRequest: AudioFocusRequest? = null
    // API 24–25 fallback
    private var legacyFocusListener: AudioManager.OnAudioFocusChangeListener? = null

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> { /* regained — no action needed */ }
            AudioManager.AUDIOFOCUS_LOSS -> {
                /*
                 * Permanent loss. In practice this is the telephony stack taking
                 * exclusive focus, i.e. the user ANSWERED a cellular call, and
                 * JS is told so it can end the paid session.
                 *
                 * DEPARTURE FROM TELEGRAM, stated because RULE 1 requires it.
                 * Telegram watches TelephonyManager directly and hangs up on
                 * ACTION_PHONE_STATE_CHANGED / EXTRA_STATE_OFFHOOK
                 * (VoIPService.java:516-519). That needs READ_PHONE_STATE, a
                 * new runtime permission and a Play data-safety declaration, to
                 * learn something audio focus already tells us. Permanent focus
                 * loss is the same event by its effect, and it costs no
                 * permission.
                 *
                 * The mapping is deliberately to LOSS and not LOSS_TRANSIENT,
                 * which mirrors Telegram's own nuance: they hang up on OFFHOOK
                 * (answered), not on RINGING. A cellular call that merely rings
                 * takes transient focus and must NOT end a paid call the member
                 * may well continue.
                 */
                emitToRN("audioFocusLost")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { /* brief loss — hold focus, see above */ }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Voice apps mute rather than duck
                // (developer.android.com/media/optimize/audio-focus#java)
            }
        }
    }

    /**
     * Same hop as `CallActionReceiver.emitToRN`, and on the same `callAction`
     * event, so JS has ONE listener for "something outside the app ended this
     * call" rather than one per source.
     *
     * Silently does nothing when there is no React context — the process may be
     * mid-teardown, and a focus change during teardown is not worth a crash.
     */
    private fun emitToRN(data: String) {
        val reactContext = (context.applicationContext as? MainApplication)
            ?.reactNativeHost
            ?.reactInstanceManager
            ?.currentReactContext as? ReactContext
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("callAction", data)
    }

    /**
     * Request audio focus and set AudioManager mode to voice communication.
     * Call AFTER startForeground() has been called. Returns true if focus was
     * granted immediately.
     */
    fun requestCallFocus(): Boolean {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build()
            focusRequest = request
            audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            val result = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
            legacyFocusListener = focusChangeListener
            result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    /**
     * Abandon audio focus and restore normal audio mode.
     * Call when the call session ends.
     */
    fun abandonCallFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            legacyFocusListener?.let {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(it)
            }
            legacyFocusListener = null
        }
        audioManager.mode = AudioManager.MODE_NORMAL
    }
}
