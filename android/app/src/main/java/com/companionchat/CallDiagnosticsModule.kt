package com.companionchat

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * PII-free Android process/network diagnostics sampled alongside RTC stats.
 *
 * Android requires NetworkCallback rather than polling activeNetwork because
 * synchronous reads race capability changes. The callback is explicitly
 * unregistered when the call ends.
 * https://developer.android.com/develop/connectivity/network-ops/reading-network-state
 */
class CallDiagnosticsModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
    private val connectivity =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var transport: String = "unknown"

    override fun getName(): String = "CallDiagnostics"

    @ReactMethod
    fun start() {
        if (callback != null) return
        val next = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                updateTransport(capabilities)
            }

            override fun onLost(network: Network) {
                transport = "none"
                emit()
            }
        }
        callback = next
        connectivity.registerDefaultNetworkCallback(next)
    }

    @ReactMethod
    fun stop() {
        callback?.let {
            try {
                connectivity.unregisterNetworkCallback(it)
            } catch (_: IllegalArgumentException) {
                // Already unregistered by process/network teardown.
            }
        }
        callback = null
    }

    @ReactMethod
    fun snapshot(promise: Promise) {
        val values = Arguments.createMap()
        values.putString("networkTransport", transport)
        values.putDouble("rssBytes", Debug.getPss().toDouble() * 1024.0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            values.putInt("thermalStatus", power.currentThermalStatus)
        }
        promise.resolve(values)
    }

    // Required by React Native's event-emitter contract.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit

    private fun updateTransport(capabilities: NetworkCapabilities) {
        transport = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        emit()
    }

    private fun emit() {
        if (!context.hasActiveReactInstance()) return
        context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("callNetworkChanged", transport)
    }
}
