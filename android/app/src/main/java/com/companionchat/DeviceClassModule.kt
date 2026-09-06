package com.companionchat

import android.app.ActivityManager
import android.content.Context
import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * Minimal ReactPackage so DeviceClassModule can be registered in
 * MainApplication without touching InAppUpdatePackage.
 */
class DeviceClassPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(DeviceClassModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}

/**
 * Reports the device's performance class so the JS layer can degrade blur
 * quality gracefully on low-RAM Android 12+ devices.
 *
 * Three tiers:
 *   low     — isLowRamDevice() = true; blur off (Frost shows the plate fallback)
 *   average — total RAM < 4 GB; blurRounds reduced to 1
 *   high    — total RAM ≥ 4 GB; full blur
 *
 * WHY this module exists alongside the API-31 guard in BlurPackage:
 *
 *   BlurPackage and BlurSurface.tsx already gate on `SDK_INT >= 31 &&
 *   canvas.isHardwareAccelerated`, which covers Android 7–11 (no RenderEffect).
 *   That is the worst low-end case by API level. The remaining gap is an API 31+
 *   device with very little RAM — a cheap Android One phone with 1–2 GB running
 *   Android 12. The API-level guard allows full blur there; this module gates it.
 *
 * https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()
 * https://developer.android.com/reference/android/app/ActivityManager#getMemoryInfo(android.app.ActivityManager.MemoryInfo)
 */
class DeviceClassModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Returns "low", "average", or "high" synchronously.
     *
     * Synchronous because the class is needed at module-import time in JS —
     * before the first rendered frame — to decide whether to mount BlurSurface.
     * A Promise-based query would return too late. The native call is a single
     * ActivityManager lookup with no I/O or lock contention, so the JS thread
     * cost is negligible.
     *
     * Classification:
     *   isLowRamDevice() = true       → "low"   (OS-flagged, typically ≤ 1 GB)
     *   totalMem < AVERAGE_RAM_BYTES  → "average"
     *   otherwise                     → "high"
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getDeviceClass(): String {
        val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return CLASS_HIGH // Defensive: unknown system service → assume capable

        // isLowRamDevice() is set by OEMs on devices with ≤ 1 GB RAM and is the
        // signal Android itself uses to enable low-memory trimming. Trusting it is
        // preferable to re-implementing the heuristic from total RAM alone.
        // https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()
        if (am.isLowRamDevice) return CLASS_LOW

        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        // totalMem is in bytes. The 4 GB boundary is empirical: devices below it
        // (e.g. budget Android One or Pixel A series) get blurRounds = 1 (reduced).
        // Devices at or above it (e.g. S22 with 8 GB) get full quality. Re-evaluate
        // if a benchmark shows the threshold is wrong for a target device.
        // https://developer.android.com/reference/android/app/ActivityManager#getMemoryInfo(android.app.ActivityManager.MemoryInfo)
        return if (info.totalMem < AVERAGE_RAM_BYTES) CLASS_AVERAGE else CLASS_HIGH
    }

    companion object {
        const val NAME = "DeviceClass"
        const val CLASS_LOW = "low"
        const val CLASS_AVERAGE = "average"
        const val CLASS_HIGH = "high"

        /** 4 GB in bytes — boundary between average and high class. */
        private const val AVERAGE_RAM_BYTES = 4L * 1024L * 1024L * 1024L
    }
}
