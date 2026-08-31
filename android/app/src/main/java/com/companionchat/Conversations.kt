package com.companionchat

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import java.net.HttpURLConnection
import java.net.URL

/**
 * Conversation notifications, built the way Android asks a messaging app to
 * build them.
 * https://developer.android.com/develop/ui/views/notifications/conversations
 *
 * **Why any of this is native.** A conversation notification is not a title and
 * a body. Android decides whether a notification belongs in the conversation
 * section — above everything else in the shade, with its own priority controls
 * and its own long-press menu — by looking for three things together: a
 * long-lived dynamic shortcut, a `MessagingStyle` carrying a `Person`, and a
 * `shortcutId` on the notification tying them together. Miss any one and it
 * silently demotes to an ordinary alert. None of that surface is reachable from
 * JavaScript, so it lives here.
 *
 * **What this replaced.** The FCM payload used to carry a `notification` block,
 * which means the SYSTEM renders it and the app never sees it while backgrounded.
 * That is simpler and strictly incapable of any of the above. The payload is now
 * data-only so the app builds the notification itself — see
 * `supabase/functions/send-push/index.ts` for the trade-off that forces, which is
 * real: a data-only message depends on the app being woken, so it carries
 * `priority: high` to survive Doze.
 *
 * Deliberately a plain object with no React Native types, so it can be called
 * from the bridge module, from a future `FirebaseMessagingService`, or from a
 * test, without dragging the bridge in. `ConversationsModule` is the only thing
 * that knows about React.
 */
object Conversations {

    /**
     * One channel, created before any notification is posted.
     *
     * The app previously declared NO channel at all, and the edge function's own
     * comment said so. On Android 8 and above every notification needs one; with
     * none of ours declared, Firebase's SDK falls back to a generic channel named
     * after the library, which is what a user would have seen in Settings. It also
     * means nobody could silence conversations without silencing the whole app.
     *
     * `IMPORTANCE_HIGH` because a message from a person someone is paying to talk
     * to is the definition of time-sensitive, and because conversation shortcuts
     * and bubbles both require at least DEFAULT to behave.
     */
    private const val CHANNEL_ID = "conversations"

    /**
     * The engagement channel, separate from conversations so a re-engagement nudge
     * can be silenced on its own and rings at DEFAULT rather than a message's HIGH
     * — a marketing nudge in the same high-importance channel as real messages is
     * exactly the pattern Play discourages.
     */
    private const val CHANNEL_ENGAGEMENT = "engagement"

    /**
     * The incoming-call channel: IMPORTANCE_HIGH so it can heads-up and ring, and
     * its own channel so a user can control call alerts separately from messages.
     * Public so CallForegroundService can build its ongoing notification on the same
     * channel — one channel entry in Settings, consistent sound settings.
     */
    const val CALL_CHANNEL_ID = "calls"

    /**
     * The in-progress call channel, at IMPORTANCE_LOW.
     *
     * Separate from CALL_CHANNEL_ID because importance is a property of the
     * channel, not of the notification, on API 26+: an ongoing call posted on the
     * IMPORTANCE_HIGH ring channel heads-up, so placing a call threw a "Hang up"
     * banner over the app's own call screen. A ring must interrupt; a call
     * already in progress must not.
     * https://developer.android.com/develop/ui/views/notifications/channels
     */
    const val CALL_ONGOING_CHANNEL_ID = "call_ongoing"

    // Pappal coral (#F2543D). Tints all three notification types so they read as
    // one brand (Amit, 2026-08-27) — the small icon and the CallStyle accent.
    private const val BRAND_COLOR = 0xFFF2543D.toInt()

