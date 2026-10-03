package com.companionchat

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioManager
import android.net.Uri
import android.provider.Settings
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

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
    // Channel IDs carry a `_v2` version suffix (2026-09-14). A notification
    // channel is WRITE-ONCE: once createNotificationChannel() has run, Android
    // caches its importance, sound and AudioAttributes forever and ignores every
    // later edit — the only resets are reinstall, clearing data, or a NEW id.
    // https://developer.android.com/develop/ui/views/notifications/channels
    //
    // CORRECTION (2026-09-17). This comment used to say the pre-`_v2` channels
    // were "stuck silent" because they were created without an explicit
    // .setSound(). That is not what a missing setSound does.
    // NotificationChannelCompat.Builder initialises mSound to
    // Settings.System.DEFAULT_NOTIFICATION_URI and mAudioAttributes to
    // Notification.AUDIO_ATTRIBUTES_DEFAULT, so the originals carried the
    // device's DEFAULT NOTIFICATION SOUND. What the bump actually buys is the
    // CALL channel: its cached sound was a notification blip at
    // USAGE_NOTIFICATION, and `_v2` makes it DEFAULT_RINGTONE_URI at
    // USAGE_NOTIFICATION_RINGTONE, which is the ring stream and the ring volume.
    // The write-once cache is still why a new id was the only way to get there.
    private const val CHANNEL_ID = "conversations_v2"

    /**
     * The IN-APP conversation channel: a message for a conversation the person
     * is not looking at, arriving while they are using the app (`inApp` on
     * [notify] and [notifyChatRequest], `onForegroundPush` in src/lib/push.ts).
     *
     * The rule it carries is the owner's, taken from Bluesky (social-app
     * src/lib/hooks/useNotificationHandler.ts): in the shade AND as a heads-up
     * banner, with no sound. That needs a channel of its own because on API 26+
     * both halves belong to the channel, not the post. The importance table
     * gives "Urgent: Makes a sound and appears as a heads-up notification" to
     * IMPORTANCE_HIGH, and the heads-up conditions list "The notification
     * channel has high importance" for 8.0 and higher, so HIGH is what peeks;
     * the sound is a separate channel property, and null here is what makes it
     * quiet. The per-post alternative, NotificationCompat.Builder#setSilent, is
     * the one this replaced: it files the post in a "silent" group with
     * GROUP_ALERT_SUMMARY, which is exactly what stops it peeking, so the
     * banner half of the rule could never happen through it.
     * https://developer.android.com/develop/ui/views/notifications/channels
     * https://developer.android.com/develop/ui/compose/notifications#Heads-up
     *
     * A stated deviation: `setSound` says "Notification channels with an
     * importance of at least IMPORTANCE_DEFAULT should have a sound". This one
     * is HIGH for the banner and soundless by the owner's rule; "should", not
     * "must", and the person is already holding the phone.
     *
     * No channel group, because [CHANNEL_ID] has none; the two sit side by side
     * in Settings, and the name says which one is which. `_v1` because a
     * channel is write-once (see [CHANNEL_ID]): if this ever needs a different
     * importance or sound, the id is what changes.
     */
    private const val CHANNEL_IN_APP = "conversations_in_app_v1"

    /**
     * The engagement channel, separate from conversations so a re-engagement nudge
     * can be silenced on its own and rings at DEFAULT rather than a message's HIGH
     * — a marketing nudge in the same high-importance channel as real messages is
     * exactly the pattern Play discourages.
     */
    private const val CHANNEL_ENGAGEMENT = "engagement_v2"

    /**
     * The incoming-call channel: IMPORTANCE_HIGH so it can heads-up and ring, and
     * its own channel so a user can control call alerts separately from messages.
     * Public so CallForegroundService can build its ongoing notification on the same
     * channel — one channel entry in Settings, consistent sound settings.
     */
    const val CALL_CHANNEL_ID = "calls_v2"

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
    const val CALL_ONGOING_CHANNEL_ID = "call_ongoing_v2"

    // Pappal coral (#F2543D). Tints all three notification types so they read as
    // one brand (Amit, 2026-08-27) — the small icon and the CallStyle accent.
    private const val BRAND_COLOR = 0xFFF2543D.toInt()

    /** The extra a chat-request notification names its request by (`clearRequest`). */
    private const val EXTRA_REQUEST_ID = "com.companionchat.extra.REQUEST_ID"

    /**
     * The id of the PRE-notification: the ring posted from the FCM push, before
     * `CallForegroundService` exists to post one of its own.
     *
     * the reference app numbers the same three call states rather than three posters
     * (VoIPService.java:191-193):
     *
     *     ID_ONGOING_CALL_NOTIFICATION     = 201  // connected
     *     ID_INCOMING_CALL_NOTIFICATION    = 202  // ringing, owned by the service
     *     ID_INCOMING_CALL_PRENOTIFICATION = 203  // ringing, owned by the push
     *
     * `VoIPPreNotificationService.java:413` posts 203 from the push and
     * `:579` cancels it the moment the service takes the call over. Ours is the
     * same handover: this id is the push's, `CallForegroundService`'s
     * CALL_NOTIFICATION_ID is the service's, and the service cancels this one as
     * it promotes itself. Before that they were two full CallStyle rings racing,
     * and the FSI-less one (the service's) usually won, so the callee got a tray
     * entry instead of a full-screen takeover.
     *
     * A constant and not a per-call hash, exactly as the reference app's 203 is: the
     * service has no callId to hash, and one device rings one call at a time.
     */
    const val CALL_PRENOTIFICATION_ID = 2003

    /** Logcat tag for the call ring path (B-BS-8): `adb logcat -s PappalCall`. */
    private const val CALL_LOG_TAG = "PappalCall"

    /**
     * Whether the call currently being rung by the push is a video call.
     *
     * The service posts the ring once it starts, and `startCallForegroundService`
     * carries no medium — the camera flag is false while ringing because the
     * camera only opens on answer. So the push records it here and the service
     * reads it, the way the reference app's service reads the pending call the
     * prenotification left behind (`VoIPPreNotificationService.java:379-381`
     * statics, read by `isVideo()` at `:485-487`).
     *
     * Volatile because it is written on the push thread and read on the
     * service's main thread. False when nothing is pending, which is also the
     * right answer for an outgoing call.
     */
    @Volatile
    private var pendingCallIsVideo: Boolean = false

    fun pendingCallIsVideo(): Boolean = pendingCallIsVideo

    /**
     * The push's Answer intent, kept so the service's ring can reuse it as its
     * own full-screen intent.
     *
     * It is the only PendingIntent in the app that carries
     * `companionchat://call/<peer>?callId=...`, and MainActivity gates
     * `setShowWhenLocked` / `setTurnScreenOn` on exactly that URI. A launcher
     * intent in this slot would wake the screen to the launcher instead of to a
     * ringing call.
     */
    @Volatile
    private var pendingCallAnswer: android.app.PendingIntent? = null

    fun pendingCallAnswer(): android.app.PendingIntent? = pendingCallAnswer

    /**
     * The ringing caller's photo, once [notifyCall]'s fill has it, for the
     * service's ring to reuse.
     *
     * The service's ring REPLACES the pushed one ([cancelCallPrenotification])
     * the moment the app comes forward, and it used to build its Person from
     * the name alone, so the face the push had just drawn was swapped for a
     * system monogram mid-ring (S22, 2026-10-03: "profile photo vanished").
     * [pendingCallId] says which call the photo belongs to, so a slow fill for
     * an older ring never lands on a newer one.
     */
    @Volatile
    private var pendingCallAvatar: IconCompat? = null

    @Volatile
    private var pendingCallId: String? = null

    fun pendingCallAvatar(): IconCompat? = pendingCallAvatar

    /**
     * Forget the ringing call. Called when the call service is destroyed, which
     * is the end of the call — NOT from [clearCall], which only takes the pushed
     * notification off the screen and runs before the service has read any of
     * this (App.tsx clears it as it consumes the Answer deep link).
     */
    fun forgetPendingCall() {
        pendingCallIsVideo = false
        pendingCallAnswer = null
        synchronized(postLock) {
            pendingCallAvatar = null
            pendingCallId = null
        }
    }

    /**
     * Take the pushed ring off screen. The service calls this as it promotes
     * itself, so only one of the two ring notifications is ever on screen
     * (`VoIPPreNotificationService.java:579` does the same `nm.cancel` when
     * the reference app's service takes the call over).
     */
    fun cancelCallPrenotification(context: Context) {
        // Under the post lock and with the ring's stamp dropped, as [clear]
        // does for a conversation: the cancel is applied later, and until then
        // the ring is still listed live, so a photo fill waiting on the lock
        // would otherwise post the dead ring back (see `postLock`).
        synchronized(postLock) {
            cancelLocked(NotificationManagerCompat.from(context), CALL_PRENOTIFICATION_ID)
        }
    }

    /**
     * The thread every avatar download runs on.
     *
     * `notify`, `notifyEngagement` and `notifyCall` are all reached from the
     * bridge, which means React Native's single NativeModules queue thread. A
     * blocking HttpURLConnection there stalls every other native call behind it,
     * and for a ring that delay is the ring. So each of the three posts its
     * notification immediately with no photo and fills the photo in here, by
     * re-posting the SAME notification id: Android replaces a notification in
     * place when the id matches.
     * https://developer.android.com/develop/ui/views/notifications/build-notification
     */
    private val avatarExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "pappal-avatar").apply { isDaemon = true }
    }

    /**
     * Held across every read-then-post of a conversation notification, and
     * across [clear] and [clearAll]. Guards [posted], [cleared] and
     * [clearedAll] too.
     *
     * A text post runs on the bridge thread and a photo fill on
     * [avatarExecutor], and both read the live notification before they post
     * over it. Without one lock the fill could read, a newer message could post
     * in between, and the fill would then put the older transcript back over
     * it. Never held across the download, only across the read and the
     * `notify`.
     *
     * The lock alone does NOT keep a cleared notification cleared, and it used
     * to claim it did. `cancel` returns before the cancel is applied: the
     * system service schedules it on its own worker handler, and
     * `getActiveNotifications` ("ones that have been posted by the calling app
     * that have not yet been dismissed by the user or cancel()ed by the app")
     * keeps listing the record until that runs. A fill that took the lock just
     * after [clear] released it still found the notification "live", posted
     * it, and its post was queued behind the cancel, so the cancelled
     * notification came back. Nothing the system returns can tell the two
     * apart, so the answer is kept here: every post stamps its id with a
     * fresh version ([stampPostLocked]), [clear] and [clearAll] throw the
     * stamps away, and a fill posts only if the stamp its own post left is
     * still the current one ([stillCurrentLocked]). The same record keeps a
     * text post right after a clear from reading the cancelled transcript back
     * and re-posting its lines ([activeMessagingStyle]).
     * https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#getActiveNotifications()
     *
     * What still takes no lock of ours: the system removing a notification the
     * person swipes away or taps (`setAutoCancel`). One that lands between a
     * fill's read and its `notify` is undone by the fill. The window is the
     * read, the shortcut push and the post, after the download has finished.
     * The lock-screen Decline no longer cancels anything itself; it clears
     * through [clearRequest] once its RPC has succeeded (ChatRequestReceiver).
     * https://developer.android.com/develop/ui/views/notifications/build-notification#Removing
     *
     * One lock for every id, deliberately, not one per conversation.
     * [clearAll] (sign-out) retires every stamp and sets [clearedAll] in one
     * step, and per-id locks would let a post for an id it had not reached yet
     * slip in between and survive the sign-out. The cost is that posts for
     * different conversations queue: each holds the lock for one `notify` and
     * one shortcut push, Binder calls of about a millisecond, and the avatar
     * download (the slow part) runs outside it. A reconnect burst is a
     * handful of posts, so the queue is milliseconds long.
     */
    private val postLock = Any()

    /** The source of [posted]'s versions. Guarded by [postLock]. */
    private var postVersion = 0L

    /**
     * Each notification id's version, stamped by its latest post since it was
     * last cleared. Guarded by [postLock].
     */
    private val posted = HashMap<Int, Long>()

    /**
     * Ids [clear] cancelled with no post since: a live-list entry for one is a
     * cancel not yet applied. Guarded by [postLock].
     */
    private val cleared = HashSet<Int>()

    /**
     * Whether [clearAll] ran in this process: from then on, only ids posted
     * since can be trusted in the live list. Guarded by [postLock].
     */
    private var clearedAll = false

    /** A chat request's post: which request, and the version its post stamped. */
    private data class RequestPost(val requestId: String, val version: Long)

    /**
     * The latest chat-request post of each notification id, for
     * [clearRequest]. A request and a message for the same conversation share
     * one id, so the id alone cannot say whether what is posted there is still
     * the request. Guarded by [postLock].
     */
    private val requestPosts = HashMap<Int, RequestPost>()

    /** Stamp a post of [id] and return its version, for the post's fill. Under [postLock]. */
    private fun stampPostLocked(id: Int): Long {
        postVersion += 1
        posted[id] = postVersion
        cleared.remove(id)
        return postVersion
    }

    /**
     * Whether a fill for the post stamped [version] may still post: no newer
     * post of [id] (which brings its own fill) and no clear since. Under
     * [postLock].
     */
    private fun stillCurrentLocked(id: Int, version: Long): Boolean = posted[id] == version

    /**
     * Whether what the system lists live for [id] is really live, rather than
     * a cancel of ours still on its way. A notification left by an earlier
     * process is trusted until this one clears. Under [postLock].
     */
    private fun liveTrustedLocked(id: Int): Boolean =
        id !in cleared && (!clearedAll || posted.containsKey(id))

    /**
     * How long the callee's ring may stay up: the call's own 30 s window.
     *
     * The caller gives up at 30 s (`RING_TIMEOUT_OUT_MS` in
     * src/screens/CallScreen.tsx) and the push's FCM ttl is 30 s (send-call),
     * so a callee still ringing after that is ringing a call that has already
     * ended as missed. It was 60 s, and on the S22 (2026-10-03) the ring stayed
     * up after the server had recorded the call missed; an Answer in that tail
     * opened a dead call. Counted from the post, which is after the push lands,
     * so the caller still gives up first (the order clientSupport.test pins).
     * `RING_TIMEOUT_IN_MS` (60 s) stays as it is: it bounds the in-app screen,
     * which Realtime ends the moment the caller does; this notification has no
     * Realtime to end it.
     */
    private const val RING_TIMEOUT_MS = 30_000L

    /**
     * The longest edge a Person/large-icon bitmap is decoded to.
     *
     * A notification's large icon is laid out at a few tens of dp; 384px is 128dp
     * at xxhdpi, so this is already generous. The old 2048 cap decoded a ~16 MB
     * bitmap to draw a thumbnail.
     */
    private const val AVATAR_MAX_PX = 384

    /** The engagement nudge's photo is the full-width BigPicture, so it stays large. */
    private const val BIG_PICTURE_MAX_PX = 1024

    /**
     * AudioAttributes for a MESSAGE alert — a one-shot notification blip.
     * USAGE_NOTIFICATION is what the system routes to the notification volume.
     */
    private fun notificationAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    /**
     * AudioAttributes for an incoming CALL — USAGE_NOTIFICATION_RINGTONE routes to
     * the ring volume and is what Android treats as a call ring, the same usage
     * the reference app's VoIPService sets. https://developer.android.com/reference/android/media/AudioAttributes
     */
    private fun ringtoneAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    /**
     * Delete the pre-`_v2` channels once. A channel's sound cannot be changed
     * after creation, so the only way to move the call channel off the
     * notification blip it cached and onto the ringtone is to abandon its id.
     * Deleting a channel that never existed (fresh install) is a no-op, so this is
     * safe to call on every ensure*. The user sees the old entries vanish from
     * Settings; the `_v2` ones replace them.
     */
    private fun migrateSilentChannels(context: Context) {
        val manager = NotificationManagerCompat.from(context)
        for (old in listOf("conversations", "engagement", "calls", "call_ongoing")) {
            manager.deleteNotificationChannel(old)
        }
    }

    /**
     * Both conversation channels, Messages and [CHANNEL_IN_APP].
     *
     * Together, because the app calls this at startup precisely so a channel
     * is in Settings before the first push that uses it (see
     * `ConversationsModule.ensureChannel`). A person who wants the in-app
     * banner off should find it there before the first banner, not after.
     */
    fun ensureChannel(context: Context) {
        migrateSilentChannels(context)
        val manager = NotificationManagerCompat.from(context)
        val channel = NotificationChannelCompat
            .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_conversations))
            .setDescription(context.getString(R.string.channel_conversations_desc))
            .setShowBadge(true)
            .setSound(Settings.System.DEFAULT_NOTIFICATION_URI, notificationAttributes())
            .build()
        manager.createNotificationChannel(channel)
        // HIGH so it peeks, no sound and no vibration so it does nothing else.
        // setVibrationEnabled is the Compat builder's NotificationChannel
        // #enableVibration. Both are "Only modifiable before the channel is
        // submitted", which is why they are explicit rather than left to
        // whatever the builder defaults to today.
        val inApp = NotificationChannelCompat
            .Builder(CHANNEL_IN_APP, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_conversations_in_app))
            .setDescription(context.getString(R.string.channel_conversations_in_app_desc))
            .setShowBadge(true)
            .setSound(null, null)
            .setVibrationEnabled(false)
            .build()
        manager.createNotificationChannel(inApp)
    }

    /**
     * Where one conversation post goes.
     *
     * [quiet] is `NotificationCompat.Builder#setSilent`. It is true where the
     * person's own quieter choice has to be carried across the two channels by
     * hand (see [route]), and for a post the caller asked to be silent (see
     * [silencedIf]).
     */
    private class Route(val channelId: String, val quiet: Boolean) {
        /**
         * This route, or, when [silent], the same channel with no alert at all.
         *
         * `silent` is the foreground post for a conversation whose chat request
         * is ringing full screen in the app (`foregroundPushAction` in
         * src/lib/viewingConversation.ts). The ring is that same event on
         * screen, so a banner over it would tell it twice; but the post still
         * has to be MADE, because the ring is out of sight the moment the
         * provider locks the phone or leaves the app, and a provider who does
         * not come back has only the shade entry to answer from. (One who comes
         * back within the 30 seconds finds the ring still up, and after it the
         * request waits in the thread.) setSilent is the per-post switch for a
         * post that must be made without alerting: it "silences this instance
         * of the notification and prevents the notification from peeking on
         * screen, regardless of the importance, sounds, or vibrations set on
         * the notification or notification channel", and "Notifications remain
         * visible until" the person dismisses or taps them, or the app cancels
         * them, so the entry stays in the shade. Same channel as the unsilenced
         * post would use, so a per-conversation choice made on it still
         * applies.
         * https://developer.android.com/develop/ui/views/notifications/build-notification#Removing
         * https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSilent(boolean)
         */
        fun silencedIf(silent: Boolean): Route = if (silent) Route(channelId, quiet = true) else this
    }

    /**
     * The channel for a post, or null for no post at all: Messages for a
     * background push, [CHANNEL_IN_APP] for an in-app one, each yielding to a
     * quieter choice the person made on the other.
     *
     * "After you create a notification channel ... The user has complete
     * control at that point." A second channel must not become a way round
     * that, in either direction.
     *
     * The platform keys a conversation's own settings by PARENT channel. A
     * person who long-presses a conversation notification and picks Priority,
     * Default or Silent gets a conversation channel created under the channel
     * THAT notification was posted on, and turning the conversation off in
     * Settings then acts on that channel. Every later post finds it only if
     * it is posted on the same parent:
     * `getNotificationChannel(channelId, conversationId)` "If a conversation
     * channel with the given conversation id is not found, this method will
     * instead return the parent channel with the given channel ID". The shade
     * entry for a conversation belongs to whichever channel posted it last,
     * and it stays in the shade after the app goes to the background, so both
     * directions happen:
     *
     *   - In-app post, choice made on Messages (Messages turned down, or the
     *     conversation made Silent from a background post): read Messages
     *     through the conversation's channel; below HIGH, the post goes on
     *     Messages itself, quieted, so the system shows it at or below what
     *     the person chose (nothing at all if they blocked it). A choice made
     *     on the in-app channel needs nothing here while the post is on that
     *     parent, since the system applies it, except OFF: the yield to
     *     Messages leaves that parent, so the in-app conversation channel is
     *     read first and a conversation turned off there gets no post.
     *   - Background post, choice made on the in-app channel (the conversation
     *     made Silent or turned off from an in-app banner): Messages alone
     *     would never see it. So the in-app channel's conversation channel is
     *     read too, and only when it is a conversation channel
     *     (`conversationId != null`): this app never creates one, so one that
     *     exists is the person's. Turned off, the post is skipped, and that is
     *     checked FIRST, before anything Messages says: "Makes no sound and
     *     doesn't appear in the status bar or shade" is the one setting that
     *     cannot be half-applied, and a conversation the person turned off
     *     anywhere is off. Checked after, a person who had once made the
     *     conversation Priority or Silent from a background post, and later
     *     turned it off from an in-app banner, still got every background
     *     message (Greptile P1 on bb32af4). Nor can a later Messages choice be
     *     what it overrides: once off, no post for this conversation reaches
     *     the shade on either parent, so there is no notification left to
     *     long-press. Below HIGH, the post goes on Messages quieted, unless the
     *     person also made a choice on Messages for this conversation: that one
     *     wins for loudness, because it is the channel the system itself
     *     applies to this post.
     *
     * DEVIATION, stated: only the quieter half can be carried across. Priority,
     * or a custom sound, chosen from an in-app banner lives on the in-app
     * channel's conversation channel and cannot be applied to a Messages post
     * by any per-post flag, so a background post uses Messages' own settings
     * for it. The reverse is the same: in-app posts are silent by the owner's
     * rule whatever sound Messages has.
     *
     * The shortcut id is the conversation id here, so it is the conversationId
     * both lookups need. Null channels mean below API 26, where there are no
     * channels and the post's own defaults decide (`setDefaults` in [notify]);
     * below API 30 there are no conversation channels, and the lookup
     * "Returns the channel for the channelId".
     * https://developer.android.com/develop/ui/views/notifications/channels
     * https://developer.android.com/develop/ui/views/notifications/conversations
     * https://developer.android.com/reference/android/app/NotificationManager#getNotificationChannel(java.lang.String,%20java.lang.String)
     * https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#getNotificationChannelCompat(java.lang.String,java.lang.String)
     */
    private fun route(
        manager: NotificationManagerCompat,
        conversationId: String,
        inApp: Boolean,
    ): Route? {
        val messages = manager.getNotificationChannelCompat(CHANNEL_ID, conversationId)
        if (inApp) {
            /*
             * "Messages while using the app" switched off is off, asked before
             * anything else. A post on that parent gets it from the system,
             * but the yield below moves the post to Messages whenever Messages
             * is under HIGH, and Messages' lookup never reads the in-app
             * parent: a person who turned the in-app channel off still got
             * every foreground push, quietly, in the shade. The one-argument
             * lookup reads the parent itself, whatever conversation channels
             * sit under it ("Returns the notification channel settings for a
             * given channel id").
             * https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#getNotificationChannelCompat(java.lang.String)
             */
            val parentOff = manager.getNotificationChannelCompat(CHANNEL_IN_APP)
                ?.importance == NotificationManagerCompat.IMPORTANCE_NONE
            if (parentOff) {
                return null
            }
            /*
             * Off from an in-app banner is off here too, and asked first. A
             * post on the in-app parent gets it from the system, but the yield
             * below moves the post to Messages whenever Messages is under
             * HIGH, where the in-app conversation channel is never consulted:
             * a conversation the person had turned off came back, quietly, in
             * the shade on every foreground push, while its background posts
             * were skipped.
             */
            val offHere = manager.getNotificationChannelCompat(CHANNEL_IN_APP, conversationId)
                ?.takeIf { it.conversationId != null }
                ?.importance == NotificationManagerCompat.IMPORTANCE_NONE
            if (offHere) {
                return null
            }
            if (messages == null || messages.importance >= NotificationManagerCompat.IMPORTANCE_HIGH) {
                return Route(CHANNEL_IN_APP, quiet = false)
            }
            return Route(CHANNEL_ID, quiet = true)
        }
        val inAppChoice = manager.getNotificationChannelCompat(CHANNEL_IN_APP, conversationId)
            ?.takeIf { it.conversationId != null }
            ?: return Route(CHANNEL_ID, quiet = false)
        // Off wins over everything, a Messages conversation channel included.
        if (inAppChoice.importance == NotificationManagerCompat.IMPORTANCE_NONE) {
            return null
        }
        if (messages?.conversationId != null) {
            return Route(CHANNEL_ID, quiet = false)
        }
        return Route(
            CHANNEL_ID,
            quiet = inAppChoice.importance < NotificationManagerCompat.IMPORTANCE_HIGH,
        )
    }

    fun ensureEngagementChannel(context: Context) {
        migrateSilentChannels(context)
        val channel = NotificationChannelCompat
            .Builder(CHANNEL_ENGAGEMENT, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_engagement))
            .setDescription(context.getString(R.string.channel_engagement_desc))
            .setShowBadge(true)
            .setSound(Settings.System.DEFAULT_NOTIFICATION_URI, notificationAttributes())
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun ensureCallChannel(context: Context) {
        migrateSilentChannels(context)
        // The ring channel uses the device's RINGTONE at ringtone usage, so an
        // incoming call sounds like a call, not a message blip. Continuous
        // looping (a call rings until answered) is the CallForegroundService's
        // job — a channel sound plays once — see CallForegroundService.
        val channel = NotificationChannelCompat
            .Builder(CALL_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_calls))
            .setDescription(context.getString(R.string.channel_calls_desc))
            .setShowBadge(false)
            .setSound(Settings.System.DEFAULT_RINGTONE_URI, ringtoneAttributes())
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun ensureCallOngoingChannel(context: Context) {
        migrateSilentChannels(context)
        // Deliberately silent: an in-progress call must not blip. LOW importance
        // and no sound, unchanged except for the versioned id.
        val channel = NotificationChannelCompat
            .Builder(CALL_ONGOING_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
            .setName(context.getString(R.string.channel_call_ongoing))
            .setDescription(context.getString(R.string.channel_call_ongoing_desc))
            .setShowBadge(false)
            .setSound(null, null)
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
     *
     * [inApp] is the FOREGROUND post (`onForegroundPush` in src/lib/push.ts):
     * a message for a conversation other than the one on screen, arriving while
     * the person is using the app. It is the same notification (same id, same
     * shortcut, same cumulative transcript) posted on [CHANNEL_IN_APP], which
     * peeks without a sound. It is per-POST, not per-notification: posting the
     * same id on another channel replaces the notification in place ("call
     * NotificationManagerCompat.notify() again, passing it the same ID"), and
     * the transcript is read back from whatever is live, whichever channel put
     * it there. So the next background push for the same conversation passes
     * `false`, lands on Messages and alerts with sound, and still extends the
     * lines this post left in the shade; the reverse holds too. Every existing
     * caller gets the default, which is the behaviour they had.
     * https://developer.android.com/develop/ui/views/notifications/build-notification#Updating
     *
     * [silent] posts it in the shade with no banner and no sound (see
     * [Route.silencedIf]); only ever passed with [inApp].
     *
     * [recipientId] is the account the push was for (send-push's
     * `recipientId`, migration 143), or null when the sender named none. It
     * rides on the tap's link and the shortcut's (see [withRecipient]).
     */
    fun notify(
        context: Context,
        conversationId: String,
        peerId: String,
        senderName: String,
        body: String,
        sentAt: Long,
        avatarUrl: String? = null,
        inApp: Boolean = false,
        silent: Boolean = false,
        recipientId: String? = null,
    ) {
        ensureChannel(context)

        val manager = NotificationManagerCompat.from(context)
        val id = notificationId(conversationId)
        // This post's route. Its photo fill does not reuse it: by the time the
        // picture arrives a newer post may have moved the notification to the
        // other channel, so the fill takes the route of whatever is live then
        // (`liveRoute`). Null is the person having turned this conversation
        // off (see `route`).
        val route = route(manager, conversationId, inApp)?.silencedIf(silent) ?: return

        /*
         * `setKey` is what makes two Person objects the same person across
         * notifications. Without it Android matches on name, so two providers who
         * picked the same display name would merge into one conversation — and
         * display names here are user-chosen and not unique.
         */
        fun personOf(icon: IconCompat?): Person = Person.Builder()
            .setKey(peerId)
            .setName(senderName)
            .setImportant(true)
            .apply { if (icon != null) setIcon(icon) }
            .build()

        fun post(
            style: NotificationCompat.MessagingStyle,
            icon: IconCompat?,
            via: Route,
            photoFill: Boolean = false,
        ) {
            val person = personOf(icon)

            /*
             * The shortcut is not optional garnish. `setLongLived(true)` is what
             * lets the system keep it after it leaves the launcher, and a
             * notification whose `shortcutId` points at a shortcut that is not
             * long-lived is demoted out of the conversation section without an
             * error.
             */
            val shortcut = ShortcutInfoCompat.Builder(context, conversationId)
                .setShortLabel(senderName)
                .setLongLabel(senderName)
                .setIcon(icon ?: IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                .setLongLived(true)
                .setPerson(person)
                .setCategories(setOf(SHARE_CATEGORY))
                .setIntent(peerIntent(context, peerId, recipientId))
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)

            val notification = NotificationCompat.Builder(context, via.channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(BRAND_COLOR)
                .setStyle(style)
                // The three together are what Android looks for; `setShortcutId` is the
                // link that ties the style and the shortcut.
                .setShortcutId(conversationId)
                .addPerson(person)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                // minSdk is 24 and channels only exist from 26, so on Android 7.x
                // the alert comes from here or not at all. "On platforms O and
                // above this value is ignored in favor of the values set on the
                // notification's channel. On older platforms, this value is still
                // used, so it is still required for apps supporting those
                // platforms."
                // https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setDefaults(int)
                //
                // None for an in-app post: no sound is the owner's rule on
                // every API level. On 24-25 that also costs the banner, since
                // the heads-up condition there is "high priority and uses
                // ringtones or vibrations"; where the two halves of the rule
                // cannot both hold, the quiet half wins, as it does on 26+ for
                // a person who turned Messages down (see `route`).
                // https://developer.android.com/develop/ui/compose/notifications#Heads-up
                .setDefaults(
                    if (inApp) 0 else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE,
                )
                .setAutoCancel(true)
                .setContentIntent(openConversation(context, peerId, recipientId))
                // Only where a quieter choice the person made on one channel
                // has to be carried to a post on Messages (see `route`): an
                // in-app post while Messages is turned down, or a background
                // post for a conversation made Silent from an in-app banner;
                // and for a post the caller asked to be silent, the ringing
                // request (see `Route.silencedIf`). setSilent "prevents
                // the notification from peeking on screen, regardless of the
                // importance, sounds, or vibrations set on the notification or
                // notification channel", which is why it is not how the in-app
                // banner is made, and exactly why it is right here: a person
                // who turned it down gets no banner and no sound. It files the
                // post in a "silent" group with GROUP_ALERT_SUMMARY, so it stays
                // correct only while this builder sets no group of its own.
                // https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSilent(boolean)
                .setSilent(via.quiet)
                // A photo fill is an UPDATE of a notification that already
                // alerted (or already chose not to), and "interrupts the user...
                // only the first time the notification appears and not for later
                // updates" is exactly what it wants. Without it the fill is an
                // update Android may alert for again, so a message from a
                // provider with a photo could sound twice, once for the text and
                // once for the picture. Never set on a post that adds a message,
                // or a second message in the transcript would land without a
                // sound.
                // https://developer.android.com/develop/ui/views/notifications/build-notification#Updating
                .setOnlyAlertOnce(photoFill)
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

        // Extend the existing transcript if one is showing, so the shade reads as a
        // conversation rather than the latest line repeatedly replacing itself.
        // Stamped in the same hold, so the fill below can tell whether this is
        // still the post it is filling in (`stillCurrentLocked`).
        val version = synchronized(postLock) {
            val style = activeMessagingStyle(manager, id)
                ?: NotificationCompat.MessagingStyle(
                    Person.Builder().setName(context.getString(R.string.you)).build(),
                )
            style.addMessage(body, sentAt, personOf(null))
            post(style, null, route)
            stampPostLocked(id)
        }

        if (avatarUrl != null) {
            avatarExecutor.execute {
                val icon = loadAvatarBitmap(avatarUrl, AVATAR_MAX_PX)
                    ?.let { personIcon(it) }
                    ?: return@execute
                /*
                 * Re-read what is actually on screen rather than re-posting the
                 * transcript captured above: a second message can land while the
                 * photo is still downloading, and rebuilding from a stale copy
                 * would delete it from the shade. The route too, for the same
                 * reason (`liveRoute`). Gone means cancelled, and the picture is
                 * not a reason to bring it back. Cleared by `clear` or
                 * `clearAll` is gone too, even while the system still lists it
                 * (`stillCurrentLocked`, see `postLock`); so is a post a newer
                 * one replaced, whose own fill brings the photo. Only a tap or
                 * a swipe that lands between this read and the post is undone.
                 */
                synchronized(postLock) {
                    if (!stillCurrentLocked(id, version)) return@execute
                    val live = activeNotification(manager, id) ?: return@execute
                    val style = NotificationCompat.MessagingStyle
                        .extractMessagingStyleFromNotification(live)
                        ?: return@execute
                    post(withSenderIcon(style, peerId, icon), icon, liveRoute(live, route), photoFill = true)
                }
            }
        }
    }

    /** The notification currently posted at [id], if any. */
    private fun activeNotification(
        manager: NotificationManagerCompat,
        id: Int,
    ): Notification? = manager.activeNotifications
        .firstOrNull { it.id == id }
        ?.notification

    /**
     * The MessagingStyle of the notification currently posted at [id], if any.
     * None for an id this process cleared with no post since: the system can
     * still list it while the cancel is on its way (see `postLock`), and
     * extending it would post the lines just cleared back into the shade.
     * Under [postLock].
     */
    private fun activeMessagingStyle(
        manager: NotificationManagerCompat,
        id: Int,
    ): NotificationCompat.MessagingStyle? = activeNotification(manager, id)
        ?.takeIf { liveTrustedLocked(id) }
        ?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it) }

    /**
     * The same transcript with [peerId]'s photo attached to every line they sent.
     *
     * A Message's Person is fixed once it is added, so the icon that arrives after
     * the notification is already up has to be applied by rebuilding the style.
     */
    private fun withSenderIcon(
        style: NotificationCompat.MessagingStyle,
        peerId: String,
        icon: IconCompat,
    ): NotificationCompat.MessagingStyle {
        val updated = NotificationCompat.MessagingStyle(style.user)
        for (message in style.messages) {
            val sender = message.person
            val person = if (sender?.key == peerId) {
                sender.toBuilder().setIcon(icon).build()
            } else {
                sender
            }
            updated.addMessage(message.text, message.timestamp, person)
        }
        return updated
    }

    /**
     * The route [live] was posted with, for a photo fill to re-post it on.
     *
     * A fill is an update of whatever notification is live when the picture
     * arrives, and that may no longer be the post that asked for the picture:
     * a newer message can have replaced it on the other channel (an in-app
     * banner, then a background push, or the reverse). Re-posting on the
     * route captured with the older post moved the notification back to the
     * older channel and its older quiet flag, over the newer post's choice.
     * An update replaces the notification in place, channel included ("call
     * NotificationManagerCompat.notify() again, passing it the same ID"), so
     * the fill must name the channel the live one is already on.
     *
     * Both halves are read off the notification itself. The channel is
     * NotificationCompat.getChannelId, "the ID of the channel this notification
     * posts to". The quiet flag is the group setSilent files a post in:
     * GROUP_KEY_SILENT is "the group key that's added to notifications that are
     * not already grouped when setNotificationSilent is used when SDK_INT is >=
     * O", and no builder here sets a group of its own (see `notify`). Below O
     * there is no channel to read and none to get wrong, so [posted] stands;
     * the fill cannot alert there either, being setOnlyAlertOnce.
     * https://developer.android.com/develop/ui/views/notifications/build-notification#Updating
     * https://developer.android.com/reference/androidx/core/app/NotificationCompat#getChannelId(android.app.Notification)
     * https://developer.android.com/reference/androidx/core/app/NotificationCompat#GROUP_KEY_SILENT()
     */
    private fun liveRoute(live: Notification, posted: Route): Route {
        val channelId = NotificationCompat.getChannelId(live) ?: return posted
        return Route(
            channelId,
            quiet = NotificationCompat.getGroup(live) == NotificationCompat.GROUP_KEY_SILENT,
        )
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
        val manager = NotificationManagerCompat.from(context)
        val id = -peerId.hashCode()

        fun post(avatar: android.graphics.Bitmap?) {
            val builder = NotificationCompat.Builder(context, CHANNEL_ENGAGEMENT)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(BRAND_COLOR)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                // HIGH so a nudge heads-up like the others (Amit: "notify like calls
                // for all three"); the channel is IMPORTANCE_HIGH to match.
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                // Ignored from API 26 up in favour of the channel; on 24-25 it is
                // the only thing that makes the nudge audible. See `notify`.
                .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
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

        // Stamped like a conversation post, so a sign-out's `clearAll` also
        // keeps this nudge's photo fill from posting it back.
        val version = synchronized(postLock) {
            post(null)
            stampPostLocked(id)
        }

        if (avatarUrl != null) {
            avatarExecutor.execute {
                val avatar = loadAvatarBitmap(avatarUrl, BIG_PICTURE_MAX_PX) ?: return@execute
                synchronized(postLock) {
                    if (stillCurrentLocked(id, version)) post(avatar)
                }
            }
        }
    }

    /**
     * Ring an incoming call from the push — the third notification type, and the
     * PRE-notification of the pair (see [CALL_PRENOTIFICATION_ID]).
     *
     * A `CallStyle.forIncomingCall` notification with a full-screen intent, which
     * is what makes the phone show a full ringing screen (over the lock screen)
     * and use the ringtone, rather than a quiet heads-up. `setOngoing` so it
     * cannot be swiped away while ringing. the reference app's prenotification is built
     * the same way and for the same reason — FSI plus CallStyle, posted from the
     * push before any service exists (VoIPPreNotificationService.java:243, :269).
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
        recipientId: String? = null,
    ) {
        ensureCallChannel(context)

        val isVideo = medium == "video"
        val manager = NotificationManagerCompat.from(context)
        val answer = callActionIntent(context, peerId, callId, "answer", medium, recipientId)
        val decline = callActionIntent(context, peerId, callId, "decline", medium, recipientId)

        pendingCallIsVideo = isVideo
        pendingCallAnswer = answer
        // Under the post lock, as the fill's check-and-set below is: a slow
        // fill for the previous call must not land between these two writes.
        synchronized(postLock) {
            pendingCallAvatar = null
            pendingCallId = callId
        }

        /*
         * B-BS-8 (BrowserStack Pixel 8, Android 14, 2026-10-02): a call pushed to a
         * backgrounded app reached this function and drew NOTHING. A CallStyle
         * notification is only legal "for a foreground Service or with a
         * fullScreenIntent" (Notification.CallStyle; NotificationManagerService
         * rejects it otherwise), and on Android 14 an app that is not the
         * default dialer or alarm app may have USE_FULL_SCREEN_INTENT revoked
         * ("must check NotificationManager.canUseFullScreenIntent()").
         * Declaring MANAGE_OWN_CALLS does not keep the grant. With the grant
         * gone the system strips the full-screen intent, the CallStyle is then
         * neither, notify() throws IllegalArgumentException, and the module's
         * catch-all resolved `false` with no log.
         * https://developer.android.com/about/versions/14/behavior-changes-14#fsi-restrictions
         * https://developer.android.com/develop/ui/views/notifications/call-style
         *
         * So: CallStyle with the full-screen intent when the grant is there; a
         * plain high-importance ring (title, Decline and Answer actions, the
         * ringtone channel, no full-screen intent) when it is not, or when the
         * system refuses the CallStyle anyway. The fallback is a heads-up
         * rather than a take-over, which is what Android allows such an app.
         */
        val fullScreenAllowed =
            android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                context.getSystemService(android.app.NotificationManager::class.java)
                    ?.canUseFullScreenIntent() == true

        fun post(avatarIcon: IconCompat?) {
            val caller = Person.Builder()
                .setKey(peerId)
                .setName(callerName)
                .setImportant(true)
                .apply { if (avatarIcon != null) setIcon(avatarIcon) }
                .build()

            val notification = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(BRAND_COLOR)
                .setStyle(
                    NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer)
                        .setIsVideo(isVideo),
                )
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOngoing(true)
                .setAutoCancel(true)
                // forIncomingCall "will have a default content text for an incoming
                // call" — a default, which an explicit one replaces. This used to
                // be setSubText, which CallStyle demotes to the small header chip
                // while its own "Incoming call" kept the main line, so the one
                // thing the callee needs before answering (is my camera about to
                // come on?) was in the smallest text on the notification.
                // https://developer.android.com/reference/androidx/core/app/NotificationCompat.CallStyle
                .setContentText(
                    context.getString(
                        if (isVideo) R.string.call_incoming_video else R.string.call_incoming_voice,
                    ),
                )
                // The ring is silent on API 24-25 without this: channels arrive in
                // 26, and NotificationCompat ignores the sound set here from 26 up
                // in favour of the channel's, so there is no double alert.
                // https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSound(android.net.Uri,int)
                .setSound(Settings.System.DEFAULT_RINGTONE_URI, AudioManager.STREAM_RING)
                // An unanswered ring used to stay in the shade forever: `setOngoing`
                // makes it unswipeable and the only code that cancelled it was the
                // deep-link branch, so answering by Realtime, a cancel by the
                // caller, or a ring timeout all left it up. "Specifies the time at
                // which this notification should be canceled" — the system does it,
                // which is why this is here rather than an app-side Handler or
                // AlarmManager that dies with the process. "No-op on versions prior
                // to O", so on 24-25 the bound is still only JS's clearCall.
                // https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setTimeoutAfter(long)
                .setTimeoutAfter(RING_TIMEOUT_MS)
                // Full-screen intent: an incoming call takes over the screen — over the
                // lock screen — the way a phone call does (Amit, 2026-09-14, reversing
                // the 2026-08-27 heads-up-only call). The system shows the heads-up when
                // the device is in use and escalates to the full-screen `answer` intent
                // when the screen is off or locked; MainActivity sets showWhenLocked /
                // turnScreenOn for a call URI so it renders over the keyguard. `answer`
                // opens the RINGING screen (App.tsx routes action=answer into the
                // incoming CallScreen without auto-answering), not an accepted call.
                // Gated by USE_FULL_SCREEN_INTENT + MANAGE_OWN_CALLS (calling-app grant).
                // https://developer.android.com/develop/ui/views/notifications/call-style
                .setFullScreenIntent(answer, true)
                .setContentIntent(answer)
                .build()

            // The heads-up form of the same ring, for when CallStyle is not
            // allowed (see `fullScreenAllowed`).
            val plain = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(BRAND_COLOR)
                .setContentTitle(callerName)
                .setContentText(
                    context.getString(
                        if (isVideo) R.string.call_incoming_video else R.string.call_incoming_voice,
                    ),
                )
                .addPerson(caller)
                .addAction(0, context.getString(R.string.call_action_decline), decline)
                .addAction(0, context.getString(R.string.call_action_answer), answer)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(true)
                .setSound(Settings.System.DEFAULT_RINGTONE_URI, AudioManager.STREAM_RING)
                .setTimeoutAfter(RING_TIMEOUT_MS)
                .setContentIntent(answer)
                .build()

            try {
                if (fullScreenAllowed) {
                    try {
                        manager.notify(CALL_PRENOTIFICATION_ID, notification)
                    } catch (refused: IllegalArgumentException) {
                        android.util.Log.w(CALL_LOG_TAG, "notifyCall: CallStyle refused, ringing as a heads-up", refused)
                        manager.notify(CALL_PRENOTIFICATION_ID, plain)
                    }
                } else {
                    android.util.Log.i(CALL_LOG_TAG, "notifyCall: full-screen intent not granted, ringing as a heads-up")
                    manager.notify(CALL_PRENOTIFICATION_ID, plain)
                }
            } catch (denied: SecurityException) {
                // POST_NOTIFICATIONS revoked: nothing can be shown. Logged, not
                // silent, so the next missing ring is visible in logcat.
                android.util.Log.w(CALL_LOG_TAG, "notifyCall: notify refused (notifications off?)", denied)
            }
        }

        // Stamped like a conversation post. Every ring shares one id, and each
        // fill re-posts ITS call's name and Answer/Decline intents (the callId
        // is in their data URI and request code), so a fill must know it is
        // still filling the ring now at that id.
        val version = synchronized(postLock) {
            post(null)
            stampPostLocked(CALL_PRENOTIFICATION_ID)
        }

        if (avatarUrl != null) {
            avatarExecutor.execute {
                val avatar = loadAvatarBitmap(avatarUrl, AVATAR_MAX_PX) ?: return@execute
                val icon = personIcon(avatar)
                // The service's ring takes over from this one when the app comes
                // forward, and wears the same face (see `pendingCallAvatar`).
                // Check and set in one hold of the lock notifyCall resets under,
                // so an older call's fill cannot put its face on a newer ring.
                val stillThisCall = synchronized(postLock) {
                    (pendingCallId == callId).also { if (it) pendingCallAvatar = icon }
                }
                if (stillThisCall) {
                    CallForegroundService.refreshIncoming(context)
                }
                /*
                 * Only worth re-posting while the ring is still this call's ring.
                 * A newer ring stamps the id again, and a fill that only checked
                 * the live list put the older call's name and intents over it.
                 * A cancel ([cancelCallPrenotification]) drops the stamp, since
                 * the live list keeps a cancelled ring until the cancel is
                 * applied and a fill would bring it back (see `postLock`). The
                 * live check stays for what takes no lock of ours: the system's
                 * own timeout and a tap.
                 */
                synchronized(postLock) {
                    if (stillCurrentLocked(CALL_PRENOTIFICATION_ID, version) &&
                        manager.activeNotifications.any { shown -> shown.id == CALL_PRENOTIFICATION_ID }
                    ) {
                        post(icon)
                    }
                }
            }
        }
    }

    /**
     * Clear the pushed ring (answered elsewhere, cancelled, timed out).
     *
     * `callId` is no longer part of the id — see [CALL_PRENOTIFICATION_ID] — but
     * it stays in the signature because the JS side knows which call it is
     * clearing and a future second ring would need it back.
     */
    fun clearCall(context: Context, callId: String) {
        cancelCallPrenotification(context)
    }

    /**
     * Post a chat-request notification — MessagingStyle with Accept/Decline
     * action buttons.
     *
     * Android conversation requirements still apply (shortcut, Person,
     * MessagingStyle) so this lives in the conversations channel and shade section.
     * CallStyle is deliberately NOT used: a chat request is a message event and the
     * docs reserve CallStyle for telephony.
     * https://developer.android.com/develop/ui/views/notifications/conversations
     *
     * Accept opens the conversation via the same peerIntent a message tap uses;
     * if the request is still pending the in-app ChatRingScreen handles accept/decline.
     * Decline broadcasts to ChatRequestReceiver, which hands it to a headless JS
     * task (ChatRequestDeclineService) that calls decline_session_request
     * without opening the UI and clears this notification only once the server
     * has taken the Decline.
     *
     * [inApp] means what it means on [notify]: the foreground post, same
     * notification, on [CHANNEL_IN_APP], so it peeks without a sound. So does
     * [silent]: this request is ringing full screen in the app, so the post
     * goes to the shade with no banner over the ring, and is still there if the
     * provider leaves before answering (see [Route.silencedIf]).
     */
    fun notifyChatRequest(
        context: Context,
        conversationId: String,
        peerId: String,
        senderName: String,
        requestId: String,
        sentAt: Long,
        avatarUrl: String? = null,
        inApp: Boolean = false,
        silent: Boolean = false,
        recipientId: String? = null,
    ) {
        ensureChannel(context)

        val manager = NotificationManagerCompat.from(context)
        val id = notificationId(conversationId)
        // This post's route; its photo fill takes the live one, as in notify().
        val route = route(manager, conversationId, inApp)?.silencedIf(silent) ?: return
        val accept = openConversation(context, peerId, recipientId)

        val declineIntent = Intent(ChatRequestReceiver.ACTION_DECLINE)
            .setClass(context, ChatRequestReceiver::class.java)
            .putExtra(ChatRequestReceiver.EXTRA_REQUEST_ID, requestId)
            .putExtra(ChatRequestReceiver.EXTRA_CONVERSATION_ID, conversationId)
        val decline = android.app.PendingIntent.getBroadcast(
            context,
            requestId.hashCode(),
            declineIntent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )

        fun post(
            style: NotificationCompat.MessagingStyle,
            icon: IconCompat?,
            via: Route,
            photoFill: Boolean = false,
        ) {
            val person = Person.Builder()
                .setKey(peerId)
                .setName(senderName)
                .setImportant(true)
                .apply { if (icon != null) setIcon(icon) }
                .build()

            val shortcut = ShortcutInfoCompat.Builder(context, conversationId)
                .setShortLabel(senderName)
                .setLongLabel(senderName)
                .setIcon(icon ?: IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                .setLongLived(true)
                .setPerson(person)
                .setCategories(setOf(SHARE_CATEGORY))
                .setIntent(peerIntent(context, peerId, recipientId))
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)

            val notification = NotificationCompat.Builder(context, via.channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(BRAND_COLOR)
                .setStyle(style)
                .setShortcutId(conversationId)
                .addPerson(person)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                // Which request this is, for a process that did not post it
                // (`clearRequest`); a message post over it carries none.
                .addExtras(android.os.Bundle().apply { putString(EXTRA_REQUEST_ID, requestId) })
                // Same channel, defaults and flags, for the same reasons, as
                // notify(): an in-app post peeks without a sound, a post that
                // carries the person's quieter choice across channels or was
                // asked to be silent is quiet, and a photo fill never alerts a
                // second time.
                .setDefaults(
                    if (inApp) 0 else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE,
                )
                .setContentIntent(accept)
                .setAutoCancel(true)
                .setSilent(via.quiet)
                .setOnlyAlertOnce(photoFill)
                .addAction(
                    NotificationCompat.Action.Builder(
                        R.drawable.ic_notification,
                        "Accept",
                        accept,
                    ).build(),
                )
                .addAction(
                    NotificationCompat.Action.Builder(
                        R.drawable.ic_notification,
                        "Decline",
                        decline,
                    ).build(),
                )
                .build()
            try {
                manager.notify(id, notification)
            } catch (denied: SecurityException) {
                // POST_NOTIFICATIONS revoked; swallowed as in notify().
            }
        }

        val version = synchronized(postLock) {
            val style = activeMessagingStyle(manager, id)
                ?: NotificationCompat.MessagingStyle(
                    Person.Builder().setName(context.getString(R.string.you)).build(),
                )
            style.addMessage(
                "wants to have a chat with you",
                sentAt,
                Person.Builder()
                    .setKey(peerId)
                    .setName(senderName)
                    .setImportant(true)
                    .build(),
            )
            post(style, null, route)
            stampPostLocked(id).also { requestPosts[id] = RequestPost(requestId, it) }
        }

        if (avatarUrl != null) {
            avatarExecutor.execute {
                val icon = loadAvatarBitmap(avatarUrl, AVATAR_MAX_PX)
                    ?.let { personIcon(it) }
                    ?: return@execute
                // Same live re-read as notify(), transcript and route both: a
                // second post can land while the photo downloads, on either
                // channel, and a notification `clear` or `clearAll` cancelled
                // stays cancelled even while the system still lists it
                // (`stillCurrentLocked`). The lock-screen Decline clears through
                // `clearRequest`, so a declined request stays gone too; only a
                // tap or a swipe between this read and the post is undone.
                synchronized(postLock) {
                    if (!stillCurrentLocked(id, version)) return@execute
                    val live = activeNotification(manager, id) ?: return@execute
                    val style = NotificationCompat.MessagingStyle
                        .extractMessagingStyleFromNotification(live)
                        ?: return@execute
                    post(withSenderIcon(style, peerId, icon), icon, liveRoute(live, route), photoFill = true)
                }
            }
        }
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
        medium: String,
        recipientId: String?,
    ): android.app.PendingIntent {
        /*
         * `medium` is part of the link, not just the notification's subtext.
         *
         * App.tsx parses `medium=` and defaults to 'voice' when it is absent, so
         * omitting it here opened a VOICE CallScreen for an incoming VIDEO call
         * — every video call answered from the notification lost its camera,
         * silently, because the fallback is a legitimate value. Reported from a
         * device 2026-09-08.
         */
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(
                withRecipient(
                    Uri.parse(
                        "companionchat://call/$peerId?callId=$callId&action=$action&medium=$medium",
                    ),
                    recipientId,
                ),
            )
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return android.app.PendingIntent.getActivity(
            context,
            (callId + action).hashCode(),
            intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }


    /**
     * A Person's photo, cut to a circle here rather than left to the system.
     *
     * The platform docs do not say what shape a Person icon is drawn in, and
     * the answer differs by surface: MessagingStyle avatars come out round, but
     * One UI draws a CallStyle caller's photo as the square it was given (S22,
     * 2026-10-03, Amit: "square instead of circle.. copy this from whatsapp").
     * A bitmap that is already a circle reads the same under either treatment,
     * so every Person icon goes through here: one shape on every surface.
     * https://developer.android.com/develop/ui/views/notifications/call-style
     */
    private fun personIcon(bitmap: android.graphics.Bitmap): IconCompat {
        val side = minOf(bitmap.width, bitmap.height)
        val out = android.graphics.Bitmap.createBitmap(side, side, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG or android.graphics.Paint.FILTER_BITMAP_FLAG)
        canvas.drawCircle(side / 2f, side / 2f, side / 2f, paint)
        paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
        // Centre-crop: the middle square of a portrait or landscape photo.
        canvas.drawBitmap(
            bitmap,
            -(bitmap.width - side) / 2f,
            -(bitmap.height - side) / 2f,
            paint,
        )
        return IconCompat.createWithBitmap(out)
    }

    /**
     * Photos already fetched in this process, by URL and decode size.
     *
     * A face the last ring or message downloaded is not downloaded again: the
     * fetch has a 1.5 s budget, and on a slow network a second ring from the
     * same person could lose the photo the first one had. Small, because a
     * handful of people ring or message in one process's life; LruCache sizes
     * by count here.
     * https://developer.android.com/reference/android/util/LruCache
     */
    private val avatarCache = android.util.LruCache<String, android.graphics.Bitmap>(16)

    /**
     * Download a photo and decode it, for the Person icon or the BigPicture.
     *
     * Runs on [avatarExecutor], never on the bridge thread that asked for the
     * notification. Every failure (offline, timeout, a 404, a decode error)
     * returns null so the notification simply keeps the plain version it already
     * posted: a message arriving is not a moment to throw.
     *
     * Two guards on the way in:
     *  - A photo URL may be the bundled-art sentinel `clay:<seed>` rather than an
     *    address (see `isClayUri` in src/lib/username.ts). `URL()` throws
     *    MalformedURLException on it, which cost every clay-avatar notification
     *    its icon, so anything that is not http(s) is skipped rather than fetched.
     *  - 1.5 s, not 4 s: a ring that waits four seconds for a face has already
     *    missed the ring.
     *
     * [longestEdgePx] bounds the decode with `inSampleSize` — a notification icon
     * is drawn at a few tens of dp, so decoding a 2048px bitmap to fill it burned
     * ~16 MB per push.
     */
    private fun loadAvatarBitmap(url: String, longestEdgePx: Int): android.graphics.Bitmap? {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return null
        }
        val key = "$longestEdgePx:$url"
        avatarCache.get(key)?.let { return it }
        return try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 1500
                readTimeout = 1500
            }
            val bytes = connection.inputStream.use { it.readBytes() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / sample > longestEdgePx) {
                sample *= 2
            }
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                ?.also { avatarCache.put(key, it) }
        } catch (error: Exception) {
            // The class only: the URL may be a signed link.
            android.util.Log.w(CALL_LOG_TAG, "avatar fetch failed: ${error.javaClass.simpleName}")
            null
        }
    }

    /**
     * Clear a conversation's notification once it has been read in the app.
     *
     * Under [postLock], and it throws the id's post stamp away in the same
     * hold. The lock alone is not enough: the cancel is applied later, on the
     * system's own handler, and until then the notification is still listed
     * as active, so a photo fill waiting on the lock would find it and post it
     * back. With the stamp gone the fill stands down (`stillCurrentLocked`),
     * and a text post does not extend the cleared transcript
     * (`activeMessagingStyle`). See `postLock`.
     */
    fun clear(context: Context, conversationId: String) {
        synchronized(postLock) {
            cancelLocked(NotificationManagerCompat.from(context), notificationId(conversationId))
        }
    }

    /** [clear]'s cancel and its record. Under [postLock]. */
    private fun cancelLocked(manager: NotificationManagerCompat, id: Int) {
        manager.cancel(id)
        posted.remove(id)
        requestPosts.remove(id)
        cleared.add(id)
    }

    /**
     * Clear a chat request's notification once its lock-screen Decline has
     * landed, but only while what is posted there is still that request.
     *
     * The Decline runs as a headless task (`declineFromNotification`), and
     * between the press and the RPC's answer there is a React cold start and a
     * round trip. A message the provider sent meanwhile replaces the request's
     * entry at the same id, and alerts, and an unconditional [clear] then
     * cancelled it: a message nobody had seen, cancelled on the strength of an
     * answer to something else, which the platform says not to do.
     * https://developer.android.com/develop/ui/views/notifications/conversations#best-practices
     *
     * A process that has posted at this id since its last clear knows what is
     * there: the request, only if [requestPosts] holds it at the id's current
     * version. One that has not (the Decline started a new process) reads the
     * live notification, whose extras name the request it was posted for,
     * unless this process cleared the id and the system still lists it
     * (`liveTrustedLocked`).
     */
    fun clearRequest(context: Context, conversationId: String, requestId: String) {
        synchronized(postLock) {
            val manager = NotificationManagerCompat.from(context)
            val id = notificationId(conversationId)
            val stillTheRequest = if (posted.containsKey(id)) {
                requestPosts[id] == RequestPost(requestId, posted.getValue(id))
            } else {
                liveTrustedLocked(id) &&
                    activeNotification(manager, id)?.extras?.getString(EXTRA_REQUEST_ID) == requestId
            }
            if (stillTheRequest) {
                cancelLocked(manager, id)
            }
        }
    }

    /**
     * Take everything the signed-in account put on this device out of it:
     * every notification this app posted and every conversation shortcut.
     * Called on sign-out and after account deletion (src/lib/conversations.ts).
     *
     * Without it, one account's MessagingStyle entries stayed in the shade and
     * on the lock screen after it signed out, its long-lived shortcuts stayed
     * in direct share and the launcher, and a tap on either opened
     * `companionchat://peer/<id>` inside whichever account signed in next.
     *
     * Notifications: `cancelAll`, because every one this app posts (messages,
     * requests, nudges, a call's ring) belongs to the session that is ending.
     * A foreground service's own notification is not removed by it ("If the
     * notification does not currently represent a foreground service ... it
     * will be removed"), so a call in progress keeps its ongoing notification.
     * Under [postLock], with every stamp thrown away and [clearedAll] set, for
     * the reason [clear] does it: the cancels are applied later, and a fill
     * or a text post must not bring any of it back meanwhile.
     * https://developer.android.com/reference/android/app/NotificationManager#cancelAll()
     *
     * Shortcuts: the dynamic list AND the cached copies. `pushDynamicShortcut`
     * publishes each conversation's shortcut as long-lived, and "if a shortcut
     * is set as long-lived, it may still be available in the system as a
     * cached shortcut even after being removed from the list of dynamic
     * shortcuts" (ShortcutManagerCompat#removeAllDynamicShortcuts), so the
     * cached ones are listed (FLAG_MATCH_CACHED) and removed by id with
     * `removeLongLivedShortcuts`. Pinned shortcuts are the person's own and
     * are left where they put them.
     * https://developer.android.com/reference/androidx/core/content/pm/ShortcutManagerCompat#removeLongLivedShortcuts(android.content.Context,java.util.List%3Cjava.lang.String%3E)
     *
     * The shortcuts go under [postLock] too, in the same hold as the cancel.
     * Every `pushDynamicShortcut` runs inside a post, and every post holds the
     * lock. With the removal after the release, a post that took the lock in
     * between (the next account's first message) pushed its shortcut and
     * posted, and the removal then deleted that shortcut under a live
     * notification whose `shortcutId` now names nothing, which Android demotes
     * out of the conversation section. Inside the lock a post lands either
     * wholly before the sign-out, and is cleared with it, or wholly after.
     * The removal is three Binder calls, the same size as a post's own hold.
     */
    fun clearAll(context: Context) {
        synchronized(postLock) {
            NotificationManagerCompat.from(context).cancelAll()
            posted.clear()
            requestPosts.clear()
            cleared.clear()
            clearedAll = true
            val ids = ShortcutManagerCompat.getShortcuts(
                context,
                ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED,
            ).map { it.id }
            if (ids.isNotEmpty()) {
                ShortcutManagerCompat.removeLongLivedShortcuts(context, ids)
            }
            ShortcutManagerCompat.removeAllDynamicShortcuts(context)
        }
    }

    private fun openConversation(context: Context, peerId: String, recipientId: String? = null) =
        android.app.PendingIntent.getActivity(
            context,
            peerId.hashCode(),
            peerIntent(context, peerId, recipientId)
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
    private fun peerIntent(context: Context, peerId: String, recipientId: String? = null): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(withRecipient(Uri.parse("companionchat://peer/$peerId"), recipientId))

    /**
     * [uri] with `for=<recipientId>` appended, when the push named its account.
     *
     * A tap can land long after the post: a notification or a long-lived
     * shortcut left from an account that has since signed out, or one posted
     * during the overlap before its sign-out finished. The link used to name
     * only the peer, so App.tsx opened that peer's chat inside whichever
     * account was signed in when it arrived. With the account on the link,
     * App.tsx opens it only for that account. `appendQueryParameter` encodes
     * the value, and the JS side passes only a uuid (conversations.ts).
     * https://developer.android.com/reference/android/net/Uri.Builder#appendQueryParameter(java.lang.String,%20java.lang.String)
     */
    private fun withRecipient(uri: Uri, recipientId: String?): Uri =
        if (recipientId.isNullOrEmpty()) {
            uri
        } else {
            uri.buildUpon().appendQueryParameter("for", recipientId).build()
        }

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
