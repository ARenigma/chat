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
 * Price: the server sets it and the client CHECKS it. create-order returns the
 * amount it created the Cashfree order for, along with the base, the GST rate
 * and any first-recharge discount it granted; `assertQuotedAmount` refuses to
 * open a payment surface when that amount is not the one the member was shown.
 * `useFirstRechargeDiscount` exists only so the screen can draw the right
 * number — it grants nothing (migration 102).
 *
 * Production: still gated by PAYMENTS_ENABLED + UCB enrolment (ADR-0022).
 *
 * RULE 5 (CLAUDE.md): react-native-cashfree-pg-sdk is required for ADR-0022;
 * it has no React Native equivalent that avoids the native bridging for WebCheckout.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  /** Rupees the Cashfree order was actually created for — the charge. */
  amount: number;
  currency: string;
  /** Undiscounted pack base in ₹, as the SERVER holds it. */
  baseInr?: number;
  /** GST rate the server used, in basis points. */
  gstRateBps?: number;
  /** First-recharge discount the server granted this order, in basis points. */
  discountBps?: number;
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

// ---------------------------------------------------------------------------
// First recharge is half price — the DISPLAY half of it
// ---------------------------------------------------------------------------

/**
 * The pack base in paise after the first-recharge discount.
 *
 * Byte-for-byte the arithmetic in `supabase/functions/create-order/index.ts`
 * (`discountedBasePaise`), and it has to be: the client draws a price, the
 * server charges one, and a member who is shown ₹177 and billed ₹178 has been
 * lied to by a rounding rule. Integer paise throughout, one `Math.round` in the
 * same place, so the two cannot drift.
 *
 * The discount comes off the TAXABLE value, not the gross — GST is then charged
 * on what is actually being sold, which is also what makes generate-invoice's
 * back-out (`taxable = round(total * 10000 / (10000 + rate))`) reverse exactly.
 */
export function discountedBasePaise(baseInr: number, discountBps: number): number {
  const basePaise = Math.round(baseInr * 100);
  if (discountBps <= 0 || basePaise <= 0) return basePaise;
  return basePaise - Math.round((basePaise * discountBps) / 10000);
}

/** Total in paise the member will be charged: discounted base + GST on it. */
export function discountedTotalPaise(
  baseInr: number,
  gstRateBps: number,
  discountBps: number,
): number {
  const basePaise = discountedBasePaise(baseInr, discountBps);
  if (gstRateBps <= 0 || basePaise <= 0) return basePaise;
  return basePaise + Math.round((basePaise * gstRateBps) / 10000);
}

/** The same total in rupees, which is the unit Cashfree orders are created in. */
export function discountedTotalInr(
  baseInr: number,
  gstRateBps: number,
  discountBps: number,
): number {
  return discountedTotalPaise(baseInr, gstRateBps, discountBps) / 100;
}

/**
 * Is this member's next recharge their first, and therefore half price?
 *
 * DISPLAY ONLY. `my_first_recharge_discount_bps` (migration 102) is read-only,
 * self-scoped to `auth.uid()`, and does not take the claim — create-order does
 * that, separately, and returns the discount it actually granted. So a client
 * that lies about this number can only mis-draw its own screen: the amount
 * charged comes from the server, and `useCashfreeCheckout` below refuses to
 * open the gateway when the server's amount is not the one the member was shown.
 *
 * Returns basis points (5000 = 50% off), 0 when the member has recharged
 * before or the offer is switched off. Falls back to 0 on any read failure —
 * quoting full price and charging less is recoverable; the reverse is not.
 */
