package com.companionchat

import android.app.Activity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Google Play in-app updates.
 *
 * Deliberately thin: this reports what Play says and starts the flow Play
 * provides. Every decision about *which* flow and *whether to ask at all* lives
 * in `src/lib/appUpdate.ts`, because that is a policy question and policy is
 * worth unit-testing. Nothing here can be tested without Play, so there is as
 * little here as possible.
 *
 * There are no events. The official sample registers an InstallStateUpdatedListener,
 * but the same guide also polls `appUpdateInfo` in `onResume` to catch an update
 * that finished downloading while the app was away, and that poll subsumes the
 * listener for our purposes. JS calls `check()` on mount and on foreground,
 * which is strictly simpler than bridging a listener and keeping it in step with
 * the React lifecycle.
 *
 * The `Activity` + `requestCode` overload of `startUpdateFlowForResult` is used
 * rather than the `ActivityResultLauncher` one. The launcher variant is the
 * modern form but must be registered on the Activity before it resumes, which a
 * React Native module does not own; the Activity overload is still present in
 * app-update 2.1.0 and is what a native module can actually reach.
 */
class InAppUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private val manager: AppUpdateManager by lazy {
        AppUpdateManagerFactory.create(reactContext)
    }

    /**
     * What Play currently thinks. Resolves rather than rejects on "no update",
     * because that is the normal case and not an error.
     *
     * Off Play entirely, a sideloaded APK, an emulator without Play Store,
     * this fails, and it fails by resolving `available: false`. An update check
     * is never important enough to surface an error to someone who is simply
     * running a debug build.
     */
    @ReactMethod
    fun check(promise: Promise) {
        try {
            manager.appUpdateInfo
                .addOnSuccessListener { info ->
                    val result: WritableMap = Arguments.createMap()
                    val availability = info.updateAvailability()
                    result.putBoolean(
                        "available",
                        availability == UpdateAvailability.UPDATE_AVAILABLE,
                    )
                    // A previously started immediate update that did not finish.
                    // The guide says to resume it on the next foreground.
                    result.putBoolean(
                        "immediateInProgress",
                        availability ==
                            UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS,
                    )
                    result.putBoolean(
                        "downloaded",
                        info.installStatus() == InstallStatus.DOWNLOADED,
                    )
                    result.putBoolean(
                        "flexibleAllowed",
                        info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
                    )
                    result.putBoolean(
                        "immediateAllowed",
                        info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
                    )
                    result.putInt("priority", info.updatePriority())
                    // Nullable in the API: null means Play does not know how long
                    // this client has been behind. -1 keeps the JS side free of a
                    // null check that would only ever mean "no idea".
                    result.putInt("stalenessDays", info.clientVersionStalenessDays() ?: -1)
                    result.putInt("availableVersionCode", info.availableVersionCode())
                    promise.resolve(result)
                }
                .addOnFailureListener {
                    promise.resolve(unavailable())
                }
        } catch (error: Throwable) {
            promise.resolve(unavailable())
        }
    }

    private fun unavailable(): WritableMap {
        val result: WritableMap = Arguments.createMap()
        result.putBoolean("available", false)
        result.putBoolean("immediateInProgress", false)
        result.putBoolean("downloaded", false)
        result.putBoolean("flexibleAllowed", false)
        result.putBoolean("immediateAllowed", false)
        result.putInt("priority", 0)
        result.putInt("stalenessDays", -1)
        result.putInt("availableVersionCode", 0)
        return result
    }

    private fun start(type: Int, promise: Promise) {
        // `reactContext.currentActivity`, not the base class property: the
        // module's own accessor is not visible from Kotlin here, and an unresolved
        // reference cascades into an overload-resolution failure on
        // startUpdateFlowForResult that looks like a different bug entirely.
        val activity: Activity? = reactContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        try {
            manager.appUpdateInfo
                .addOnSuccessListener { info ->
                    // Each AppUpdateInfo can start exactly one flow, which is why
                    // it is fetched here rather than cached from check().
                    if (info.isUpdateTypeAllowed(type)) {
                        manager.startUpdateFlowForResult(
                            info,
                            activity,
                            AppUpdateOptions.newBuilder(type).build(),
                            REQUEST_CODE,
                        )
                        promise.resolve(true)
                    } else {
                        promise.resolve(false)
                    }
                }
                .addOnFailureListener { promise.resolve(false) }
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun startFlexible(promise: Promise) = start(AppUpdateType.FLEXIBLE, promise)

    @ReactMethod
    fun startImmediate(promise: Promise) = start(AppUpdateType.IMMEDIATE, promise)

    /**
     * Install a flexible update that has finished downloading. This restarts the
     * app, so the caller must have asked first.
     */
    @ReactMethod
    fun complete(promise: Promise) {
        try {
            manager.completeUpdate()
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    companion object {
        const val NAME = "InAppUpdate"

        /** Any value; the result is not observed, only the flow's side effects. */
        private const val REQUEST_CODE = 4711
    }
}
