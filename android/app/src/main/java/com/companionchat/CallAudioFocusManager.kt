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
 * Uses AUDIOFOCUS_GAIN for VoIP (not _TRANSIENT): a call holds the audio for its
 * whole duration — minutes, not a blip — so it takes durable focus, and prior
 * audio (music) stays paused until the call ends rather than being invited to
 * resume mid-call. Does not duck on LOSS_TRANSIENT_CAN_DUCK; voice apps mute
 * rather than duck.
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
                 * Permanent loss — but NOT exclusively the telephony stack
                 * (2026-09-17 audit corrects the claim below). AUDIOFOCUS_LOSS
                 * fires whenever ANY app requests a durable AUDIOFOCUS_GAIN,
                 * which is the ordinary way YouTube, Spotify or Instagram Reels
                 * ask for audio the moment their own player starts — glancing at
                 * any of those mid-call delivered the identical event and ended
                 * a paid call the member never chose to leave.
                 *
                 * `audioManager.mode` is the discriminator, and it costs no
                 * permission: MODE_IN_CALL is set by the TELEPHONY FRAMEWORK
                 * ITSELF the moment a cellular call answers, overwriting
                 * whatever mode this call had configured. A media app taking
                 * focus does not touch the system audio mode at all, so our own
                 * MODE_IN_COMMUNICATION (set in requestCallFocus, below) is
                 * still in place when the interruption is not a real call —
                 * which is exactly why the check below tests for MODE_IN_CALL
                 * specifically and not MODE_IN_COMMUNICATION: this app sets
                 * MODE_IN_COMMUNICATION itself for the whole duration of every
                 * call, so treating that value as evidence of an INTERRUPTING
                 * call would make the check true for the entire call and never
                 * actually narrow anything.
                 *
                 * KNOWN GAP, not one this fix introduces: some OEMs implement a
                 * native VoLTE/VoWiFi call at MODE_IN_COMMUNICATION rather than
                 * MODE_IN_CALL, which this check would miss. Resolving that
                 * needs on-device testing against a real carrier call on such a
                 * device, which this session does not have.
                 *
                 * DEPARTURE FROM THE REFERENCE APP, stated because RULE 1 requires it.
                 * the reference app watches TelephonyManager directly and hangs up on
                 * ACTION_PHONE_STATE_CHANGED / EXTRA_STATE_OFFHOOK
                 * (VoIPService.java:516-519). That needs READ_PHONE_STATE, a
                 * new runtime permission and a Play data-safety declaration, to
                 * learn something audio focus (now paired with audio mode)
                 * already tells us for free.
                 *
                 * The mapping is deliberately to LOSS and not LOSS_TRANSIENT,
                 * which mirrors the reference app's own nuance: they hang up on OFFHOOK
                 * (answered), not on RINGING. A cellular call that merely rings
                 * takes transient focus and must NOT end a paid call the member
                 * may well continue.
                 */
                if (audioManager.mode == AudioManager.MODE_IN_CALL) {
                    emitToRN("audioFocusLost")
                }
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
        ReactBridgeEvents.emit(context, "callAction", data)
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
            // AUDIOFOCUS_GAIN, not _TRANSIENT: a call lasts minutes, not a blip.
            // TRANSIENT tells the system this audio use is brief, which on some
            // OEMs leaves the VoIP low-latency path un-provisioned and routing
            // incomplete — part of the "no/laggy audio" class. the reference app's
            // VoIPService requests GAIN for call audio for the same reason.
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
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
                AudioManager.AUDIOFOCUS_GAIN,
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
