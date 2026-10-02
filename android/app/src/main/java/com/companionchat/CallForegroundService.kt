package com.companionchat

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat

/**
 * Foreground service that keeps an active call alive when the app is backgrounded.
 *
 * FGS type "phoneCall|microphone|camera" declared in manifest.
 * ServiceCompat.startForeground() handles API-level branching (API 34+ enforces type
 * mask; older APIs accept the int and ignore it).
 * Must call startForeground() within 5 seconds of startForegroundService().
 *
 * doc: developer.android.com/develop/background-work/services/foreground-services
 * doc: developer.android.com/about/versions/14/changes/fgs-types-required
 * doc: developer.android.com/develop/connectivity/telecom/self-managed
 */
class CallForegroundService : Service() {

    private val audioFocusManager by lazy { CallAudioFocusManager(this) }

    /**
     * Turns the screen off while the phone is at the ear during a VOICE call, the
     * same PROXIMITY_SCREEN_OFF_WAKE_LOCK the reference app's VoIPService holds. Held only
     * for a connected voice call — never while ringing (no mic yet) and never for
     * video, which needs the screen on. Agora routes the audio; the screen is ours.
     */
    private var proximityLock: PowerManager.WakeLock? = null

    /**
     * The continuous incoming ring. A notification channel's sound plays ONCE
     * when the notification is posted (Amit, 2026-09-15: "notification tone also
     * not working for either call or video call") — a phone rings until answered.
     * So while the call is ringing this service loops the device ringtone itself,
     * at USAGE_NOTIFICATION_RINGTONE (the ring stream), and stops it the moment
     * the call is answered (the service restarts with isIncoming=false) or ends.
     * the reference app's VoIPService owns the ring the same way rather than leaning on the
     * channel sound.
     */
    private var ringtone: MediaPlayer? = null

    /**
     * Audio focus for the RING, which is not the audio focus for the call.
     *
     * the reference app takes two different requests at two different moments:
     * `AUDIOFOCUS_GAIN_TRANSIENT` on the ring stream while the phone is ringing
     * (VoIPService.java:4082) and `AUDIOFOCUS_GAIN_TRANSIENT` on the voice-call
     * stream, together with MODE_IN_COMMUNICATION, only once the call CONNECTS
     * (VoIPService.java:4849-4855). The ring is a short, interrupting sound that
     * should let music resume afterwards; the call is not.
     *
     * Kept here and not in `CallAudioFocusManager` because that class owns the
     * connected call's durable focus, and mixing the two is how the ring ended up
     * routed through the call path in the first place.
     */
    private var ringFocusRequest: AudioFocusRequest? = null
    private var ringFocusListener: AudioManager.OnAudioFocusChangeListener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The channel must exist before anything is posted to it. On API 26+ a
        // notification aimed at a channel that was never created is dropped, and
        // for a foreground service that drop is fatal: the system throws
        // RemoteServiceException$CannotPostForegroundServiceNotificationException
        // ("Bad notification for startForeground") and kills the process with
        // signal 9.
        // https://developer.android.com/develop/ui/views/notifications/channels
        //
        // This used to rely on Conversations.notifyCall() having created the
        // channel first, which only happens for an INCOMING call. Every outgoing
        // call therefore killed the app the instant it started. Channel creation
        // is idempotent, so the service that posts the notification is the right
        // place to guarantee it.
        Conversations.ensureCallChannel(this)
        Conversations.ensureCallOngoingChannel(this)

