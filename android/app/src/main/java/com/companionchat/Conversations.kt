package com.companionchat

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

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

    fun ensureChannel(context: Context) {
        val channel = NotificationChannelCompat
            .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_conversations))
            .setDescription(context.getString(R.string.channel_conversations_desc))
            .setShowBadge(true)
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
    ) {
        ensureChannel(context)

        /*
         * `setKey` is what makes two Person objects the same person across
         * notifications. Without it Android matches on name, so two providers
         * who picked the same display name would merge into one conversation —
         * and display names here are user-chosen and not unique.
         */
        val person = Person.Builder()
            .setKey(peerId)
            .setName(senderName)
            .setImportant(true)
            .build()

        /*
         * The shortcut is not optional garnish. `setLongLived(true)` is what
         * allows the system to keep it after it is removed from the launcher,
         * and a notification whose `shortcutId` points at a shortcut that is not
         * long-lived is demoted out of the conversation section without an error.
         */
        val shortcut = ShortcutInfoCompat.Builder(context, conversationId)
            .setShortLabel(senderName)
            .setLongLabel(senderName)
            .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
            .setLongLived(true)
            .setPerson(person)
            .setCategories(setOf(SHARE_CATEGORY))
            .setIntent(peerIntent(context, peerId))
            .build()
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)

        val manager = NotificationManagerCompat.from(context)
        val id = notificationId(conversationId)

        // Extend the existing transcript if one is showing, so the shade reads as
        // a conversation rather than as the latest line repeatedly replacing itself.
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
            .setStyle(style)
            // The three together are what Android looks for. `setShortcutId` is
            // the link; without it the style and the shortcut never meet.
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
