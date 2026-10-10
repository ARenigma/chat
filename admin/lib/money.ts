/**
 * Provider earnings are counted in tokens, and 1 token = ₹1 = 100 paise
 * (supabase/migrations/050_provider_payout_disbursement.sql: the payout batch
 * writes total_paise = total_tokens * 100). One place for that rate, so every
 * rupee figure in the console reads tokens the same way.
 */
const RUPEES_PER_TOKEN = 1;

export function rupeesFromTokens(tokens: number): string {
  return `₹${Math.round(tokens * RUPEES_PER_TOKEN).toLocaleString('en-IN')}`;
}
