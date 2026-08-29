package com.companionchat

import android.app.Activity
import com.android.billingclient.api.*
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*

/**
 * React Native native module for Google Play Billing (PBL 9.1) and
 * User Choice Billing (UCB).
 *
 * UCB (India Play Billing Programme) requires both Google Play and the
 * alternative billing system (Cashfree) to be shown simultaneously, above
 * the fold, with equal visual weight. We use GOOGLE_RENDERED (Scenario 1A),
 * meaning Play renders the payment sheet. If the user picks the alternative,
 * Play calls onUserChoiceAlternativeBilling and we launch the Cashfree flow.
 *
 * Important threading constraint: launchBillingFlow() MUST be called on the
 * main thread. All calls gate on UiThreadUtil.runOnUiThread.
 *
 * doc: developer.android.com/google/play/billing/integrate
 * doc: developer.android.com/google/play/billing/user-choice-billing
 * ADR-0022
 */
class BillingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BillingModule"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (purchase in purchases) {
                scope.launch { handlePurchase(purchase) }
            }
        } else {
            emit("billingEvent", Arguments.createMap().apply {
                putString("type", "error")
                putInt("code", billingResult.responseCode)
                putString("message", billingResult.debugMessage)
            })
        }
    }

    private val alternativeBillingListener = AlternativeChoiceDetails.Listener { details ->
        // User chose the alternative (Cashfree) path in the UCB sheet.
        // Forward the external transaction token to JS for the Cashfree flow.
        // ADR-0022: this token links the Play reporting record to the Cashfree order.
        emit("billingEvent", Arguments.createMap().apply {
            putString("type", "alternativeChosen")
            putString("externalTransactionToken", details.externalTransactionToken)
        })
    }

    private var billingClient: BillingClient? = null

    private fun getOrBuildClient(): BillingClient {
        return billingClient ?: BillingClient.newBuilder(reactContext)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
            )
            .enableUserChoiceBilling(alternativeBillingListener)
            .build()
            .also { billingClient = it }
    }

    /** Connect (or confirm already connected) before any billing operation. */
    private suspend fun ensureConnected(): Boolean {
        val client = getOrBuildClient()
        if (client.isReady) return true
        return suspendCancellableCoroutine { cont ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    cont.resume(result.responseCode == BillingClient.BillingResponseCode.OK)
                }
                override fun onBillingServiceDisconnected() {
                    cont.resume(false)
                }
            })
        }
    }

    /**
     * Acknowledge a purchase and emit a server-verification event to JS.
     *
     * IMPORTANT: acknowledging before server verification is safe because
     * Play refunds unacknowledged purchases after 3 days. However, token
     * entitlement is only granted after server-side purchase verification.
     * The client acknowledges to prevent the automatic refund; the server
     * grants the tokens.
     *
     * developer.android.com/google/play/billing/integrate#process_the_purchase
     */
    private suspend fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED && !purchase.isAcknowledged) {
            val params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build()
            val result = billingClient?.acknowledgePurchase(params)
            if (result?.responseCode == BillingClient.BillingResponseCode.OK) {
                emit("billingEvent", Arguments.createMap().apply {
                    putString("type", "purchaseAcknowledged")
                    putString("purchaseToken", purchase.purchaseToken)
                    putString("productId", purchase.products.firstOrNull() ?: "")
                    putString("orderId", purchase.orderId ?: "")
                })
            }
        }
    }

    /**
     * Open the UCB recharge sheet for a given Play product SKU.
     *
     * MUST be called from JS on the main thread; this method itself gates the
     * launchBillingFlow call on UiThreadUtil.runOnUiThread as a safety net.
     *
     * developer.android.com/google/play/billing/user-choice-billing#scenario-1a
     */
    @ReactMethod
    fun openRechargeSheet(sku: String, promise: Promise) {
        scope.launch {
            val connected = ensureConnected()
            if (!connected) {
                promise.reject("BILLING_UNAVAILABLE", "Play Billing service not available")
                return@launch
            }

            val client = billingClient ?: run {
                promise.reject("BILLING_UNAVAILABLE", "BillingClient not initialised")
                return@launch
            }

            // Query product details before launching flow.
            val queryParams = QueryProductDetailsParams.newBuilder()
                .setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(sku)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                ))
                .build()

            val (billingResult, productDetailsList) = client.queryProductDetails(queryParams)
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK ||
                productDetailsList.isNullOrEmpty()
            ) {
                promise.reject("PRODUCT_NOT_FOUND", "Product $sku not found: ${billingResult.debugMessage}")
                return@launch
            }

            val productDetails = productDetailsList.first()

            // UCB: create reporting details so Play can link this purchase to
            // the billing programme report. Required for Scenario 1A.
            val reportingDetailsResult = client.createBillingProgramReportingDetails()
            val reportingDetails = when {
                reportingDetailsResult.billingResult.responseCode ==
                    BillingClient.BillingResponseCode.OK -> reportingDetailsResult.externalTransactionToken
                else -> null
            }

            val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(productDetails)
                .build()

            val flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productDetailsParams))
                .apply {
                    if (reportingDetails != null) {
                        setExternalTransactionToken(reportingDetails)
                    }
                }
                .build()

            // launchBillingFlow must run on the main thread.
            UiThreadUtil.runOnUiThread {
                val activity: Activity? = currentActivity
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "No foreground activity")
                    return@runOnUiThread
                }
                val launchResult = client.launchBillingFlow(activity, flowParams)
                if (launchResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    promise.resolve(null)
                } else {
                    promise.reject("LAUNCH_FAILED", launchResult.debugMessage)
                }
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) { /* required for RCTEventEmitter */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* required for RCTEventEmitter */ }

    override fun invalidate() {
        super.invalidate()
        billingClient?.endConnection()
        billingClient = null
        scope.cancel()
    }

    private fun emit(name: String, data: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, data)
    }
}
