/**
 * React Native API layer for Play Billing / UCB recharge.
 *
 * The native BillingModule handles the Play sheet. This module wraps it
 * and orchestrates the Supabase create-order + Cashfree onVerify flow.
 *
 * Flow:
 *   1. Client calls createOrder (Supabase Edge Function) → gets paymentSessionId
 *   2. Client opens Play sheet via BillingModule.openRechargeSheet(sku)
 *   3a. Google Play path: purchaseAcknowledged event → server webhook credits tokens
 *   3b. Alternative (Cashfree) path: alternativeChosen event → launch Cashfree SDK
 *       → onVerify → server webhook credits tokens
 *   4. Client listens for billingEvent and updates UI
 *
 * ADR-0022: India User Choice Billing
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { track } from '../lib/telemetry';

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

interface RechargeResult {
  orderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
}

/** Step 1: create a pending order on the server */
async function createOrder(productId: string): Promise<RechargeResult> {
  const { data, error } = await supabase.functions.invoke<RechargeResult>('create-order', {
    body: { productId },
  });
  if (error || !data) throw error ?? new Error('create-order returned no data');
  return data;
}

/** Open the UCB recharge sheet for a given product SKU */
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
