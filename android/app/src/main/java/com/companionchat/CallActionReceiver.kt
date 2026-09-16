package com.companionchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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
        ReactBridgeEvents.emit(context, eventName, data)
    }
}
