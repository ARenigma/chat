/**
 * React Native API layer for Cashfree sandbox collections + Play Billing UCB.
 *
 * Sandbox path (non-production, ADR-0022):
 *   1. createOrder → Supabase Edge Function → Cashfree order with paymentSessionId.
 *   2. useCashfreeCheckout opens a Cashfree WebCheckout via doWebPayment(cfSession).
 *      (doc: https://www.cashfree.com/docs/payments/online/mobile/android — prefer
 *       WebCheckout; Drop checkout is deprecated as of 2023.)
 *   3. SDK onVerify(orderID) callback fires on apparent success — but the client
 *      callback CANNOT be trusted alone (doc: same page, "verify server-side").
 *      Call verify-order Edge Function which re-queries Cashfree S2S before
 *      crediting tokens.
 *   4. On verify success: invalidate profile queries so balance refreshes.
 *   5. On error/dismiss: surface a notice; do not credit.
 *
 * Production: still gated by PAYMENTS_ENABLED + UCB enrolment (ADR-0022).
 *
 * RULE 5 (CLAUDE.md): react-native-cashfree-pg-sdk is required for ADR-0022;
 * it has no React Native equivalent that avoids the native bridging for WebCheckout.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CFEnvironment,
  CFSession,
  CFThemeBuilder,
  CFUPIIntentCheckoutPayment,
  type CFTheme,
} from 'cashfree-pg-api-contract';
import {
  CFPaymentGatewayService,
  type CFCallback,
  type CFErrorResponse,
} from 'react-native-cashfree-pg-sdk';
import { supabase } from '../lib/supabase';
import { track } from '../lib/telemetry';
import { currentVersionCode } from '../lib/appUpdate';
import { CASHFREE_SANDBOX_CHECKOUT } from '../config';

// ---------------------------------------------------------------------------
// Play Billing (UCB) native bridge — kept for production path (ADR-0022).
// ---------------------------------------------------------------------------

const { BillingModule } = NativeModules;
const billingEmitter =
  Platform.OS === 'android' && BillingModule
    ? new NativeEventEmitter(BillingModule)
    : null;

export type BillingEvent =
  | { type: 'purchaseAcknowledged'; purchaseToken: string; productId: string; orderId: string }
  | { type: 'alternativeChosen'; externalTransactionToken: string }
  | { type: 'error'; code: number; message: string };

export function onBillingEvent(listener: (event: BillingEvent) => void): { remove: () => void } {
  if (!billingEmitter) return { remove: () => {} };
  return billingEmitter.addListener('billingEvent', listener);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface RechargeResult {
  orderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
}

interface VerifyResult {
  status: string;
  credited: boolean;
  balance?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the canonical Cashfree product ID for an amount in ₹.
 * 1 token = ₹1 (ADR-0022); product IDs match RECHARGE_PACKS in create-order.
 */
export function productIdForPack(amountInr: number): string {
  return `pappal_pack_${amountInr}`;
}

/** Step 1: create a pending Cashfree order on the server. Secrets stay server-side. */
async function createOrder(productId: string): Promise<RechargeResult> {
  // Send this build's versionCode so the server can refuse to charge a client
  // that predates the GST-inclusive recharge UI (it would show ₹300 but be
  // billed ₹354). Old builds send nothing and are rejected with 426; this build
  // sends a real code and proceeds. See the guard in supabase/functions/create-order.
  const { data, error } = await supabase.functions.invoke<RechargeResult>('create-order', {
    body: { productId, appVersionCode: currentVersionCode() },
  });
  if (error || !data) throw error ?? new Error('create-order returned no data');
  return data;
}

/** Step 3: server-side payment verification after SDK callback. */
async function verifyOrder(orderId: string): Promise<VerifyResult> {
  const { data, error } = await supabase.functions.invoke<VerifyResult>('verify-order', {
    body: { orderId },
  });
  if (error || !data) throw error ?? new Error('verify-order returned no data');
  return data;
}

// ---------------------------------------------------------------------------
// Cashfree sandbox WebCheckout
// ---------------------------------------------------------------------------

export interface CashfreeCheckoutResult {
  orderId: string;
  credited: boolean;
  balance?: number;
}

/** How the member pays. `upi` is the one-tap intent; `web` is the card/NB fallback. */
export type CashfreeMethod = 'upi' | 'web';

export interface CashfreeCheckoutVars {
  productId: string;
  /** Defaults to `upi` — the one-tap rail (ADR-0022, research 2026-08-30). */
  method?: CashfreeMethod;
}

