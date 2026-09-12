package com.companionchat

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.view.View
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/** Registration shim, matching DeviceClassPackage. */
class RecentMediaPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(RecentMediaModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}

/**
 * Recent photos for the attachment panel's in-app strip, under Android 14's
 * PARTIAL photo access and nothing wider.
 *
 * ## Why this exists at all
 *
 * The panel's Photos tile already opens the system photo picker, which needs no
 * permission and reaches the whole library
 * (developer.android.com/training/data-storage/shared/photopicker). That stays.
 * What it cannot do is show thumbnails INSIDE our own panel, because the picker
 * owns its own UI and hands back only what the user chose. Showing a strip of
 * real recent photos means querying MediaStore ourselves, and that needs a
 * permission.
 *
 * ## Why ONLY READ_MEDIA_VISUAL_USER_SELECTED
 *
 * This is the deliberate, load-bearing constraint of this module, so it is
 * written down rather than left to be rediscovered.
 *
 * developer.android.com/about/versions/14/changes/partial-photo-video-access
 * shows the full pattern as requesting READ_MEDIA_IMAGES, READ_MEDIA_VIDEO and
 * READ_MEDIA_VISUAL_USER_SELECTED together in one call. We deliberately do NOT,
 * and the consequence is real: without READ_MEDIA_IMAGES in the request, the
 * system dialog offers "Select photos" and "Don't allow" but NOT "Allow all".
 * Every user can therefore only ever grant a SUBSET, and this query only ever
 * returns that subset.
 *
 * That is the intended behaviour, not a limitation to route around.
 * READ_MEDIA_IMAGES is a Play RESTRICTED permission
 * (support.google.com/googleplay/android-developer/answer/14115180): it may be
 * requested only when "system pickers... are not sufficient for your app to
 * provide core functionality", and it requires a Permissions Declaration Form.
 * For a chat app attaching a photo, the system picker IS sufficient by Google's
 * own reckoning — we ship it as the Photos tile — so that declaration would be
 * arguing against our own UI, and a rejected form blocks releases.
 *
 * So the strip is a SHORTCUT to photos the user has explicitly shared with us,
 * and the picker remains the route to everything else. Nothing is lost.
 *
 * ## Version floor
 *
 * READ_MEDIA_VISUAL_USER_SELECTED arrived in API 34 and does not exist below
 * it. On API 24–33 this module reports "unsupported" and the panel keeps the
 * Photos tile alone. The alternative would be READ_EXTERNAL_STORAGE (<=32) or
 * READ_MEDIA_IMAGES (33) — the first is broad legacy storage access and the
 * second is the restricted permission above, so on older devices the honest
 * answer is to show no strip rather than to ask for more than we asked newer
 * devices for.
 */
class RecentMediaModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * "granted", "denied", or "unsupported". Never cached.
     *
     * The docs are explicit that the grant is not durable: "Don't store the
     * permission state in a permanent way, including SharedPreferences or
     * DataStore. The stored state might not be in sync with the actual state."
     * A partial grant can also expire on its own. So JS calls this every time
     * the panel opens rather than remembering an answer.
     */
    @ReactMethod
    fun getAccess(promise: Promise) {
        promise.resolve(currentAccess())
    }

    private fun currentAccess(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return UNSUPPORTED
        }
        val granted = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) GRANTED else DENIED
    }

    /**
     * Show the system's photo-selection dialog and resolve with the new state.
     *
     * MUST be called from a user gesture. The docs require it in as many words:
     * "Create a UI element in your app that the user must press before you
     * re-request... The user shouldn't be surprised to see the system dialog
     * again." This is also the re-selection path — calling it again while
     * already granted is how the user adds more photos, which is why there is
     * no early return for the already-granted case.
     */
    @ReactMethod
    fun requestAccess(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            promise.resolve(UNSUPPORTED)
            return
        }
        val activity = reactContext.currentActivity
        if (activity !is PermissionAwareActivity) {
            // No activity to host the dialog — a backgrounded app, or a teardown
            // race. Report the state we can still read rather than rejecting;
            // the caller's job is to render a strip, not to handle an exception.
            promise.resolve(currentAccess())
            return
        }
        val listener = PermissionListener { _, _, _ ->
            /*
             * The grantResults array is deliberately ignored in favour of
             * re-reading with checkSelfPermission. On this flow they disagree:
             * the user can dismiss the sheet having selected photos, and the
             * authoritative answer is what the package manager now holds, not
             * what the callback reports about the request.
             */
            promise.resolve(currentAccess())
            true
        }
        activity.requestPermissions(
            arrayOf(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED),
            REQUEST_CODE,
            listener,
        )
    }

    /**
     * The most recent images the app can see, newest first, as content:// URIs.
     *
     * Returns content URIs rather than thumbnails. React Native's Image renders
     * a content:// URI directly through Fresco, which decodes and downsamples to
     * the view's size on its own background thread — so routing bitmaps across
     * the bridge would be slower AND heavier than letting the image pipeline do
     * what it is for. That also sidesteps ContentResolver.loadThumbnail, which
     * is synchronous, throws on a stale URI, and does not exist below API 29.
     *
     * Under partial access this cursor returns ONLY the user's selection; that
     * is the documented behaviour and the caller must not treat a short result
     * as an error.
     */
    @ReactMethod
    fun listRecent(limit: Int, promise: Promise) {
        if (currentAccess() != GRANTED) {
            promise.resolve(Arguments.createArray())
            return
        }
        try {
            promise.resolve(query(limit))
        } catch (e: SecurityException) {
            /*
             * A partial grant that expired between getAccess() and here. The
             * docs warn the access "expires eventually" and that the app
             * "should always handle the case of not having access". An empty
             * strip is the correct render for that, not a crash.
             */
            promise.resolve(Arguments.createArray())
        }
    }

    private fun query(limit: Int): WritableArray {
        val out = Arguments.createArray()
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
        )
        val order = "${MediaStore.Images.Media.DATE_ADDED} DESC"
        reactContext.contentResolver.query(collection, projection, null, null, order)
            ?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val wCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
                val hCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
                while (cursor.moveToNext() && out.size() < limit) {
                    val id = cursor.getLong(idCol)
                    val uri: Uri = android.content.ContentUris.withAppendedId(collection, id)
                    val item = Arguments.createMap()
                    item.putString("uri", uri.toString())
                    item.putInt("width", cursor.getInt(wCol))
                    item.putInt("height", cursor.getInt(hCol))
                    out.pushMap(item)
                }
            }
        return out
    }

    companion object {
        const val NAME = "RecentMedia"
        const val GRANTED = "granted"
        const val DENIED = "denied"
        const val UNSUPPORTED = "unsupported"

        /** Arbitrary, but must not collide with another module's. */
        private const val REQUEST_CODE = 7413
    }
}
