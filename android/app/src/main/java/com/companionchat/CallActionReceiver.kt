package com.companionchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Receives answer/decline/hang-up actions from CallStyle notification buttons.
 * Forwards the action to React Native as a device event so CallScreen can react.
 * Stops the foreground service on decline/hang-up.
 */
class CallActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            CallForegroundService.ACTION_ANSWER -> {
                emitToRN(context, "callAction", "answer")
            }
            CallForegroundService.ACTION_DECLINE -> {
                emitToRN(context, "callAction", "decline")
                CallForegroundService.stop(context)
            }
            CallForegroundService.ACTION_HANG_UP -> {
                emitToRN(context, "callAction", "hangUp")
                CallForegroundService.stop(context)
            }
        }
    }

    private fun emitToRN(context: Context, eventName: String, data: String) {
        val reactContext = (context.applicationContext as? com.companionchat.MainApplication)
            ?.reactNativeHost
            ?.reactInstanceManager
            ?.currentReactContext as? ReactContext
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(eventName, data)
    }
}