export function useFirstRechargeDiscount() {
  return useQuery({
    queryKey: ['first-recharge-discount'],
    queryFn: async (): Promise<number> => {
      // `src/lib/database.types.ts` is hand-maintained ("Kept by hand rather
      // than generated so typechecking never needs a live project", its header),
      // so a migration and its RPC signature land in two files. Migration 102 is
      // in this change; the type entry belongs with it and is called out in the
      // handover. Until it exists the cast is confined to the NAME here rather
      // than spread as `any` — and the value is range-checked below before it is
      // believed, which is what actually matters for a number that prices a screen.
      const rpc = supabase.rpc as unknown as (
        fn: 'my_first_recharge_discount_bps',
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc('my_first_recharge_discount_bps');
      if (error) return 0;
      return typeof data === 'number' && Number.isInteger(data) && data > 0 && data < 10000
        ? data
        : 0;
    },
    // The answer changes exactly once in a member's life, at the moment their
    // first recharge is credited — and that moment already invalidates
    // ['profile'], so the screens that show a balance and the screens that show
    // a price refresh together rather than one of them going stale.
    staleTime: 60_000,
  });
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

/**
 * Step 3: server-side payment verification after SDK callback.
 *
 * Retries with backoff before giving up (2026-09-17 audit). `onVerify`
 * fires the instant the member returns from their UPI app — on Android,
 * exactly the moment the radio is re-establishing a connection — so a
 * single un-retried call turning a network blip into "Payment failed" was
 * the likeliest way this call ever threw. The retry is free: verify-order
 * is idempotent by design (its own header: "a duplicate verify-order call
 * (network retry, etc.) will not double-credit"), and the money is never
 * at risk either way — cashfree-webhook credits the balance server-side
 * independent of whether the client ever learns the result.
 *
 * 3 attempts, 1s/2s/4s, matching the shape of the reference app's own retry
 * (ConnectionsManager.cpp: a resend loop against a ceiling, with the
 * degenerate case synthesising a terminal RETRY_LIMIT once it is
 * exhausted) rather than an arbitrary number.
 */
async function verifyOrder(orderId: string): Promise<VerifyResult> {
  const delaysMs = [1000, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    const { data, error } = await supabase.functions.invoke<VerifyResult>('verify-order', {
      body: { orderId },
    });
    if (!error && data) {
      return data;
    }
    lastError = error ?? new Error('verify-order returned no data');
    const delay = delaysMs[attempt];
    if (delay !== undefined) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
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
  /**
   * The ₹ total the member was shown on the surface that launched this.
   *
   * Required for every path that shows a price. The gateway will be opened only
   * if the server created the order for exactly this amount — see
   * `assertQuotedAmount`.
   */
  expectedTotalInr?: number;
}

/**
 * The charge must equal the quote, and this is where that stops being a habit.
 *
 * A member sees a figure on the recharge chip, taps it, and a payment surface
 * opens. Between those two moments the server independently decides the amount:
 * GST rate from live admin config, pack base from its own table, and now a
 * first-recharge discount it grants or withholds on its own authority. Any one
 * of those three can disagree with what the client drew. It already has —
 * `docs/runbooks/create-order-deploy.md` exists because a tester was shown ₹300
 * and charged ₹354, and the mitigation written down then was a checklist step
 * performed by a human before each deploy.
 *
 * A checklist is not a mechanism. This is: if the order the server created is
 * not for the amount the member agreed to, the gateway never opens and the
 * mutation rejects. The member sees an error instead of a surprise charge, and
 * the order is left unpaid rather than paid at the wrong price.
 *
 * Compared in integer paise, not rupees — `17.7 * 10 !== 177` in float, and a
 * price guard that trips on its own arithmetic would be worse than none.
 */
function assertQuotedAmount(order: RechargeResult, expectedTotalInr?: number): void {
  if (expectedTotalInr === undefined) return;
  const chargedPaise = Math.round(order.amount * 100);
  const quotedPaise = Math.round(expectedTotalInr * 100);
  if (chargedPaise === quotedPaise) return;

  // `reason`, not `message`: FORBIDDEN_PROP_KEY in src/lib/telemetryGuard.ts
  // matches /message/ and `propsAreSafe` drops the whole event rather than the
  // key, so a prop named `message` means the event is never recorded at all.
  track('cashfree_checkout_error', {
    orderId: order.orderId,
    code: 'amount_mismatch',
    reason: `quoted ${quotedPaise}p, server created ${chargedPaise}p`,
  });
  throw new Error(
    'The price changed while we were setting this up. Please try again.',
  );
}

/**
 * Pappal-branded checkout theme, applied to the UPI-intent surface so the SDK's
 * chrome carries the coral button and header rather than Cashfree's default blue.
 *
 * Values are the resolved brand tokens (design/tokens.json): bg/accent, ramp
 * step 500 #C2401F (the logo coral, white on it 5.27:1), on white with the app's
 * ink for text. Literal hexes because the SDK takes strings before any theme
 * exists; __tests__/contract.test.ts pins them to the token. The hosted page's business NAME and LOGO
 * are dashboard settings, not SDK-themable — see cf-brand follow-up.
 *
 * doc: https://www.cashfree.com/docs/payments/online/mobile/react-native
 */
function pappalCheckoutTheme(): CFTheme {
  return new CFThemeBuilder()
    .setNavigationBarBackgroundColor('#C2401F')
    .setNavigationBarTextColor('#FFFFFF')
    .setButtonBackgroundColor('#C2401F')
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
    mutationFn: ({ productId, method = 'upi', expectedTotalInr }: CashfreeCheckoutVars) =>
      new Promise<CashfreeCheckoutResult>((resolve, reject) => {
        createOrder(productId)
          .then(order => {
            // Before anything is opened: the server's amount must be the amount
            // the member agreed to. Throwing here lands in the `.catch(reject)`
            // below, so no gateway, no charge, no order paid at a price that was
            // never shown.
            assertQuotedAmount(order, expectedTotalInr);

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
                // `reason`, not `message`: propsAreSafe (src/lib/telemetryGuard.ts)
                // drops the ENTIRE event when a prop key matches /message/, so
                // every checkout failure recorded under the old key was thrown
                // away on the device and never reached the events table. Fixed
                // here because a payment surface that fails silently in the
                // telemetry as well as on screen is how the Cashfree web
                // checkout crash went unnoticed.
                track('cashfree_checkout_error', {
                  orderId: orderID,
                  method,
                  code: error.getCode(),
                  reason: error.getMessage(),
                });
                // Ask the server what really happened to this order. If Cashfree
                // calls it terminal, verify-order marks the row failed, which
                // hands back any first-recharge discount claim it was holding
                // (migration 102) so the member's retry is still half price.
                // Best-effort and deliberately unawaited: the member's answer is
                // the rejection below either way.
                void verifyOrder(orderID).catch(() => {});
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
      // A credited recharge is the one event that changes the answer to "is
      // this your first?" — invalidated alongside the balance so the price on
      // the recharge screen and the balance above it never disagree about
      // whether the member has bought before.
      void queryClient.invalidateQueries({ queryKey: ['first-recharge-discount'] });
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
        throw new Error('BillingModule not available: check native registration');
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
