package com.companionchat

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import androidx.core.content.getSystemService

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
            AudioManager.AUDIOFOCUS_LOSS -> { /* permanent loss; notify but don't auto-end */ }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { /* brief loss — hold focus */ }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Voice apps mute rather than duck
                // (developer.android.com/media/optimize/audio-focus#java)
            }
        }
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