        val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME)
            ?: getString(R.string.call_unknown_caller)
        val isIncoming = intent?.getBooleanExtra(EXTRA_IS_INCOMING, true) ?: true
        val includeMicrophone =
            intent?.getBooleanExtra(EXTRA_INCLUDE_MICROPHONE, false) == true &&
                ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.RECORD_AUDIO,
                ) == PackageManager.PERMISSION_GRANTED
        val includeCamera =
            intent?.getBooleanExtra(EXTRA_INCLUDE_CAMERA, false) == true &&
                ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.CAMERA,
                ) == PackageManager.PERMISSION_GRANTED

        var serviceTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
        if (includeMicrophone) {
            serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        if (includeCamera) {
            serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }

        // Must call startForeground within 5 s of startForegroundService().
        // ServiceCompat back-fills to two-arg form on pre-API-29 devices.
        // On API 34+ the type mask is enforced: MANAGE_OWN_CALLS permission
        // in the manifest is the prerequisite for FOREGROUND_SERVICE_TYPE_PHONE_CALL.
        ServiceCompat.startForeground(
            this,
            CALL_NOTIFICATION_ID,
            buildIncomingNotification(this, callerName, isIncoming, includeCamera),
            serviceTypes,
        )

        // This notification is now the ring, so the one the push put up has to go.
        // the reference app's service takes the call over from its prenotification exactly
        // here (VoIPPreNotificationService.java:476 starts the service, :579
        // cancels ID_INCOMING_CALL_PRENOTIFICATION). Leaving both up was the bug:
        // two CallStyle rings raced and the callee got whichever won, which was
        // usually this one, without a full-screen intent.
        Conversations.cancelCallPrenotification(this)

        // Ring continuously while incoming; stop the instant the call is answered
        // (the caller restarts this service with isIncoming=false) or ends.
        //
        // Before the call focus below, not after, because stopRinging() hands the
        // ring's transient focus back and the two requests must not overlap —
        // the reference app's accept path stops the ringtone before configureDeviceForCall
        // takes call focus (VoIPService.java:4849-4855).
        if (isIncoming) startRinging() else stopRinging()

        // Android 14+ verifies microphone/camera while-in-use permissions when
        // each type is promoted. Add only types whose runtime permission is
        // already granted; callers restart this service after media opens.
        // https://developer.android.com/develop/background-work/services/fgs/launch
        //
        // `!isIncoming` is the fix for an inaudible ring. requestCallFocus sets
        // MODE_IN_COMMUNICATION and takes USAGE_VOICE_COMMUNICATION focus, and in
        // communication mode the ringtone above is routed to the communication
        // device at call volume, so the phone rang into the earpiece at a level
        // nobody could hear. the reference app never enters MODE_IN_COMMUNICATION while
        // ringing — the only two modes in the whole file are MODE_NORMAL and
        // MODE_IN_COMMUNICATION (VoIPService.java:416, 4235, 4839, 4849) — and
        // takes call focus only on CONNECT (VoIPService.java:4849-4855). Our
        // connect is CallScreen restarting this service with isIncoming=false.
        if (includeMicrophone && !isIncoming) {
            // Audio focus must follow FGS promotion on targetSdk 36 / API 35+.
            audioFocusManager.requestCallFocus()
        }

        // Proximity screen-off for a connected VOICE call (mic, no camera), and
        // never while ringing: the lock blanks the screen when something is near
        // the sensor, and a phone ringing in a pocket is the definition of that.
        updateProximity(!isIncoming && includeMicrophone && !includeCamera)

        return START_NOT_STICKY
    }

    /**
     * Loop the device's default ringtone on the ring stream. A ringtone that will
     * not load or play is swallowed — a missing ring is not worth crashing the
     * call service, and the CallStyle notification is still up.
     *
     * Ported whole from the reference app's `startRingtoneAndVibration`
     * (VoIPService.java:4056-4085): gate on the ringer switch, loop, and pick the
     * OUTPUT rather than the audio mode — voice-call output when a headset is
     * plugged in, otherwise the ring stream plus a transient focus request on it.
     */
    private fun startRinging() {
        if (ringtone != null) return
        val audio = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return

        // `boolean needRing = am.getRingerMode() != AudioManager.RINGER_MODE_SILENT`
        // (VoIPService.java:4059-4060). The app had no such check, so a phone the
        // user had deliberately silenced rang anyway.
        if (audio.ringerMode == AudioManager.RINGER_MODE_SILENT) return

        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
            ?: return

        /*
         * the reference app's two branches (VoIPService.java:4077-4084) in AudioAttributes
         * terms: STREAM_VOICE_CALL is USAGE_VOICE_COMMUNICATION and STREAM_RING is
         * USAGE_NOTIFICATION_RINGTONE. setAudioStreamType has been deprecated
         * since API 26 in favour of setAudioAttributes, which is why this is
         * expressed as a usage.
         * https://developer.android.com/reference/android/media/MediaPlayer#setAudioAttributes(android.media.AudioAttributes)
         */
        val headsetPlugged = isHeadsetPlugged(audio)
        if (!headsetPlugged) requestRingFocus(audio)

        val player = MediaPlayer()
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(
                        if (headsetPlugged) {
                            AudioAttributes.USAGE_VOICE_COMMUNICATION
                        } else {
                            AudioAttributes.USAGE_NOTIFICATION_RINGTONE
                        },
                    )
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            player.isLooping = true
            player.setDataSource(this, uri)
            player.prepare()
            player.start()
            ringtone = player
        } catch (e: Exception) {
            player.release()
            abandonRingFocus()
        }
    }

    private fun stopRinging() {
        ringtone?.let { player ->
            try {
                if (player.isPlaying) player.stop()
            } catch (e: IllegalStateException) {
                // Already stopped/released — nothing to do.
            }
            player.release()
        }
        ringtone = null
        abandonRingFocus()
    }

    /**
     * `isWiredHeadsetOn()` is what the reference app reads (VoIPPreNotificationService.java:283),
     * but it has been deprecated since API 15: "Use AudioManager.getDevices(int)
     * instead to list available audio devices." `getDevices` is API 23 and minSdk
     * is 24, so there is no fallback to keep.
     * https://developer.android.com/reference/android/media/AudioManager#isWiredHeadsetOn()
     */
    private fun isHeadsetPlugged(audio: AudioManager): Boolean =
        audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
        }

    /**
     * `am.requestAudioFocus(this, AudioManager.STREAM_RING, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)`
     * (VoIPService.java:4082), expressed with the API 26+ AudioFocusRequest.
     * Transient because the ring is an interruption music should resume after.
     * https://developer.android.com/media/optimize/audio-focus
     */
    private fun requestRingFocus(audio: AudioManager) {
        if (ringFocusRequest != null || ringFocusListener != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest
                .Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .build()
            ringFocusRequest = request
            audio.requestAudioFocus(request)
        } else {
            val listener = AudioManager.OnAudioFocusChangeListener { }
            @Suppress("DEPRECATION")
            audio.requestAudioFocus(
                listener,
                AudioManager.STREAM_RING,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
            ringFocusListener = listener
        }
    }

    private fun abandonRingFocus() {
        val audio = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ringFocusRequest?.let { audio.abandonAudioFocusRequest(it) }
            ringFocusRequest = null
        } else {
            ringFocusListener?.let {
                @Suppress("DEPRECATION")
                audio.abandonAudioFocus(it)
            }
            ringFocusListener = null
        }
    }

    /**
     * Hold or drop the proximity screen-off lock. `acquire` with a generous
     * timeout so a service the OS forgets to stop cannot pin the sensor forever;
     * `PROXIMITY_SCREEN_OFF_WAKE_LOCK` is not on every device, hence the support
     * check. https://developer.android.com/reference/android/os/PowerManager
     */
    private fun updateProximity(hold: Boolean) {
        val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (hold) {
            if (proximityLock == null &&
                power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                proximityLock = power.newWakeLock(
                    PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                    "companionchat:call:proximity",
                )
            }
            proximityLock?.let { if (!it.isHeld) it.acquire(60 * 60 * 1000L) }
        } else {
            proximityLock?.let { if (it.isHeld) it.release() }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        audioFocusManager.abandonCallFocus()
        proximityLock?.let { if (it.isHeld) it.release() }
        proximityLock = null
        // The service dying is the end of the call, which is the moment the push's
        // record of it stops describing anything.
        Conversations.forgetPendingCall()
    }

    companion object {
        const val EXTRA_CALLER_NAME = "caller_name"
        const val EXTRA_IS_INCOMING = "is_incoming"
        const val EXTRA_INCLUDE_MICROPHONE = "include_microphone"
        const val EXTRA_INCLUDE_CAMERA = "include_camera"
        const val CALL_NOTIFICATION_ID = 2001

        const val ACTION_ANSWER = "com.companionchat.ACTION_ANSWER_CALL"
        const val ACTION_DECLINE = "com.companionchat.ACTION_DECLINE_CALL"
        const val ACTION_HANG_UP = "com.companionchat.ACTION_HANG_UP"

        private const val REQUEST_ANSWER = 301
        private const val REQUEST_DECLINE = 302
        private const val REQUEST_HANGUP = 303
        private const val REQUEST_OPEN = 304

        /**
         * @param isIncoming true only while the phone is ringing. It selects the
         * CallStyle: forIncomingCall (Decline | Answer) vs forOngoingCall (Hang
         * up). https://developer.android.com/develop/ui/views/notifications/call-style
         *
         * This was previously hardcoded to true, so placing a call showed the
         * caller an "Incoming call — Decline / Answer" heads-up on top of their
         * own outgoing call screen.
         */
        fun start(
            context: Context,
            callerName: String,
            isIncoming: Boolean,
            includeMicrophone: Boolean = false,
            includeCamera: Boolean = false,
        ) {
            val intent = Intent(context, CallForegroundService::class.java).apply {
                putExtra(EXTRA_CALLER_NAME, callerName)
                putExtra(EXTRA_IS_INCOMING, isIncoming)
                putExtra(EXTRA_INCLUDE_MICROPHONE, includeMicrophone)
                putExtra(EXTRA_INCLUDE_CAMERA, includeCamera)
            }
            // Handles the API 26 startForegroundService boundary for minSdk 24.
            // https://developer.android.com/develop/background-work/services/fgs/launch
            //
            // From the background on API 31+ this throws
            // ForegroundServiceStartNotAllowedException (an IllegalStateException):
            // "Apps that target Android 12 (API level 31) or higher can't start
            // foreground services while the app is running in the background"
            // https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
            // It was fatal (Sentry 150792524: Pixel 8, Android 14, a ring that
            // reached a backgrounded app, 2026-10-01). The JS side now waits for
            // the foreground before asking (src/lib/conversations.ts); this catch
            // is the backstop, so a start that slips through costs the service,
            // not the app. The ring itself is the CallStyle notification
            // Conversations.notifyCall already posted, which needs no service.
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: IllegalStateException) {
                android.util.Log.w(
                    "CallForegroundService",
                    "start refused while backgrounded; deferring to the foreground",
                    e,
                )
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallForegroundService::class.java))
        }

        private fun buildIncomingNotification(
            context: Context,
            callerName: String,
            isIncoming: Boolean,
            includeCamera: Boolean,
        ): Notification {
            val caller = Person.Builder()
                .setName(callerName)
                .setImportant(true)
                .build()

            val contentIntent = PendingIntent.getActivity(
                context, REQUEST_OPEN,
                // Opens the app; React Native handles call routing from App.tsx
                context.packageManager.getLaunchIntentForPackage(context.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            return if (isIncoming) {
                val answerIntent = PendingIntent.getBroadcast(
                    context, REQUEST_ANSWER,
                    Intent(ACTION_ANSWER).setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                val declineIntent = PendingIntent.getBroadcast(
                    context, REQUEST_DECLINE,
                    Intent(ACTION_DECLINE).setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                /*
                 * THE ring notification, not a second one.
                 *
                 * the reference app builds one object: the full-screen intent goes on it
                 * (VoIPService.java:5264), CallStyle.forIncomingCall goes on it
                 * (:5283), and it is what startForeground() is handed (:5319).
                 * This used to deliberately omit the full-screen intent because
                 * Conversations.notifyCall carried one, which made two CallStyle
                 * rings for one call — and the foreground service's, the one
                 * WITHOUT the takeover, is the one the callee tended to get.
                 * IMPORTANCE_HIGH channel triggers heads-up on API 26+; CallStyle
                 * provides green/red action buttons on API 31+.
                 * https://developer.android.com/develop/ui/views/notifications/call-style
                 */
                val isVideo = includeCamera || Conversations.pendingCallIsVideo()
                NotificationCompat.Builder(context, Conversations.CALL_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentIntent(contentIntent)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setOngoing(true)
                    .setStyle(
                        NotificationCompat.CallStyle
                            .forIncomingCall(caller, declineIntent, answerIntent)
                            .setIsVideo(isVideo),
                    )
                    .setContentText(
                        context.getString(
                            if (isVideo) {
                                R.string.call_incoming_video
                            } else {
                                R.string.call_incoming_voice
                            },
                        ),
                    )
                    // Channels only exist from API 26, so on 24-25 this is the
                    // only thing that makes the ring notification audible;
                    // NotificationCompat ignores it from 26 up in favour of the
                    // channel, so there is no double alert.
                    // https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSound(android.net.Uri,int)
                    .setSound(Settings.System.DEFAULT_RINGTONE_URI, AudioManager.STREAM_RING)
                    // The push's Answer intent, because it is the one carrying the
                    // `companionchat://call/...` URI that MainActivity gates
                    // showWhenLocked/turnScreenOn on. Null only when no push
                    // preceded this ring, and then the launcher intent at least
                    // still wakes the app.
                    .setFullScreenIntent(
                        Conversations.pendingCallAnswer() ?: contentIntent,
                        true,
                    )
                    .addPerson(caller)
                    .build()
            } else {
                val hangUpIntent = PendingIntent.getBroadcast(
                    context, REQUEST_HANGUP,
                    Intent(ACTION_HANG_UP).setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                // IMPORTANCE_LOW channel: a call already in progress is a status,
                // not an interruption, so it must not heads-up over the call
                // screen the user is already looking at.
                NotificationCompat.Builder(context, Conversations.CALL_ONGOING_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentIntent(contentIntent)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setOngoing(true)
                    .setStyle(NotificationCompat.CallStyle.forOngoingCall(caller, hangUpIntent))
                    .addPerson(caller)
                    .build()
            }
        }
    }
}