    fun ensureChannel(context: Context) {
        val channel = NotificationChannelCompat
            .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_conversations))
            .setDescription(context.getString(R.string.channel_conversations_desc))
            .setShowBadge(true)
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun ensureEngagementChannel(context: Context) {
        val channel = NotificationChannelCompat
            .Builder(CHANNEL_ENGAGEMENT, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_engagement))
            .setDescription(context.getString(R.string.channel_engagement_desc))
            .setShowBadge(true)
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun ensureCallChannel(context: Context) {
        val channel = NotificationChannelCompat
            .Builder(CALL_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_calls))
            .setDescription(context.getString(R.string.channel_calls_desc))
            .setShowBadge(false)
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun ensureCallOngoingChannel(context: Context) {
        val channel = NotificationChannelCompat
            .Builder(CALL_ONGOING_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
            .setName(context.getString(R.string.channel_call_ongoing))
            .setDescription(context.getString(R.string.channel_call_ongoing_desc))
            .setShowBadge(false)
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    /**
     * Post, or add to, one conversation's notification.
     *
     * `MessagingStyle` is cumulative by design: a second message from the same
     * person should extend the existing notification rather than replace it, so
     * the shade shows a short transcript instead of only the newest line. That is
     * why the existing notification is read back and its style extracted rather
     * than a fresh style being built each time.
     *
     * The notification id is the conversation's hash, so every message in a
     * conversation lands on the same notification and a different conversation
     * gets its own.
     */
    fun notify(
        context: Context,
        conversationId: String,
        peerId: String,
        senderName: String,
        body: String,
        sentAt: Long,
        avatarUrl: String? = null,
    ) {
        ensureChannel(context)

        // The sender's photo for the Person icon (#6), or null on any failure — a
        // missing photo must never stop the notification from posting.
        val avatarIcon = avatarUrl
            ?.let { loadAvatarBitmap(it) }
            ?.let { IconCompat.createWithBitmap(it) }

        /*
         * `setKey` is what makes two Person objects the same person across
         * notifications. Without it Android matches on name, so two providers who
         * picked the same display name would merge into one conversation — and
         * display names here are user-chosen and not unique.
         */
        val person = Person.Builder()
            .setKey(peerId)
            .setName(senderName)
            .setImportant(true)
            .apply { if (avatarIcon != null) setIcon(avatarIcon) }
            .build()

        /*
         * The shortcut is not optional garnish. `setLongLived(true)` is what lets
         * the system keep it after it leaves the launcher, and a notification whose
         * `shortcutId` points at a shortcut that is not long-lived is demoted out
         * of the conversation section without an error.
         */
        val shortcut = ShortcutInfoCompat.Builder(context, conversationId)
            .setShortLabel(senderName)
            .setLongLabel(senderName)
            .setIcon(avatarIcon ?: IconCompat.createWithResource(context, R.mipmap.ic_launcher))
            .setLongLived(true)
            .setPerson(person)
            .setCategories(setOf(SHARE_CATEGORY))
            .setIntent(peerIntent(context, peerId))
            .build()
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)

        val manager = NotificationManagerCompat.from(context)
        val id = notificationId(conversationId)

        // Extend the existing transcript if one is showing, so the shade reads as a
        // conversation rather than the latest line repeatedly replacing itself.
        val existing = manager.activeNotifications
            .firstOrNull { it.id == id }
            ?.notification
        val style = existing
            ?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it) }
            ?: NotificationCompat.MessagingStyle(
                Person.Builder().setName(context.getString(R.string.you)).build(),
            )
        style.addMessage(body, sentAt, person)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(BRAND_COLOR)
            .setStyle(style)
            // The three together are what Android looks for; `setShortcutId` is the
            // link that ties the style and the shortcut.
            .setShortcutId(conversationId)
            .addPerson(person)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openConversation(context, peerId))
            .build()

        try {
            manager.notify(id, notification)
        } catch (denied: SecurityException) {
            /*
             * POST_NOTIFICATIONS was revoked between the permission check and
             * here. Swallowed rather than crashed: a message arriving is not a
             * moment to take the app down, and the user has already said no.
             */
        }
    }

    /**
     * Post an ENGAGEMENT notification — the second notification type (Amit,
     * 2026-08-27). This is the re-engagement nudge shown when there is NO real
     * message: an SP's photo as a full BigPicture with a call to action ("See
     * who's around", etc.), the shape of the Clarity example.
     *
     * Distinct from `notify`, which is the MessagingStyle conversation
     * notification for a real message. Android allows only one style per
     * notification, so the two are separate builders — and they live on separate
     * channels so a nudge can be silenced without silencing real messages, and
     * so the nudge rings at DEFAULT importance rather than a message's HIGH.
     *
     * A separate id namespace (negated peer hash) so a nudge and a real message
     * about the same person never overwrite each other.
     */
    fun notifyEngagement(
        context: Context,
        peerId: String,
        title: String,
        body: String,
        avatarUrl: String? = null,
    ) {
        ensureEngagementChannel(context)
        val avatar = avatarUrl?.let { loadAvatarBitmap(it) }
        val manager = NotificationManagerCompat.from(context)
        val id = -peerId.hashCode()

        val builder = NotificationCompat.Builder(context, CHANNEL_ENGAGEMENT)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(BRAND_COLOR)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            // HIGH so a nudge heads-up like the others (Amit: "notify like calls
            // for all three"); the channel is IMPORTANCE_HIGH to match.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openConversation(context, peerId))

        if (avatar != null) {
            builder
                .setLargeIcon(avatar)
                .setStyle(
                    NotificationCompat.BigPictureStyle()
                        .bigPicture(avatar)
                        .bigLargeIcon(null as android.graphics.Bitmap?),
                )
        }

        try {
            manager.notify(id, builder.build())
        } catch (denied: SecurityException) {
            // POST_NOTIFICATIONS revoked; swallowed as in notify().
        }
    }

    /**
     * Ring an incoming call — the third notification type.
     *
     * A `CallStyle.forIncomingCall` notification with a full-screen intent, which
     * is what makes the phone show a full ringing screen (over the lock screen)
     * and use the ringtone, rather than a quiet heads-up. `setOngoing` so it
     * cannot be swiped away while ringing.
     *
     * Both actions open the app rather than acting silently: Answer and Decline
     * route to MainActivity with an `action` on the deep link, and the in-app
     * incoming-call screen calls `answer_call` / `end_call` with the user's own
     * session. A BroadcastReceiver could not reach those RPCs — it has no auth —
     * so the notification's job is to ring and wake, and the app's job is the RPC.
     */
    fun notifyCall(
        context: Context,
        callId: String,
        peerId: String,
        callerName: String,
        avatarUrl: String? = null,
        medium: String = "voice",
    ) {
        ensureCallChannel(context)

        val avatarIcon = avatarUrl
            ?.let { loadAvatarBitmap(it) }
            ?.let { IconCompat.createWithBitmap(it) }
        val caller = Person.Builder()
            .setKey(peerId)
            .setName(callerName)
            .setImportant(true)
            .apply { if (avatarIcon != null) setIcon(avatarIcon) }
            .build()

        val answer = callActionIntent(context, peerId, callId, "answer")
        val decline = callActionIntent(context, peerId, callId, "decline")

        val notification = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(BRAND_COLOR)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setAutoCancel(true)
            // setSubText is reliably visible alongside CallStyle on API 12+; the title
            // is overridden by CallStyle on API 31+, so this is the correct slot for
            // the call type. "Video call" vs "Voice call" tells the user what to expect
            // before they answer.
            .setSubText(if (medium == "video") "Video call" else "Voice call")
            // No full-screen intent: the call rings as a heads-up popup, but must
            // never take over the whole screen on top of whatever is running
            // (Amit, 2026-08-27). CallStyle + IMPORTANCE_HIGH is the popup; the tap
            // target is the content intent.
            .setContentIntent(answer)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(callNotificationId(callId), notification)
        } catch (denied: SecurityException) {
            // POST_NOTIFICATIONS revoked; swallowed as in notify().
        }
    }

    /** Clear a call's notification (answered elsewhere, cancelled, timed out). */
    fun clearCall(context: Context, callId: String) {
        NotificationManagerCompat.from(context).cancel(callNotificationId(callId))
    }

    /**
     * The PendingIntent for a call action, addressed explicitly to MainActivity
     * (not a manifest-declared browsable filter — same private-target reasoning as
     * `peerIntent`). The `action` query tells the app to answer or decline.
     */
    private fun callActionIntent(
        context: Context,
        peerId: String,
        callId: String,
        action: String,
    ): android.app.PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("companionchat://call/$peerId?callId=$callId&action=$action"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return android.app.PendingIntent.getActivity(
            context,
            (callId + action).hashCode(),
            intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    // Negated-plus-offset namespace so a call notification never collides with a
    // message (conversation hash) or an engagement nudge (negated peer hash).
    private fun callNotificationId(callId: String): Int = callId.hashCode() xor 0x5CA11

    /**
     * Download the sender's photo and decode it, for both the collapsed large
     * icon and the expanded BigPicture.
     *
     * Runs on the caller's thread, which is always a background one — the FCM
     * headless task, never the UI. Every failure (offline, timeout, a 404, a
     * decode error) returns null so the notification still posts without a photo:
     * a message arriving is not a moment to throw. Timeouts are short for the same
     * reason, a notification that takes ten seconds to appear has already failed.
     *
     * Decoded with `inSampleSize` against a ~1024px target: big enough for the
     * expanded BigPicture to look sharp, small enough that a ~1MB source is not
     * decoded at full resolution into a background-thread bitmap.
     */
    private fun loadAvatarBitmap(url: String): android.graphics.Bitmap? =
        try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4000
                readTimeout = 4000
            }
            val bytes = connection.inputStream.use { it.readBytes() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / sample > 2048) {
                sample *= 2
            }
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        } catch (error: Exception) {
            null
        }

    /** Clear a conversation's notification once it has been read in the app. */
    fun clear(context: Context, conversationId: String) {
        NotificationManagerCompat.from(context).cancel(notificationId(conversationId))
    }

    private fun openConversation(context: Context, peerId: String) =
        android.app.PendingIntent.getActivity(
            context,
            peerId.hashCode(),
            peerIntent(context, peerId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            android.app.PendingIntent.FLAG_IMMUTABLE or
                android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /**
     * The intent a tap opens, built EXPLICITLY against MainActivity.
     *
     * Not an implicit `ACTION_VIEW` matched by a manifest intent-filter, and the
     * difference is both a bug fix and a security fix.
     *
     * The bug: once the push payload goes data-only (stage 2 in
     * `supabase/functions/send-push/index.ts`), these notifications are built
     * here rather than by the system, and their tap fires this PendingIntent
     * directly. The only VIEW filter the manifest declares is `host=auth-callback`,
     * so an implicit `companionchat://peer/<id>` intent matched NOTHING and the
     * tap opened the launcher instead of the conversation. Latent today only
     * because stage 1 still ships a `notification` block, which the system
     * displays and routes through Firebase's own open handler.
     *
     * The security fix: an implicit VIEW filter for `host=peer` would be a
     * BROWSABLE deep link any installed app or web page could fire at us with an
     * arbitrary id. A private in-app tap target has no reason to be externally
     * launchable, so it is addressed by component and never added to the
     * manifest's public surface. The audit's links pass flagged exactly this.
     *
     * The data URI still rides along so React Native's `Linking` surfaces it
     * through `getInitialURL` / the `url` event — the same path OAuth uses, which
     * already survives process death via MainActivity's `onNewIntent` + setIntent.
     */
    private fun peerIntent(context: Context, peerId: String): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("companionchat://peer/$peerId"))

    /*
     * `hashCode` rather than a counter, so the same conversation always maps to
     * the same notification id across process deaths. A counter would restart at
     * zero and start colliding.
     */
    private fun notificationId(conversationId: String): Int = conversationId.hashCode()

    /**
     * The category the manifest's share-target declaration matches on.
     *
     * Kept here so the string cannot drift from `res/xml/shortcuts.xml`; a
     * mismatch silently removes the app from the share sheet's direct-share row
     * with no error anywhere.
     */
    const val SHARE_CATEGORY: String = "com.companionchat.category.CONVERSATION"
}
