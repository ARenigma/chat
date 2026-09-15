package com.companionchat

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.IBinder
import android.os.PowerManager
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
     * same PROXIMITY_SCREEN_OFF_WAKE_LOCK Telegram's VoIPService holds. Held only
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
     * Telegram's VoIPService owns the ring the same way rather than leaning on the
     * channel sound.
     */
    private var ringtone: MediaPlayer? = null

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

        val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME) ?: "Caller"
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
            buildIncomingNotification(this, callerName, isIncoming),
            serviceTypes,
        )

        // Android 14+ verifies microphone/camera while-in-use permissions when
        // each type is promoted. Add only types whose runtime permission is
        // already granted; callers restart this service after media opens.
        // https://developer.android.com/develop/background-work/services/fgs/launch
        if (includeMicrophone) {
            // Audio focus must follow FGS promotion on targetSdk 36 / API 35+.
            audioFocusManager.requestCallFocus()
        }

        // Proximity screen-off for a connected VOICE call (mic, no camera).
        updateProximity(includeMicrophone && !includeCamera)

        // Ring continuously while incoming; stop the instant the call is answered
        // (the caller restarts this service with isIncoming=false) or ends.
        if (isIncoming) startRinging() else stopRinging()

        return START_NOT_STICKY
    }

    /**
     * Loop the device's default ringtone on the ring stream. A ringtone that will
     * not load or play is swallowed — a missing ring is not worth crashing the
     * call service, and the CallStyle notification is still up.
     */
    private fun startRinging() {
        if (ringtone != null) return
        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
            ?: return
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
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
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallForegroundService::class.java))
        }

        private fun buildIncomingNotification(
            context: Context,
            callerName: String,
            isIncoming: Boolean,
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
                // Heads-up CallStyle for incoming — no fullScreenIntent.
                // IMPORTANCE_HIGH channel triggers heads-up on API 26+.
                // CallStyle provides green/red action buttons on API 31+.
                // (developer.android.com/reference/androidx/core/app/NotificationCompat.CallStyle)
                NotificationCompat.Builder(context, Conversations.CALL_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentIntent(contentIntent)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setOngoing(true)
                    .setStyle(
                        NotificationCompat.CallStyle
                            .forIncomingCall(caller, declineIntent, answerIntent),
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
