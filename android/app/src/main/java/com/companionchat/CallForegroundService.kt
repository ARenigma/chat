package com.companionchat

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME) ?: "Caller"
        val isIncoming = intent?.getBooleanExtra(EXTRA_IS_INCOMING, true) ?: true

        // Must call startForeground within 5 s of startForegroundService().
        // ServiceCompat back-fills to two-arg form on pre-API-29 devices.
        // On API 34+ the type mask is enforced: MANAGE_OWN_CALLS permission
        // in the manifest is the prerequisite for FOREGROUND_SERVICE_TYPE_PHONE_CALL.
        ServiceCompat.startForeground(
            this,
            CALL_NOTIFICATION_ID,
            buildIncomingNotification(this, callerName, isIncoming),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA,
        )

        // Request audio focus after FGS is active (required on targetSdk 36 / API 35+)
        audioFocusManager.requestCallFocus()

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        audioFocusManager.abandonCallFocus()
    }

    companion object {
        const val EXTRA_CALLER_NAME = "caller_name"
        const val EXTRA_IS_INCOMING = "is_incoming"
        const val CALL_NOTIFICATION_ID = 2001

        const val ACTION_ANSWER = "com.companionchat.ACTION_ANSWER_CALL"
        const val ACTION_DECLINE = "com.companionchat.ACTION_DECLINE_CALL"
        const val ACTION_HANG_UP = "com.companionchat.ACTION_HANG_UP"

        private const val REQUEST_ANSWER = 301
        private const val REQUEST_DECLINE = 302
        private const val REQUEST_HANGUP = 303
        private const val REQUEST_OPEN = 304

        fun startIncoming(context: Context, callerName: String) {
            val intent = Intent(context, CallForegroundService::class.java).apply {
                putExtra(EXTRA_CALLER_NAME, callerName)
                putExtra(EXTRA_IS_INCOMING, true)
            }
            context.startForegroundService(intent)
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
                NotificationCompat.Builder(context, Conversations.CALL_CHANNEL_ID)
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
