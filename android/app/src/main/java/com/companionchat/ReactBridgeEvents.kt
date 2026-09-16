package com.companionchat

import android.content.Context
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The one hop from native call plumbing to JS.
 *
 * Under the New Architecture `ReactApplication.reactNativeHost` is not merely
 * deprecated, its default getter throws, and MainApplication overrides only
 * `reactHost`. Reading the old property from a BroadcastReceiver or an audio
 * focus callback therefore killed the process rather than failing soft.
 * https://reactnative.dev/docs/the-new-architecture/landing-page
 */
internal object ReactBridgeEvents {

    /** No-ops when no React context exists: the process may be mid-teardown. */
    fun emit(context: Context, eventName: String, data: String) {
        val reactContext = (context.applicationContext as? MainApplication)
            ?.reactHost
            ?.currentReactContext
        reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(eventName, data)
    }
}