/**
 * Pappal-branded checkout theme, applied to the UPI-intent surface so the SDK's
 * chrome carries the coral button and header rather than Cashfree's default blue.
 *
 * Values are the resolved brand tokens (design/tokens.json): accent #F2543D on
 * white with the app's ink for text. The hosted page's business NAME and LOGO
 * are dashboard settings, not SDK-themable — see cf-brand follow-up.
 *
 * doc: https://www.cashfree.com/docs/payments/online/mobile/react-native
 */
function pappalCheckoutTheme(): CFTheme {
  return new CFThemeBuilder()
    .setNavigationBarBackgroundColor('#F2543D')
    .setNavigationBarTextColor('#FFFFFF')
    .setButtonBackgroundColor('#F2543D')
    .setButtonTextColor('#FFFFFF')
    .setBackgroundColor('#FFFFFF')
    .setPrimaryTextColor('#1C1C1E')
    .setSecondaryTextColor('#55555A')
    .build();
}

/**
 * Opens a Cashfree checkout for a given product ID and pays.
 *
 * - `method: 'upi'` (default) → doUPIPayment(CFUPIIntentCheckoutPayment): the
 *   one-tap UPI intent. The SDK raises the installed-UPI-app chooser and
 *   deep-links into GPay / PhonePe / Paytm with the amount pre-filled — the
 *   single biggest completion lever (research 2026-08-30).
 * - `method: 'web'` → doWebPayment: the hosted page for cards / net-banking /
 *   wallets, kept as the fallback for members with no UPI app.
 *
 * Uses CFEnvironment.SANDBOX when CASHFREE_SANDBOX_CHECKOUT is true (all non-prod
 * builds). After the SDK fires onVerify, calls verify-order to confirm server-side
 * before crediting — never trusts the client callback alone.
 *
 * doc: https://www.cashfree.com/docs/payments/online/mobile/android
 * doc: https://www.cashfree.com/docs/payments/online/mobile/react-native
 */
export function useCashfreeCheckout() {
  const queryClient = useQueryClient();

  return useMutation<CashfreeCheckoutResult, Error, CashfreeCheckoutVars>({
    mutationFn: ({ productId, method = 'upi' }: CashfreeCheckoutVars) =>
      new Promise<CashfreeCheckoutResult>((resolve, reject) => {
        createOrder(productId)
          .then(order => {
            const environment = CASHFREE_SANDBOX_CHECKOUT
              ? CFEnvironment.SANDBOX
              : CFEnvironment.PRODUCTION;

            const session = new CFSession(
              order.paymentSessionId,
              order.orderId,
              environment,
            );

            const callback: CFCallback = {
              onVerify: (orderID: string) => {
                CFPaymentGatewayService.removeCallback();
                track('cashfree_checkout_verify', { orderId: orderID, method });
                // Server-side confirmation — never trust client callback alone.
                verifyOrder(orderID)
                  .then(result => resolve({ orderId: orderID, ...result }))
                  .catch(reject);
              },
              onError: (error: CFErrorResponse, orderID: string) => {
                CFPaymentGatewayService.removeCallback();
                track('cashfree_checkout_error', {
                  orderId: orderID,
                  method,
                  code: error.getCode(),
                  message: error.getMessage(),
                });
                reject(new Error(`Payment failed: ${error.getMessage()} (${error.getCode()})`));
              },
            };

            CFPaymentGatewayService.setCallback(callback);
            if (method === 'upi') {
              // One-tap: the SDK shows the installed-UPI-app chooser and deep-links.
              CFPaymentGatewayService.doUPIPayment(
                new CFUPIIntentCheckoutPayment(session, pappalCheckoutTheme()),
              );
            } else {
              // WebCheckout: doc says prefer doWebPayment over Drop (deprecated).
              CFPaymentGatewayService.doWebPayment(session);
            }
          })
          .catch(reject);
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Play Billing UCB (production path, ADR-0022)
// ---------------------------------------------------------------------------

/**
 * Opens the Play UCB recharge sheet for a given product SKU.
 * Only available in production once UCB/KYC enrolment is complete.
 */
export function useOpenRechargeSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      if (Platform.OS !== 'android') {
        throw new Error('Play Billing is Android-only');
      }
      if (!BillingModule) {
        throw new Error('BillingModule not available — check native registration');
      }
      const order = await createOrder(productId);
      track('recharge_sheet_opened');
      // Opens the Play UCB sheet; result comes via billingEvent listener
      await BillingModule.openRechargeSheet(productId);
      return order;
    },
    onSuccess: () => {
      // Balance will update via billingEvent → webhook → Realtime subscription
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
