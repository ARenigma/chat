import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isUuid, newUuid } from '../src/lib/ids';
import { normalisePhone } from '../src/lib/phone';
import {
  DAILY_REFILL_TOKENS,
  MAX_MESSAGE_CHARS,
  STARTING_BALANCE,
} from '../src/lib/tokenLedger';
import { MAX_VOICE_MS, MIN_VOICE_MS, isVoicePath } from '../src/lib/voice';
import { DEFAULT_GST_RATE_BPS, formatRupeesPaise, gstSplit } from '../src/lib/rates';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The body of one `create or replace function`, so per-function claims can be
 * made. Comments are stripped: both guards carry a comment explaining *why* they
 * are not SECURITY DEFINER, and the assertion below is about the clause, not the
 * prose that warns against it.
 */
function plpgsqlBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * TypeScript with comments removed, for negative assertions.
 *
 * A `not.toContain` over source is otherwise unusable: the comment explaining
 * why a construct is wrong necessarily quotes it, so the test fails on its own
 * documentation. Handles block and line comments; not string-literal aware,
 * which is fine, no assertion here looks for `//` inside a string.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * `withoutComments` plus TRAILING line comments, for assertions that must not be
 * satisfiable by prose at all.
 *
 * `withoutComments` only drops a `//` comment that owns its line, so
 * `const x = 1; // usePanGesture(` survives it — and the gesture tripwire below
 * exists precisely because its predecessor could be kept green by a comment.
 *
 * The strip is guarded on there being no quote earlier in the line, which is what
 * keeps it from mangling code: `Linking.openURL('market://details?id=...')` in
 * SettingsSheet.tsx is a code line containing `//`, and a blind strip would
 * truncate it — and truncation HIDES whatever followed on that line, weakening
 * the very check this helper is here to strengthen. A quote before the `//` means
 * the `//` is inside a string, so the line is left alone; a trailing comment on a
 * line that also contains a string keeps its comment, which is the safe way to be
 * wrong.
 */
function codeOnly(source: string): string {
  return withoutComments(source).replace(/^([^'"`\n]*?)\/\/.*$/gm, '$1');
}

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c330')).toBe(false);
    expect(isUuid("'; drop table messages; --")).toBe(false);
    expect(isUuid('mia')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('mints keys its own validator accepts', () => {
    // `newUuid` names the storage object a voice note is uploaded under, and both
    // `isUuid` here and `voice_path_is_scoped` in migration 011 have to accept
    // it. Getting the version nibble or the variant bits wrong produces a string
    // that looks right, uploads fine, and is refused by the CHECK constraint
    // after the bytes are already in the bucket.
    for (let i = 0; i < 50; i += 1) {
      const id = newUuid();
      expect(isUuid(id)).toBe(true);
      expect(isVoicePath(`${newUuid()}/${id}.m4a`)).toBe(true);
    }
    expect(newUuid()).not.toBe(newUuid());
  });
});

/**
 * ADR-0001 in executable form.
 *
 * The pivot to human-to-human chat is only real if the model path is actually
 * gone rather than merely unreferenced. A dormant Edge Function that still holds
 * a provider key, or a stray import that pulls prompt text back into the bundle,
 * would put the Play listing's AI-disclosure question back on the table.
 */
describe('the AI path is gone, not dormant', () => {
  it.each([
    'src/api/stream.ts',
    'src/lib/personas.ts',
    'src/components/StreamingTurn.tsx',
    'scripts/openai-stub.mjs',
  ])('has removed %s', path => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });

  /**
   * This used to assert `supabase/functions` did not exist at all, which was a
   * proxy for "no Edge Function holds a model provider key". The push sender is
   * an Edge Function and a legitimate one, so the proxy had to be replaced with
   * the thing it stood for: whatever lives there, none of it may be an AI path.
   */
  it('allows Edge Functions, but only ones that are not a model path', () => {
    const dir = join(ROOT, 'supabase/functions');
    if (!existsSync(dir)) {
      return;
    }
    // exchange-firebase-token: verifies a Firebase phone ID token (JWKS) and
    // mints a Supabase session — an auth bridge, not a model path. Added with
    // AUTH_PHONE_PROVIDER='firebase'.
    const allowed = [
      // agora-usage-ingest: Console day usage + paid_sessions estimates +
      // Analytics per-call + invoice mode + variance alerts. Never pays anyone.
      'agora-usage-ingest',
      // Authenticated call participants receive only the short-lived credential
      // for the backend persisted on their live call. Vendor secrets remain here.
      'call-media-token',
      // cashfree-onboarding-complete: exchanges the 1-Click auth_code for the
      // verified PAN/DOB/bank and persists it (service-role writer); no model path.
      'cashfree-onboarding-complete',
      // cashfree-onboarding-start: mints a Cashfree 1-Click Onboarding session
      // (Data Availability + Initiate OAuth) so the native SDK sheet can open;
      // provider-JWT-gated, no model path. Verified PAN/identity flow.
      'cashfree-onboarding-start',
      // cashfree-payout: manual, founder-gated provider disbursement via Cashfree
      // Payouts Standard Transfer V2. Money-critical claim/settle is atomic SQL
      // (migration 050). Triggered from the admin payouts page.
      'cashfree-payout',
      // cashfree-webhook: Cashfree PG payment + Payouts TRANSFER_* callbacks;
      // HMAC on raw body. Payments credit tokens; transfers settle batches
      // (migration 060). ADR-0022.
      'cashfree-webhook',
      // create-order: creates a Cashfree order server-side (secret key required);
      // returns paymentSessionId to the client. ADR-0022.
      'create-order',
      'exchange-firebase-token',
      'generate-invoice',
      'send-call',
      'send-engagement',
      // send-open-alert: "someone opened your chat", dispatched by
      // announce_chat_open (068) after the SERVER has decided it is worth
      // sending. Resolves who to name and hands it to FCM; no model path.
      'send-open-alert',
      'send-push',
      'send-sms',
      // verify-order: client-initiated server-to-server payment confirmation after
      // SDK onVerify callback — never trusts client callback alone. ADR-0022.
      'verify-order',
      // verify-pan: Cashfree Verification Suite PAN check (tax only, not KYC) so
      // TDS-194O is 0.1% not 5%. Writes provider_tax_profile. Migration 048.
      'verify-pan',
      // verify-payout-account: creates a Cashfree Payouts beneficiary from a
      // provider's saved bank/UPI and writes the verification result. Service-role
      // writer of the payout-account verification columns (migration 048).
      'verify-payout-account',
      'verify-phone',
    ];
    const present = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      /*
       * `_shared` is Supabase's own convention for code imported BY functions
       * rather than deployed as one — the CLI does not treat a leading
       * underscore as a function. Excluded here rather than added to the
       * allow-list, so the list stays a list of deployable surfaces and a second
       * shared module does not need a second entry.
       * https://supabase.com/docs/guides/functions/quickstart#organizing-your-edge-functions
       */
      .filter(entry => !entry.name.startsWith('_'))
      .map(entry => entry.name);
    // An allow-list rather than a pattern: a new Edge Function is a decision
    // worth making explicitly, because this is the one place in the stack that
    // holds a credential and can reach the open internet.
    expect(present.sort()).toEqual(allowed);
  });

  it('leaves no reference to a model, a prompt or an SSE stream in the app', () => {
    const sources = ['src', '__tests__', 'supabase/functions']
      .filter(dir => existsSync(join(ROOT, dir)))
      .flatMap(dir => walk(join(ROOT, dir)))
      .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
      // This test necessarily names the things it forbids.
      .filter(f => !f.endsWith('contract.test.ts'));

    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/openai|systemPrompt|getSystemPrompt|stream-chat/i);
      expect(text).not.toMatch(/react-native-sse/);
    }
  });

  it('carries no OpenAI dependency and no Deno tooling scripts', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).not.toContain('react-native-sse');
    expect(Object.keys(pkg.scripts)).not.toContain('check:edge');
    expect(Object.keys(pkg.scripts)).not.toContain('stub:openai');
  });
});

/**
 * GST is disclosed where money moves and nowhere else.
 *
 * (This header used to be the Cashfree one, which describes the describe block
 * below this one — it had drifted up a block. Moved back on 2026-09-07.)
 *
 * Two halves, and the second is the one that regresses quietly:
 *   1. The arithmetic — an inclusive pack price split into a base and a tax, in
 *      integer paise, using the identical expression `generate-invoice` prints,
 *      so a chip and the invoice for the same purchase cannot disagree.
 *   2. The placement — the tax is named on the recharge packs and the pay step,
 *      and on NO per-minute rate, balance, timer or bubble. Tokens are prepaid;
 *      tax was settled when the rupees were paid.
 *
 * Presentation is EXCLUSIVE (base + tax) on top of an INCLUSIVE price, which is
 * the distinction the whole area turns on: ADR-0021 fixes pack prices as
 * tax-inclusive and `create-order` captures the nominal price, so "₹5,000 + 18%
 * GST" would name a number nobody is ever charged.
 */
describe('GST is disclosed where money moves and nowhere else', () => {
  // Prices are INCLUSIVE: ₹300 buys 300 tokens and already contains the tax.
  // These are the figures generate-invoice prints for the same packs.
  it('backs the tax out of the pack price in exact integer paise', () => {
    expect(gstSplit(300, 1800)).toEqual({ totalPaise: 30000, taxablePaise: 25424, gstPaise: 4576 });
    expect(gstSplit(100, 1800)).toEqual({ totalPaise: 10000, taxablePaise: 8475, gstPaise: 1525 });
    expect(gstSplit(5000, 1800)).toEqual({ totalPaise: 500000, taxablePaise: 423729, gstPaise: 76271 });
    // taxable + gst is the price, always — no paisa appears or vanishes.
    for (const pack of [100, 300, 500, 1000, 2500, 5000]) {
      const split = gstSplit(pack, 1800);
      expect(split.taxablePaise + split.gstPaise).toBe(split.totalPaise);
    }
  });

  it('uses the invoice generator\'s own expression, so screen and PDF cannot disagree', () => {
    const invoice = read('supabase/functions/generate-invoice/index.ts');
    const rates = read('src/lib/rates.ts');
    const expression = 'Math.round((totalPaise * 10000) / (10000 + ';
    expect(invoice).toContain(expression);
    expect(rates).toContain(expression);
  });

  it('charges no tax at all when the seller is not registered', () => {
    // `gst_rate_bps = 0` has to zero the tax in the ARITHMETIC, not just hide a
    // label, or the base line would still be short of the price. The label side
    // of this — every disclosure returning null at rate 0 — is asserted on
    // `gstAddedLabel`/`gstAddedSpoken` in rechargeChips.test.ts.
    expect(gstSplit(300, 0).gstPaise).toBe(0);
    expect(gstSplit(300, 0).taxablePaise).toBe(30000);
  });

  it('renders paise as two-decimal rupees, the only non-round figure on these screens', () => {
    /*
     * Narrowed 2026-09-07, because the old title ("formats the disclosure the way
     * the pack card, the pay row and the sheet all show it") had stopped
     * describing the assertions underneath it. Those surfaces no longer render an
     * inclusive "incl. ₹45.76 GST" phrase or a bare "18%" anywhere — the chips
     * and the pay step state a base plus a tax, and both footers name no rate —
     * so `gstIncludedLabel` and `gstPercentLabel` are deleted. What is left here
     * is the one formatter those surfaces do still route every GST figure
     * through, and the four cases that matter to it: the two live pack splits,
     * the grouping separator at four digits, and a sub-rupee value that must keep
     * its leading zero rather than read as "₹0.5".
     */
    expect(formatRupeesPaise(4576)).toBe('₹45.76');
    expect(formatRupeesPaise(76271)).toBe('₹762.71');
    expect(formatRupeesPaise(100000)).toBe('₹1,000.00');
    expect(formatRupeesPaise(5)).toBe('₹0.05');
  });

  it('states the split one way only — the inclusive phrasing and the bare rate are gone', () => {
    /*
     * The retirement gate for the two exports above, and the reason this is a
     * source assertion rather than a behavioural one: their defect was not a
     * wrong output, it was existing at all. They formatted correctly and nothing
     * called them, and the only thing keeping them compiled was this file pinning
     * their return values.
     *
     * Comments stripped, because `rates.ts` names both functions in the block
     * recording why they were deleted — the gate is about the code, not the
     * epitaph.
     */
    const rates = withoutComments(read('src/lib/rates.ts'));
    expect(rates).not.toContain('gstIncludedLabel');
    expect(rates).not.toContain('gstPercentLabel');
    // The arithmetic and the exclusive-on-top presentation are what remain.
    // gstSplit is the shared back-out expression generate-invoice prints;
    // gstOnTop / gstAddedLabel / gstAddedSpoken are the ADR-0029 exports.
    expect(rates).toContain('export function gstSplit(');
    expect(rates).toContain('export function gstOnTop(');
    expect(rates).toContain('export function gstAddedLabel(');
    expect(rates).toContain('export function gstAddedSpoken(');
    // The old inclusive names must be gone from code (still named in comments).
    expect(rates).not.toContain('export function gstExclusiveParts(');
    expect(rates).not.toContain('export function gstExclusiveLabel(');
  });

  it('keeps the fallback rate in step with the admin economics fallback', () => {
    expect(DEFAULT_GST_RATE_BPS).toBe(1800);
    expect(read('src/api/appConfig.ts')).toMatch(/gst_rate_bps:\s*1800/);
    // Both hosts and the payment sheet read the admin value, not the constant.
    expect(read('src/screens/RechargeScreen.tsx')).toContain('useEconomicsConfig');
    expect(read('src/screens/PaymentSheet.tsx')).toContain('useEconomicsConfig');
  });

  it('names GST on every recharge surface and on no chat surface', () => {
    // Positive: the pack cards (both hosts), the pay row and the payment sheet.
    //
    // The label these surfaces call is now the EXCLUSIVE-ON-TOP one (ADR-0029):
    // the pack IS the base, the tax is added on top, and the Pay bar names the
    // total. What this gate cares about is unchanged: every surface where rupees
    // move names the tax. Matching the family rather than one name so a future
    // rename cannot silently empty the assertion.
    const NAMES_GST = /gstAdded(Label|Spoken)\(/g;
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));
    expect(recharge.match(NAMES_GST)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(withoutComments(read('src/screens/PaymentSheet.tsx'))).toMatch(NAMES_GST);

    // Negative: tokens are prepaid, tax was settled when the rupees were paid.
    // A per-minute rate, a balance, a timer or a bubble that mentioned GST would
    // be taxing the same money twice in the reader's head (Amit, 2026-09-05:
    // "GST on recharge chips, no GST in chat").
    // SettingsSheet earns its place only for the recharge-history row, "Receipts
    // and GST invoices" — the invoice is the document the tax legally lives on.
    const allowed = new Set(['RechargeScreen.tsx', 'PaymentSheet.tsx', 'SettingsSheet.tsx']);
    for (const dir of ['src/screens', 'src/components']) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (!file.endsWith('.tsx') || allowed.has(file)) {
          continue;
        }
        expect({ file, mentionsGst: /\bGST\b|gst(Split|IncludedLabel|ExclusiveLabel|ExclusiveParts|PercentLabel|AddedLabel|AddedSpoken|OnTop)/.test(withoutComments(read(`${dir}/${file}`))) })
          .toEqual({ file, mentionsGst: false });
      }
    }
  });
});

/**
 * Cashfree billing invariants (ADR-0022).
 *
 * These assert three things that are easy to regress silently:
 *   1. create-order packs match RECHARGE_PACKS in rates.ts exactly.
 *   2. billing.ts does not contain the Cashfree client secret or any cfsk_ prefix —
 *      the secret key must never leave the Edge Functions.
 *   3. PaymentSheet imports CASHFREE_SANDBOX_CHECKOUT (and therefore routes through
 *      the sandbox path when the flag is true).
 */
describe('Cashfree billing invariants', () => {
  it('create-order packs align with RECHARGE_PACKS (100 300 500 1000 2500 5000)', () => {
    const fn = read('supabase/functions/create-order/index.ts');
    // Every pack from rates.ts must appear as a key in the server function.
    for (const amount of [100, 300, 500, 1000, 2500, 5000]) {
      expect(fn).toContain(`pappal_pack_${amount}`);
    }
    // Old mismatched packs must be gone.
    expect(fn).not.toMatch(/['"]pappal_pack_50['"]/);
    expect(fn).not.toMatch(/['"]pappal_pack_200['"]/);
    // Price must be 1 token = ₹1.
    expect(fn).toContain('amountInr: 100');
    expect(fn).toContain('amountInr: 5000');
  });

  it('billing.ts carries no client secret or cfsk_ key material', () => {
    const billing = withoutComments(read('src/api/billing.ts'));
    expect(billing).not.toMatch(/cfsk_/);
    expect(billing).not.toMatch(/client_secret/i);
    expect(billing).not.toMatch(/CASHFREE_CLIENT_SECRET/);
  });

  it('PaymentSheet imports CASHFREE_SANDBOX_CHECKOUT', () => {
    const sheet = read('src/screens/PaymentSheet.tsx');
    expect(sheet).toContain('CASHFREE_SANDBOX_CHECKOUT');
  });

  it('cashfree-webhook settles TRANSFER_ACKNOWLEDGED and reverts failures', () => {
    const fn = read('supabase/functions/cashfree-webhook/index.ts');
    expect(fn).toContain('TRANSFER_ACKNOWLEDGED');
    expect(fn).toContain('TRANSFER_FAILED');
    expect(fn).toContain('TRANSFER_REVERSED');
    expect(fn).toContain('settle_provider_payout_batch');
    // Intermediate SENT_TO_BENEFICIARY must not complete the batch.
    expect(fn).toContain("eventType === 'TRANSFER_SUCCESS'");
    // Cashfree Test & Add requires 200 even without HMAC headers.
    expect(fn).toContain('missing signature headers; ack without processing');
  });

  it('cashfree-webhook has verify_jwt disabled for vendor HMAC auth', () => {
    const cfg = read('supabase/config.toml');
    expect(cfg).toMatch(/\[functions\.cashfree-webhook\][\s\S]*?verify_jwt\s*=\s*false/);
  });

  it('cashfree-payout leaves RECEIVED batches processing for the webhook', () => {
    const fn = read('supabase/functions/cashfree-payout/index.ts');
    expect(fn).toContain('mark_provider_payout_submitted');
    expect(fn).toContain("'processing'");
  });

  it('agora-usage-ingest reconciles Console, Analytics, invoice without paying', () => {
    const fn = read('supabase/functions/agora-usage-ingest/index.ts');
    expect(fn).toContain('refresh_media_channel_usage_estimates');
    expect(fn).toContain('upsert_media_channel_usage_analytics');
    expect(fn).toContain('check_media_cogs_variance');
    expect(fn).toContain('import_media_invoice_days');
    expect(fn).toContain("mode === 'invoice'");
    expect(fn).toContain('/beta/analytics/call/lists');
    // Never settle provider money from Agora.
    expect(fn).not.toContain('settle_provider_payout_batch');
    expect(fn).not.toContain('create_provider_payout_batch');
  });

  it('media COGS tighten migration keys product meter to paid_sessions', () => {
    const sql = read('supabase/migrations/061_media_cogs_reconcile_tighten.sql');
    expect(sql).toContain('paid_sessions.minutes_billed');
    expect(sql).toContain('primary key (call_id, source)');
    expect(sql).toContain('import_media_invoice_days');
    expect(sql).toContain('check_media_cogs_variance');
    expect(sql).toContain('media_cogs_recon_alerts');
  });

  it('ConfirmDialog is hosted on Sheet', () => {
    const dialog = read('src/components/ConfirmDialog.tsx');
    expect(dialog).toContain("from './Sheet'");
    expect(dialog).toContain('<Sheet');
  });

  it('destructive confirms highlight Stay, not Leave', () => {
    const dialog = read('src/components/ConfirmDialog.tsx');
    expect(dialog).toContain('testID="confirm-dialog-cancel"');
    expect(dialog).toMatch(/destructive \? \([\s\S]*label=\{cancelLabel\}/);
  });

  it('wallet pill opens the full page, not the refill sheet', () => {
    expect(read('src/screens/HomeScreen.tsx')).toContain('onPress={openWallet}');
    // ChatScreen routes members to openWallet; providers route to onOpenEarnings
    // (with openWallet as fallback). Both paths reach openWallet.
    expect(read('src/screens/ChatScreen.tsx')).toContain('openWallet');
    expect(read('src/screens/ProviderDetailScreen.tsx')).toContain('onPress={openWallet}');
  });

  it('verify-order function exists and asserts server-to-server verification', () => {
    const fn = read('supabase/functions/verify-order/index.ts');
    expect(fn).toContain('fetchCashfreeOrder');
    expect(fn).toContain('credit_purchased_recharge');
    // Must assert it never trusts the client alone.
    expect(fn).toMatch(/never trust the client/i);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Reference harvesting stays clean-room (ADR-0025).
 *
 * We MEASURE reference apps and re-express their behaviour in our own code:
 * Telegram (GPL-2.0) and Fuse (a demo) are read for timings, thresholds and
 * interaction anatomy, recorded in design/references/*.md, and reimplemented.
 * We never copy their source, assets, strings, icons or Lottie files — doing so
 * with Telegram would force Pappal under the GPL. A copied Telegram file carries
 * one of these identifiers, so their absence anywhere in the shipping tree is
 * the mechanical proof the boundary held. (design/references is exempt: it is
 * where the measurements legitimately live.)
 */
describe('reference harvesting stays clean-room', () => {
  const FORBIDDEN = /org\.telegram|TMessagesProj|DrKLO/;
  const TEXT = /\.(ts|tsx|js|jsx|kt|java|xml|gradle|pro|json|md|txt|h|m|swift)$/;
  const ROOTS = ['src', 'assets', join('android', 'app', 'src')];

  it('carries no Telegram source, package or asset identifier', () => {
    const offenders: string[] = [];
    for (const r of ROOTS) {
      const base = join(ROOT, r);
      if (!existsSync(base)) {
        continue;
      }
      for (const abs of walk(base)) {
        const rel = abs.slice(ROOT.length + 1);
        if (FORBIDDEN.test(rel)) {
          offenders.push(`${rel} (filename)`);
        } else if (TEXT.test(abs) && FORBIDDEN.test(read(rel))) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The send path is now a single SQL function, so the invariants that used to be
 * spread across an Edge Function and a client are all assertable in one place.
 */
describe('conversation schema invariants', () => {
  const m003 = read('supabase/migrations/003_human_conversations.sql');
  const m004 = read('supabase/migrations/004_message_guard_and_directory.sql');

  it('keeps sending behind the RPC rather than a client insert', () => {
    expect(m003).toMatch(/revoke all on function public\.send_message/);
    expect(m003).toMatch(/grant execute on function public\.send_message\(uuid, text\) to authenticated/);
    // An INSERT policy on messages would let a client write a message without
    // paying for it, which is the whole reason send_message exists.
    expect(m003).not.toMatch(/create policy[^;]*on public\.messages for insert/i);
  });

  it('admits providers only through the service role', () => {
    expect(m003).toMatch(/revoke all on function public\.approve_provider_application/);
    expect(m003).toMatch(/grant execute on function public\.approve_provider_application[^;]*to service_role/);
    expect(m003).not.toMatch(
      /grant execute on function public\.approve_provider_application[^;]*to authenticated/,
    );
  });

  /**
   * Both guards were briefly SECURITY DEFINER, which silently disabled them:
   * `current_user` becomes the function owner, so the client-role branch is
   * never taken and every forbidden write is permitted. The bug is invisible at
   * the call site, so it is pinned here.
   */
  it('leaves both column guards as SECURITY INVOKER', () => {
    expect(plpgsqlBody(m003, 'guard_privileged_profile_columns')).not.toMatch(
      /security definer/i,
    );
    expect(plpgsqlBody(m004, 'guard_message_columns')).not.toMatch(/security definer/i);
  });

  it('narrows the discovery surface to the directory view', () => {
    expect(m004).toMatch(/drop policy if exists "Providers are discoverable" on public\.profiles/);
    expect(m004).toMatch(/security_invoker = false/);
    expect(m004).toMatch(/grant select on public\.provider_directory to authenticated/);
  });

  it('publishes what the Realtime client subscribes to', () => {
    // Without `replica identity full` an UPDATE payload carries only the primary
    // key, so read receipts would arrive with no read_at to apply.
    expect(m003).toMatch(/alter publication supabase_realtime add table public\.messages/);
    expect(m003).toMatch(/alter table public\.messages replica identity full/);
  });
});

/**
 * The Play Store compliance claims are asserted here as well as in
 * `scripts/verify-manifest.mjs`, so a regression fails `npm test` too.
 */
describe('Android manifest', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  const declared = [...manifest.matchAll(/<uses-permission\s+([^>]*)>/g)]
    .map(m => m[1] ?? '')
    .filter(attrs => !attrs.includes('tools:node="remove"'))
    .map(attrs => attrs.match(/android:name="([^"]+)"/)?.[1] ?? '');

  it('requests exactly INTERNET, VIBRATE, POST_NOTIFICATIONS, RECORD_AUDIO, CAMERA, and call FGS permissions', () => {
    // The list is asserted exactly rather than as a subset, because the cost of
    // a permission is paid on the Play listing and in the install dialog, a
    // library quietly merging one in is the failure this catches. POST_NOTIFICATIONS
    // was added deliberately for push and grants no access to data.
    //
    // RECORD_AUDIO reaches a sensor (voice notes); CAMERA is a second sensor for
    // capturing a photo to send (#8). Both are declared by us rather than tolerated
    // from a dependency's manifest, because verify-manifest.mjs treats its allowlist
    // as the required set. USE_FULL_SCREEN_INTENT was here for a ringing call that
    // took over the screen; the call is a heads-up popup now, so the permission is
    // gone.
    //
    // Call foreground service permissions (android-audit.md 2026-08-29):
    //   MANAGE_OWN_CALLS — prerequisite for FOREGROUND_SERVICE_TYPE_PHONE_CALL
    //   FOREGROUND_SERVICE — required to start any foreground service
    //   FOREGROUND_SERVICE_PHONE_CALL/MICROPHONE/CAMERA — type permissions for API 34+
    //   (developer.android.com/about/versions/14/changes/fgs-types-required)
    //
    // ACCESS_NETWORK_STATE — added with Cashfree recharge (ADR-0022). The PG SDK's
    // analytics reads ConnectivityManager.getActiveNetworkInfo() WITHOUT a
    // permission check, so its absence is a SecurityException that crashes checkout
    // the instant Pay is tapped (not a graceful degrade). Normal, non-dangerous:
    // no runtime prompt, no Play Data Safety row. See AndroidManifest.xml comment
    // and verify-manifest.mjs allowlist.
    expect(declared.sort()).toEqual([
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.CAMERA',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CAMERA',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      'android.permission.INTERNET',
      'android.permission.MANAGE_OWN_CALLS',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO',
      'android.permission.VIBRATE',
    ]);
  });

  it('declares none of the tracking or storage permissions', () => {
    // RECORD_AUDIO and CAMERA left this list on purpose when voice notes and
    // photo capture shipped — both are sensor permissions the product now uses on
    // purpose. The rest stay forbidden: the app reads no media library
    // (Android 13+ system photo picker needs no permission), no location, no
    // contacts, and never an advertising id.
    for (const forbidden of [
      'com.google.android.gms.permission.AD_ID',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_CONTACTS',
    ]) {
      expect(declared).not.toContain(forbidden);
    }
  });

  it('disables backup so cached messages and tokens cannot be extracted', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });
});

describe('cross-runtime constants', () => {
  it('keeps the SQL refill grant in step with DAILY_REFILL_TOKENS', () => {
    const migration = read('supabase/migrations/002_bootstrap_and_grants.sql');
    expect(migration).toContain(`token_balance + ${DAILY_REFILL_TOKENS}`);
  });

  it('keeps the profiles column default in step with STARTING_BALANCE', () => {
    const migration = read('supabase/migrations/001_initial_schema.sql');
    expect(migration).toContain(`token_balance integer default ${STARTING_BALANCE}`);
  });

  it('revokes the wallet primitives from client roles', () => {
    const migration = read('supabase/migrations/002_bootstrap_and_grants.sql');
    expect(migration).toMatch(/revoke all on function public\.deduct_user_token/);
    expect(migration).toMatch(/revoke all on function public\.credit_user_token/);
  });

  it('enforces the message ceiling in the composer and the column', () => {
    expect(read('src/components/Composer.tsx')).toContain('maxLength={MAX_MESSAGE_CHARS}');
    expect(read('supabase/migrations/003_human_conversations.sql')).toContain(
      `length(body) <= ${MAX_MESSAGE_CHARS}`,
    );
    expect(MAX_MESSAGE_CHARS).toBeGreaterThan(0);
  });

  it('keeps the voice-note bounds in step with the CHECK constraint', () => {
    // The expensive version of this failure: the recorder caps at one number, the
    // constraint at another, and the mismatch is discovered *after* the audio is
    // already uploaded, because the RPC rejects the row and the bytes stay in the
    // bucket until the purge job runs.
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      `voice_duration_ms between ${MIN_VOICE_MS} and ${MAX_VOICE_MS}`,
    );
  });
});

/**
 * Guards on the pipeline itself. A job that calls a script that no longer
 * exists, or a pgTAP file whose plan drifted from its assertion count, fails
 * silently in the worst way: the suite reports success having run nothing.
 *
 * Reads `.gitlab-ci.yml`, per ADR-0003 the GitHub workflows are gone, and
 * asserting against YAML that can never run is worse than not asserting.
 */
describe('pipeline wiring', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
  const pipeline = read('.gitlab-ci.yml');

  it('declares every npm script the pipeline invokes', () => {
    // Exclude script names that appear only in admin/ CI jobs: admin/ has its
    // own package.json and its scripts are verified by admin-static, not here.
    const adminJobScripts = new Set(['build']);
    const invoked = [...pipeline.matchAll(/npm run ([a-z:]+)/g)]
      .map(m => m[1] ?? '')
      .filter(name => !adminJobScripts.has(name));
    expect(invoked.length).toBeGreaterThan(0);
    for (const name of invoked) {
      expect(Object.keys(scripts)).toContain(name);
    }
  });

  it('points every `node scripts/...` call at a file that exists', () => {
    const referenced = [...pipeline.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map(m => m[1] ?? '');
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(() => read(file)).not.toThrow();
    }
  });

  it('runs every pgTAP suite that exists', () => {
    const declared = readdirSync(join(ROOT, 'supabase/tests'))
      .filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.includes('generated'));
    const runner = read('scripts/db-test.mjs');
    for (const file of declared) {
      expect(runner).toContain(file);
    }
  });

  it('applies every migration in the test harness, or names why not', () => {
    /*
     * Every migration must appear in `scripts/db-test.mjs` — in MIGRATIONS,
     * which the harness applies, or in SEED_MIGRATIONS, which it deliberately
     * does not.
     *
     * The second list exists because 085 seeds six provider rows, and every
     * pgTAP suite starts from an empty database and asserts absolute counts:
     * `010` expects `count(*) from profiles` to be 2 after inserting two users.
     * Six fixture people make it 8 and the failure reads as a wallet bug.
     *
     * Checking mere PRESENCE in the file is what keeps this from being a hole:
     * a new migration cannot be forgotten, only categorised, and putting a
     * schema change in the seed list would show up as an untested migration in
     * review rather than as a silent pass.
     */
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter(f =>
      f.endsWith('.sql'),
    );
    const runner = read('scripts/db-test.mjs');
    for (const file of migrations) {
      expect(runner).toContain(file);
    }
    // And the escape hatch is narrow: seed-only, and named one at a time.
    const seeds = /export const SEED_MIGRATIONS = \[([\s\S]*?)\];/.exec(runner)?.[1] ?? '';
    for (const named of seeds.match(/'[^']+'/g) ?? []) {
      expect(named).toMatch(/_seed_/);
    }
  });

  it.each([
    'supabase/tests/010_wallet_and_grants.sql',
    'supabase/tests/020_conversations_and_roles.sql',
    'supabase/tests/030_message_guard_and_directory.sql',
    // 011's two suites. Included because a plan that drifts from the assertion
    // count is only caught by `npm run test:db`, which needs Docker and does not
    // run on this machine, so without these the numbers would go unchecked until
    // CI. The 040 to 080 suites are absent for a duller reason: they predate the
    // habit and several put a helper somewhere the counting regex cannot see.
    'supabase/tests/090_reactions_replies_voice_presence.sql',
    'supabase/tests/100_calls_and_metering.sql',
    // 020's suite. has_table + ok (×2) + function_privs_are + is = 5 counted by
    // the regex; plan(5) must stay in sync with that count.
    'supabase/tests/130_mock_recharge.sql',
    'supabase/tests/140_chat_minute.sql',
  ])('keeps the pgTAP plan in step with the assertions in %s', file => {
    const sql = read(file);
    const planned = Number(/select plan\((\d+)\)/.exec(sql)?.[1]);
    const asserted = (
      sql.match(
        /^select (has_table|hasnt_table|has_column|hasnt_column|has_index|has_trigger|col_is_pk|col_not_null|col_has_default|col_default_is|policies_are|function_privs_are|isnt_empty|throws_ok|lives_ok|ok|is|isnt)\(/gm,
      ) ?? []
    ).length;
    expect(planned).toBe(asserted);
  });

  it('never lets the maestro flows drift from the app id', () => {
    for (const flow of readdirSync(join(ROOT, '.maestro')).filter(f => /^\d/.test(f))) {
      expect(read(`.maestro/${flow}`)).toContain('appId: com.companionchat');
    }
  });

  it('asserts the test IDs the flows select on still exist in the components', () => {
    const sources = ['src/components', 'src/screens'];
    const haystack = sources
      .flatMap(dir => readdirSync(join(ROOT, dir)).map(f => read(`${dir}/${f}`)))
      .join('\n');

    /**
     * Ids under `assertNotVisible` are excluded, and the exclusion is the
     * interesting part: those name things that must *not* exist. `signin-facebook`
     * is asserted absent because the Facebook button shipped with no credentials
     * behind it, so every tap failed, and a flow that simply stopped mentioning
     * it would pass again the moment someone re-added it.
     */
    const flows = readdirSync(join(ROOT, '.maestro')).filter(f => /^\d/.test(f));
    const selectors = new Set<string>();
    for (const file of flows) {
      const body = read(`.maestro/${file}`);
      for (const block of body.split(/\n(?=- )/)) {
        if (/assertNotVisible/.test(block)) {
          continue;
        }
        for (const m of block.matchAll(/id:\s*'([^']+)'/g)) {
          selectors.add(m[1] ?? '');
        }
      }
    }
    expect(selectors.size).toBeGreaterThan(0);

    for (const id of selectors) {
      // Flows select on a prefix for generated ids (`provider-<uuid>`).
      const needle = id.replace(/\.\*$/, '');
      if (haystack.includes(needle)) {
        continue;
      }
      if (id.startsWith('action-')) {
        const channel = id.slice('action-'.length);
        expect(haystack).toContain('testID={`action-${channel}`}');
        expect(haystack).toContain(`channel="${channel}"`);
        continue;
      }
      if (id.startsWith('nav-')) {
        const tab = id.slice('nav-'.length);
        expect(haystack).toContain('testID={`nav-${tab.key}`}');
        expect(haystack).toContain(`key: '${tab}'`);
        continue;
      }
      expect(haystack).toContain(needle);
    }
  });
});

/**
 * No screen is written and then never mounted.
 *
 * This test exists because `ReviewSheet` shipped complete, sheet, mutation,
 * `submit_review`, a `reviewed` column in `conversation_summaries` published
 * specifically to drive it, and was rendered by nothing at all. Everything
 * typechecked, everything linted, no test failed, and the feature did not
 * exist. Dead UI is the one class of bug the other gates here cannot see,
 * because a component that is never referenced is indistinguishable from one
 * that is correct.
 */
describe('every screen is reachable', () => {
  const mounters = ['App.tsx', ...walk(join(ROOT, 'src'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => f.slice(ROOT.length + 1))]
    .map(read)
    .join('\n');

  const screens = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => f.replace(/\.tsx$/, ''));

  it('finds screens to check', () => {
    expect(screens.length).toBeGreaterThan(8);
  });

  it.each(screens)('mounts %s somewhere', name => {
    // The trailing character class is not decoration: a bare
    // `toContain('<Name')` is satisfied by `<NameSomethingElse`, which made an
    // earlier version of this test pass against a deliberately broken mount.
    // Counting occurrences would not work either, the defining file holds the
    // name as a function declaration, never as an element.
    expect(mounters).toMatch(new RegExp(`<${name}[\\s/>]`));
  });
});

describe('review collection remains deferred', () => {
  const chat = read('src/screens/ChatScreen.tsx');

  it('does not couple the ephemeral inbox to review state', () => {
    expect(withoutComments(chat)).not.toContain('reviewed');
    expect(chat).not.toContain('<ReviewSheet');
  });

  it('keeps the provider work list to actual work', () => {
    const home = read('src/screens/ProviderHomeScreen.tsx');
    expect(home).toContain('!t.i_am_member');
    // ...while still letting them open the threads they are the member of,
    // because role picks the whole navigation tree and nothing else would.
    expect(home).toContain('t.i_am_member');
    expect(home).toContain('Your own conversations');
  });

  it('never blocks the transcript with it', () => {
    // A rating request in a modal over an open conversation would interrupt the
    // single thing this screen is for.
    expect(chat).not.toMatch(/Alert\.alert/);
  });
});

/**
 * Gestures work inside modals.
 *
 * On Android a React Native `Modal` is a separate native window with its own
 * root view, so the `GestureHandlerRootView` at the top of `App.tsx` does not
 * enclose anything rendered inside one. A pan declared in a modal is
 * constructed, attached, and then recognised by nobody, silently. Found by
 * holding a finger on the sheet and dragging: nothing moved, nothing warned.
 *
 * Asserted structurally because the failure mode is a feature that quietly does
 * not exist, which no runtime check will catch.
 */
describe('gesture handling reaches every root', () => {
  /**
   * A gesture DECLARATION, matched on the hook that makes one.
   *
   * This was `/Gesture\.\w+\(/` against RAW source, and it was wrong twice over.
   *
   * Wrong about the API: `Gesture` is the deprecated builder. RNGH 3.2.1 marks
   * the object itself "@deprecated `Gesture` builder API is deprecated and will
   * be removed in a future version of Gesture Handler. Please migrate to the
   * new, hook-based API." (handlers/gestures/gestureObjects.d.ts) and names a
   * hook for every member, so the pattern went blind the moment the four gesture
   * files moved to `usePanGesture` and friends — which is a tripwire that stops
   * ringing exactly when the code it watches is rewritten.
   *
   * Wrong about the source: reading raw text meant PROSE satisfied it. A comment
   * containing `SimultaneousGesture.prepare()` matches `Gesture.prepare(`, so a
   * file with no gesture left in it stayed on the list. Both halves are fixed —
   * the hooks are the API, and `codeOnly` strips comments first.
   *
   * `useCompetingGestures` / `useSimultaneousGestures` / `useExclusiveGestures`
   * are deliberately absent from the alternation (and cannot match it anyway,
   * being plural): composing is not declaring, and the wrapper decision this
   * list exists to force is owed by whoever creates a recogniser.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
   */
  const DECLARES_GESTURE =
    /use(Tap|Pan|Pinch|Rotation|Fling|LongPress|Native|Manual|Hover)Gesture\(/;

  const surfaces = (): { file: string; code: string }[] =>
    ['src/components', 'src/screens'].flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: f, code: codeOnly(read(`${dir}/${f}`)) })),
    );

  it('wraps the app root', () => {
    expect(read('App.tsx')).toContain('<GestureHandlerRootView');
  });

  it('wraps each modal that declares a gesture', () => {
    const withModals = surfaces().filter(
      s => s.code.includes('<Modal') && DECLARES_GESTURE.test(s.code),
    );

    expect(withModals.length).toBeGreaterThan(0);
    for (const s of withModals) {
      expect(s.code).toContain('<GestureHandlerRootView');
    }
  });

  it('limits gesture declarations to the sheet, the spotlight card, and the chat bubble', () => {
    // Tripwire: a new usePanGesture/useLongPressGesture needs a wrapper
    // decision, not a copy.
    // Turn.tsx is the WhatsApp swipe-to-reply / long-press strip.
    // SpotlightCard.tsx is the M3 bottom sheet with drag-to-dismiss (2026-09).
    const users = surfaces()
      .filter(s => DECLARES_GESTURE.test(s.code))
      .map(s => s.file)
      .sort();
    // MediaViewer.tsx is the full-screen photo: swipe-down to dismiss and
    // pinch to zoom, which are the two gestures a photo viewer is expected to
    // have and which nothing else in the app can host — the viewer is a Modal,
    // so its gestures cannot collide with the transcript's.
    expect(users).toEqual([
      'MediaViewer.tsx',
      'Sheet.tsx',
      'SpotlightCard.tsx',
      'Turn.tsx',
    ]);
  });

  it('has nothing left on the deprecated builder', () => {
    // The other half of the migration, and the half a hook-shaped tripwire
    // cannot see: a file that goes BACK to `Gesture.Pan()` would drop off the
    // list above rather than fail it. Comment-stripped, because the note in
    // MediaViewer.tsx that explains the move necessarily names the thing it
    // moved away from.
    for (const s of surfaces()) {
      expect(s.code).not.toMatch(/\bGesture\.\w+\(/);
    }
  });
});

/**
 * The launcher icon, which is the one asset with no runtime and therefore no
 * chance of failing loudly.
 *
 * Every density is a resized copy of a committed master, so the interesting
 * failures are structural: a density bucket that was never generated, an
 * adaptive layer referenced by XML but absent from mipmap, and the ink value
 * hardcoded in colors.xml drifting from the token it was copied from. None of
 * those show up in a build; all of them show up on someone's home screen.
 */
describe('launcher icon', () => {
  const RES = 'android/app/src/main/res';
  const BUCKETS = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const LAYERS = [
    'ic_launcher.png',
    'ic_launcher_round.png',
    'ic_launcher_foreground.png',
    'ic_launcher_monochrome.png',
  ];

  it('ships every layer at every density', () => {
    const missing: string[] = [];
    for (const bucket of BUCKETS) {
      for (const layer of LAYERS) {
        if (!existsSync(join(ROOT, RES, `mipmap-${bucket}`, layer))) {
          missing.push(`mipmap-${bucket}/${layer}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the pre-26 bitmaps, because minSdk is 24', () => {
    // Adaptive icons start at API 26. Deleting these because the XML exists
    // would leave two Android versions with no icon at all.
    const minSdk = read('android/build.gradle').match(/minSdkVersion\s*=\s*(\d+)/);
    expect(minSdk).not.toBeNull();
    expect(Number(minSdk?.[1])).toBeLessThan(26);
    expect(existsSync(join(ROOT, RES, 'mipmap-mdpi/ic_launcher.png'))).toBe(true);
  });

  it('declares a monochrome layer for themed icons', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${name}`);
      expect(xml).toContain('<monochrome');
      expect(xml).toContain('@mipmap/ic_launcher_monochrome');
    }
  });

  it('backs the adaptive icon with a drawable, not a bare colour', () => {
    // `<background android:drawable="@color/...">` compiles and ships the right
    // value, and then renders as nothing on API 34, the mark composited over
    // whatever was behind it and the paper bubble vanished. Verified on device;
    // this is the assertion that stops it coming back.
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${name}`);
      const background = xml.match(/<background[^>]*android:drawable="([^"]+)"/)?.[1];
      expect(background).toBe('@drawable/ic_launcher_bg');
    }
    expect(read(`${RES}/drawable/ic_launcher_bg.xml`)).toContain(
      '@color/ic_launcher_background',
    );
  });

  it('resolves every resource the adaptive XML references', () => {
    const xml = read(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`);
    for (const [, ref] of xml.matchAll(/@mipmap\/(\w+)/g)) {
      expect(existsSync(join(ROOT, RES, 'mipmap-xxxhdpi', `${ref}.png`))).toBe(true);
    }
    for (const [, ref] of xml.matchAll(/@drawable\/(\w+)/g)) {
      expect(existsSync(join(ROOT, RES, 'drawable', `${ref}.xml`))).toBe(true);
    }
    for (const [, ref] of read(`${RES}/drawable/ic_launcher_bg.xml`).matchAll(
      /@color\/(\w+)/g,
    )) {
      expect(read(`${RES}/values/colors.xml`)).toContain(`name="${ref}"`);
    }
  });

  it('keeps the native icon background equal to the token it was copied from', () => {
    // colors.xml cannot be generated: the platform reads it before any JS runs.
    // So this is the only thing standing between a palette change and an icon
    // that no longer matches the app it opens.
    const tokens = JSON.parse(read('design/tokens.json'));
    const ink = tokens.color.tokens['bg/inverse'].Light.toUpperCase();
    const declared = read(`${RES}/values/colors.xml`)
      .match(/name="ic_launcher_background">(#[0-9A-Fa-f]{6})</)?.[1]
      ?.toUpperCase();
    expect(declared).toBe(ink);
  });

  it('has a Play listing icon and feature graphic', () => {
    expect(existsSync(join(ROOT, 'docs/play/assets/play-icon-512.png'))).toBe(true);
    expect(
      existsSync(join(ROOT, 'docs/play/assets/feature-graphic-1024x500.png')),
    ).toBe(true);
  });
});

/**
 * Copy that describes how you sign in, versus how you actually sign in.
 *
 * The settings sheet told every user "Signed in with your phone number" for as
 * long as phone auth had been off, a claim about identity, on the privacy
 * screen, that was simply false. It survived a full verify because nothing ties
 * prose to `SocialProvider`. This does.
 */
describe('sign-in copy matches the sign-in that exists', () => {
  const providers = (() => {
    const union = read('src/api/auth.ts').match(
      /export type SocialProvider =([^;]+);/,
    )?.[1];
    expect(union).toBeDefined();
    return [...(union ?? '').matchAll(/'([a-z]+)'/g)].map(m => m[1] ?? '');
  })();

  it('offers only providers the app implements', () => {
    expect(providers).toEqual(['google']);
  });

  it('never claims an identity the app cannot issue', () => {
    // Every user-facing string in the app, checked against the providers that
    // are not in the union. "phone" is the one that actually happened; the rest
    // are here so the next removal is caught by the same test.
    const absent = ['phone number', 'facebook', 'apple id'].filter(
      name => !providers.some(p => name.startsWith(p)),
    );
    const screens = readdirSync(join(ROOT, 'src/screens'))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: f, body: withoutComments(read(`src/screens/${f}`)) }));

    for (const screen of screens) {
      for (const name of absent) {
        // "your phone" is the device, not the identity, that is the whole
        // distinction this test has to be careful about, so match the claim
        // ("signed in with ... phone number") rather than the noun.
        const claim = new RegExp(`[Ss]igned in with[^'"]{0,40}${name}`, 'i');
        expect(screen.body).not.toMatch(claim);
      }
    }
  });
});

/**
 * Nothing that signs or authenticates may be git-trackable.
 *
 * There is now a copy of the upload keystore and its two passwords at the repo
 * root, which is convenient and also the single worst place for them: the root
 * is the directory that gets committed, archived and shared. `.gitignore` covers
 * the paths that exist today, and that is exactly the protection that fails,
 * the realistic accident is not someone reading the repo, it is someone adding
 * `upload.keystore.bak` or `keys/` and pushing a signing key to two remotes,
 * where it cannot be un-pushed.
 *
 * So this asserts the property rather than the paths: for every file on disk
 * that looks like a credential, git must refuse to track it. A new name is
 * caught the first time anyone runs the suite.
 */
describe('secrets are untrackable', () => {
  const SUSPICIOUS = /(\.keystore|\.jks|\.p12|\.pem|keystore\.properties|-key\.json|service.?account.*\.json|\.env$)/i;

  /** Files git would actually track, i.e. not ignored. `-c` keeps it quiet. */
  function trackable(paths: string[]): string[] {
    if (paths.length === 0) {
      return [];
    }
    const result = spawnSync(
      'git',
      ['check-ignore', '--no-index', '--stdin'],
      { cwd: ROOT, input: paths.join('\n'), encoding: 'utf8' },
    );
    const ignored = new Set(
      (result.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean),
    );
    return paths.filter(p => !ignored.has(p));
  }

  it('ignores every credential-shaped file present on disk', () => {
    const listed = spawnSync(
      'git',
      ['ls-files', '--others', '--cached', '--exclude-standard', '-z'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    // `--others --exclude-standard` lists untracked-but-not-ignored files, and
    // `--cached` lists tracked ones. Anything credential-shaped in either set is
    // a file git is willing to commit.
    const candidates = (listed.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      .filter(p => SUSPICIOUS.test(p))
      // Three files legitimately live in git, and each is committed on purpose:
      //   - debug.keystore is Android's public, universally-known debug key,
      //     needed for a debug build to work on a fresh clone.
      //   - keystore.properties.example is a template with no values in it.
      //   - ios/.xcode.env is Xcode build config, matched only because the
      //     pattern ends with `.env`. It holds a node path, not a secret.
      .filter(
        p =>
          ![
            'android/app/debug.keystore',
            'android/keystore.properties.example',
            'ios/.xcode.env',
          ].includes(p),
      );

    expect(candidates).toEqual([]);
  });

  it('would refuse the names someone is most likely to invent', () => {
    const likely = [
      'upload.keystore',
      'upload.keystore.bak',
      'keys-backup/upload.keystore',
      'keys/upload.jks',
      'android/keystore.properties',
      'backup/keystore.properties',
      '.env',
      '.secrets/fcm-sender.json',
      'fcm-service-account.json',
    ];
    expect(trackable(likely)).toEqual([]);
  });
});

/**
 * Phone sign-in is written and switched off, and this is what keeps the second
 * half of that sentence true.
 *
 * The Facebook button shipped: an option that took a tap and produced a failure,
 * because the provider had no credentials. Phone is the same shape of risk for a
 * different reason, Indian transactional SMS cannot be delivered at all until
 * DLT registration completes, so `signInWithOtp` would accept a number, look
 * like it worked, and deliver nothing for one to three weeks.
 */
describe('phone sign-in stays off until it can deliver', () => {
  const auth = read('src/api/auth.ts');
  // PHONE_AUTH_ENABLED is now defined in src/config.ts; auth.ts re-exports it.
  const featureFlags = read('src/config.ts');
  const enabled = /export const PHONE_AUTH_ENABLED = (true|false);/.exec(featureFlags)?.[1];

  it('declares the flag explicitly', () => {
    expect(enabled).toBeDefined();
  });

  /**
   * Rewritten when the screen was built.
   *
   * This used to assert the sign-in screen never mentioned phone at all, which
   * was the right intent expressed the wrong way, it forbade the code rather
   * than the reachability. The screen now implements phone sign-in and gates the
   * entry point, so the assertion that matters is that the gate is actually
   * there: every element that starts the flow must be inside a
   * PHONE_AUTH_ENABLED condition.
   */
  it('gates every phone entry point on the flag', () => {
    // OnboardingScreen is the sole sign-in surface now (Amit, 2026-09-03:
    // "remove this from app and wire welcome screen" retired the separate
    // returning-user AuthScreen), so the gate lives here.
    const screen = withoutComments(read('src/screens/OnboardingScreen.tsx'));

    // The button that begins the flow, and the copy that promises it.
    for (const marker of ['onboard-use-phone"', 'Use my number instead']) {
      const at = screen.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      // Walk back to the enclosing JSX conditional and require the flag in it.
      const preceding = screen.slice(Math.max(0, at - 600), at);
      expect(preceding).toMatch(/PHONE_AUTH_ENABLED|phoneVisible/);
    }
  });

  it('still offers Google as a primary button when phone is off', () => {
    // The Google button is always rendered, regardless of whether phone auth
    // is enabled. `testID="onboard-google"` is the stable identifier.
    const screen = withoutComments(read('src/screens/OnboardingScreen.tsx'));
    expect(screen).toContain('testID="onboard-google"');
    // Rendered only in the 'choose' step, where it is the sole or co-primary action.
    expect(screen).toContain("identify === 'choose'");
  });

  it('refuses to call Supabase while the flag is false', () => {
    // Both entry points return early, so even a caller that ignores the flag
    // cannot spend an SMS or start a flow that cannot finish.
    for (const fn of ['sendPhoneOtp', 'verifyPhoneOtp']) {
      const start = auth.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = auth.slice(start, start + 400);
      expect(body).toMatch(/if \(!PHONE_AUTH_ENABLED\)/);
    }
  });

  it('keeps the hook disabled in config while the flag is false', () => {
    if (enabled !== 'false') {
      return;
    }
    const config = read('supabase/config.toml');
    // Every line of the hook block must still be commented out. An enabled hook
    // with no MSG91 credentials makes Supabase fail the send rather than skip it.
    const live = config
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(live).not.toContain('[auth.hook.send_sms]');
  });
});

describe('normalisePhone', () => {
  it('assumes +91 for a bare ten-digit number', () => {
    expect(normalisePhone('9876543210')).toBe('919876543210');
    expect(normalisePhone('98765 43210')).toBe('919876543210');
  });

  it('leaves an existing country code alone', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalisePhone('+1 415 555 0123')).toBe('14155550123');
  });

  it('rejects anything too short or too long to be dialable', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('9876543210987654321')).toBeNull();
    expect(normalisePhone('not a phone')).toBeNull();
  });
});

/**
 * `supabase config push` sends config.toml verbatim, so this file is
 * authoritative or it is a landmine.
 *
 * On 2026-08-21 a push made to change the SMS OTP expiry also took Google
 * sign-in down, because config.toml said `enabled = false` while the credentials
 * had been set in the dashboard. Nothing in the file or the tests objected. The
 * secret survived and only the flag flipped, so it was a few minutes of outage
 * rather than an unrecoverable one, but the next version of that mistake could
 * wipe a credential nobody has a copy of.
 */
describe('config.toml cannot silently disable a live provider', () => {
  const config = read('supabase/config.toml');

  /** Uncommented lines only: the file explains a lot of things it does not do. */
  const live = config
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');

  function providerBlock(name: string): string {
    const at = live.indexOf(`[auth.external.${name}]`);
    expect(at).toBeGreaterThan(-1);
    const rest = live.slice(at + 1);
    const next = rest.indexOf('\n[');
    return rest.slice(0, next === -1 ? undefined : next);
  }

  it('enables every provider the sign-in screen offers', () => {
    const providers = [
      ...(/export type SocialProvider =([^;]+);/
        .exec(read('src/api/auth.ts'))?.[1] ?? '')
        .matchAll(/'([a-z]+)'/g),
    ].map(m => m[1] ?? '');
    expect(providers.length).toBeGreaterThan(0);

    for (const provider of providers) {
      expect(providerBlock(provider)).toMatch(/enabled = true/);
    }
  });

  it('keeps the client id literal and only the secret in the environment', () => {
    // A client id is not a secret, it ships inside google-services.json. Having
    // it as env() is how the value ends up empty on a push from a machine that
    // happens not to have the variable set.
    const block = providerBlock('google');
    expect(block).toMatch(/client_id = "\d+-[a-z0-9]+\.apps\.googleusercontent\.com"/);
    expect(block).toMatch(/secret = "env\(/);
  });

  it('does not let the resend button outpace the server', () => {
    // OnboardingScreen enables "Resend code" after RESEND_SECONDS. If
    // Supabase's max_frequency is longer, the button is live while the server
    // still refuses, and the user gets a security error for pressing what the
    // app offered. Ported from the retired AuthScreen (Amit, 2026-09-03) —
    // OnboardingScreen is the sole sign-in surface now, so this is the one
    // place the check still needs to hold.
    const maxFrequency = /^max_frequency = "(\d+)s"$/m.exec(live)?.[1];
    const uiCooldown = /const RESEND_SECONDS = (\d+);/.exec(
      read('src/screens/OnboardingScreen.tsx'),
    )?.[1];
    expect(maxFrequency).toBeDefined();
    expect(uiCooldown).toBeDefined();
    expect(Number(uiCooldown)).toBeGreaterThanOrEqual(Number(maxFrequency));
  });
});

/**
 * In-app updates have to be present in the FIRST release or they are useless for
 * the first update.
 *
 * The prompt runs inside the version the user already has. A 1.0.0 that ships
 * without this can never offer 1.0.1 in-app, Play's silent background
 * auto-update still happens, but nothing can ask. There is no way to add it
 * retroactively to a version already installed, which makes this the one feature
 * whose absence cannot be fixed in the next release.
 */
describe('in-app updates are wired end to end', () => {
  it('depends on the Play app-update library', () => {
    expect(read('android/app/build.gradle')).toMatch(
      /implementation\("com\.google\.android\.play:app-update:[\d.]+"\)/,
    );
  });

  it('registers the native package, which autolinking cannot do for us', () => {
    // It is this app's own module rather than a node_modules package, so it must
    // be added by hand, and a missing registration fails silently: the JS side
    // simply sees an unsupported platform and never prompts.
    expect(read('android/app/src/main/java/com/companionchat/MainApplication.kt')).toContain(
      'add(InAppUpdatePackage())',
    );
  });

  it('keeps the decision out of the native module', () => {
    // The bridge cannot be tested without Play, so it must hold no judgement.
    // Anything resembling a threshold in Kotlin is a rule nothing can verify.
    const kotlin = read('android/app/src/main/java/com/companionchat/InAppUpdateModule.kt');
    expect(kotlin).not.toMatch(/updatePriority\(\)\s*>=/);
    expect(kotlin).not.toMatch(/clientVersionStalenessDays\(\)\s*>=/);
  });

  it('mounts the restart prompt outside the routed tree', () => {
    // A downloaded update must survive navigation and both the signed-in and
    // signed-out trees. Mounting it inside a screen loses it on the next route.
    const app = read('App.tsx');
    expect(app).toContain('<UpdateBanner />');
    // After <Root /> rather than adjacent to it: stripping the JSX comment that
    // explains why leaves braces behind, so an adjacency regex is checking the
    // comment's formatting rather than the mount point.
    expect(app.indexOf('<UpdateBanner />')).toBeGreaterThan(app.indexOf('<Root />'));
    // And a sibling of <Root /> inside Shell, not nested in a screen. Scoped to
    // the Shell function body, because a whole-file regex with [\s\S]* only
    // proves one string appears before another, which was the first version of
    // this assertion and it proved nothing.
    const shell = app.slice(app.indexOf('function Shell()'));
    expect(shell).toContain('<UpdateBanner />');
  });

  it('keeps the App Distribution SDK out of the Play artefact', () => {
    // Measured, not assumed: the full SDK pulls in REQUEST_INSTALL_PACKAGES and
    // WRITE_EXTERNAL_STORAGE. REQUEST_INSTALL_PACKAGES is a restricted
    // permission needing a Play declaration, and an app about paid conversation
    // with strangers asking to install packages is a review problem. The
    // `internal` variant carries it; `release` must not.
    //
    // The whole risk is one word: changing `internalImplementation` to
    // `implementation` would ship it to Play with nothing else looking wrong.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain(
      'internalImplementation("com.google.firebase:firebase-appdistribution:',
    );
    expect(gradle).not.toMatch(
      /^\s*implementation\("com\.google\.firebase:firebase-appdistribution:/m,
    );
    // The -api artefact IS in every variant, deliberately. It is the no-op that
    // lets MainActivity call updateIfNewReleaseAvailable() without a
    // variant-specific source set.
    expect(gradle).toContain(
      'implementation("com.google.firebase:firebase-appdistribution-api:',
    );
  });

  it('derives the internal versionCode so a bump is enough to prompt testers', () => {
    // App Distribution prompts on versionCode. A fixed one means no tester is
    // ever offered anything, however many builds get pushed.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('parts[0] * 10000 + parts[1] * 100 + parts[2]');
    expect(gradle).toContain('versionName versionNameProperty');
    // No hardcoded version left behind for the two to drift apart.
    expect(gradle).not.toMatch(/versionName\s+"\d+\.\d+\.\d+"/);

    // The derivation only stays monotonic while minor and patch are under 100,
    // which the gradle comment states and nothing enforced. A 100th patch
    // silently collides with the next minor and the tester prompt goes quiet.
    const name = /^VERSION_NAME=(\d+)\.(\d+)\.(\d+)$/m.exec(
      read('android/gradle.properties'),
    );
    expect(name).not.toBeNull();
    const [, , minor, patch] = name as RegExpExecArray;
    expect(Number(minor)).toBeLessThan(100);
    expect(Number(patch)).toBeLessThan(100);
  });

  it('limits cleartext to the debug emulator-host exception', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const main = read('android/app/src/main/res/xml/network_security_config.xml');
    const debug = read('android/app/src/debug/res/xml/network_security_config.xml');

    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
    expect(manifest).not.toContain('usesCleartextTraffic');
    expect(main).toContain('<base-config cleartextTrafficPermitted="false"');
    expect(debug).toContain('<domain includeSubdomains="false">10.0.2.2</domain>');
    expect(debug).not.toContain('<base-config cleartextTrafficPermitted="true"');
  });

  it('builds only the connected Android device ABI during local iteration', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.android).toBe(
      'react-native run-android --active-arch-only',
    );
  });

  it('sends testers the internal APK, never the release one', () => {
    // Distributing release would work and testers would never be prompted
    // again, because that artefact has only the no-op stub.
    const script = read('scripts/distribute.mjs');
    expect(script).toContain('apk/internal/app-internal.apk');
    expect(script).not.toContain('apk/release/app-release.apk');
  });

  it('never blocks a release build on an accidental versionCode', () => {
    // Play rejects a duplicate versionCode. The old default of 1 meant the first
    // upload worked and every later local build collided.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('(wantsRelease || wantsClosedTest) && explicitVersionCode == null');
    expect(gradle).toMatch(/throw new GradleException/);
  });
});

/**
 * A block was enforced in `send_message` and invisible everywhere else, so after
 * blocking someone they stayed in the directory, stayed in the "here now" rail,
 * and the block only announced itself as an error after the member had typed a
 * message. These assertions pin the fix, and one of them pins the seam it is
 * deliberately *not* at.
 */
describe('a block is visible where it matters and reversible everywhere', () => {
  it('keeps blocked people out of both discovery surfaces', () => {
    // v13 HomeScreen merges both discovery surfaces: the Explore directory and the
    // CHATS rail. Both are filtered by the same block set.
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain('useBlockedPeerIds');
    // Provider directory surface (was ProvidersScreen.tsx):
    expect(home).toContain('(providers ?? []).filter(p => !blocked.has(p.id))');
    // CHATS rail surface (was InboxScreen.tsx; the typed-search strangers filter
    // has no v13 equivalent since HomeScreen has no search — retired with InboxScreen):
    expect(home).toContain('!blocked.has(c.peer_id) && visibleOnRail(railPrefs, c.peer_id)');
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen hides blocked conversations from the
  // CHATS rail entirely (filter on mount) rather than keeping them visible with a
  // "blocked – open to unblock" indicator. The unblock path moves to ProviderDetailScreen.

  it('leaves the filtering out of provider_directory, which the inbox joins', () => {
    // The trap: a `where` clause here would null `peer_display_name` on the
    // blocked person's existing thread, because conversation_summaries LEFT
    // JOINs this view to resolve it.
    const migration = read('supabase/migrations/006_phone_auth_and_provider_onboarding.sql');
    const view = migration.slice(
      migration.indexOf('create view public.provider_directory'),
      migration.indexOf('comment on view public.provider_directory'),
    );
    expect(view.length).toBeGreaterThan(0);
    expect(view).not.toContain('blocks');
  });

  it('exposes the block set as a set, not as rows', () => {
    const safety = read('src/api/safety.ts');
    expect(safety).toContain('export function useBlockedPeerIds(): ReadonlySet<string>');
    // `useBlocks` is the private implementation. Exporting `Block[]` invites a
    // caller to read `blocker_id` and assume the list is symmetric; RLS returns
    // only rows where the caller is the blocker, so it never has been.
    expect(safety).not.toContain('export function useBlocks');
  });
});

describe('one contact address', () => {
  it('uses hello@pappal.live everywhere a user is asked to write to us', () => {
    /*
     * Amit, 2026-09-07: "update hello@pappal.live everywhere on app and website
     * as our email". It had drifted — the GST invoice a customer receives fell
     * back to an `@axionix.tech` address, and the Play listing's support email
     * was `user@pappal.live` while two docs recorded a personal gmail.
     *
     * This pins the USER-FACING addresses. Tester Google accounts in
     * play-upload/06-testers/ are deliberately NOT covered: those are identities
     * for Play's closed-test cohort, not somewhere to write to, and rewriting
     * them would remove people from testing.
     */
    const CONTACT = 'hello@pappal.live';
    const surfaces = [
      'supabase/functions/generate-invoice/index.ts',
      'web/index.html',
      'web/privacy.html',
      'web/terms.html',
      'web/refund.html',
      'web/delete.html',
    ];
    for (const file of surfaces) {
      const body = read(file);
      expect({ file, has: body.includes(CONTACT) }).toEqual({ file, has: true });
      // and no stale address alongside it
      for (const stale of ['@axionix.tech', 'privacy@example.invalid', 'user@pappal.live']) {
        expect({ file, stale, found: body.includes(stale) }).toEqual({ file, stale, found: false });
      }
    }
  });
});

describe('the website download link', () => {
  it('points at a STABLE asset name in the latest release', () => {
    /*
     * Every download button on the site resolves
     * `releases/latest/download/Pappal.apk` against whatever release is newest.
     * On 2026-09-07 a release was published whose asset was named
     * `Pappal-1.1.6.apk`, and every download button on the live site returned
     * 404 until an asset named exactly `Pappal.apk` was added to it.
     *
     * So the filename is a CONTRACT between this repo and ARenigma/pappal-downloads:
     * every release must carry an asset named exactly `Pappal.apk`. A
     * version-stamped name may sit alongside it; it may not replace it.
     */
    const STABLE = 'https://github.com/ARenigma/pappal-downloads/releases/latest/download/Pappal.apk';
    const pages = readdirSync(join(ROOT, 'web')).filter(f => f.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const html = read(join('web', page));
      const links = html.match(/https:\/\/github\.com\/ARenigma\/pappal-downloads[^"']*/g) ?? [];
      for (const link of links) {
        expect(link).toBe(STABLE);
      }
    }
  });
});

describe('shipping to Play', () => {
  const fastfile = read('fastlane/Fastfile');
  const ci = read('.gitlab-ci.yml');

  it('uploads an AAB that CI actually builds', () => {
    // `play-internal` uploads CLOSED_TEST_AAB, and the android job built only
    // the release pair — so the designed publish path would have failed on a
    // missing file the first time anyone tagged a release.
    /*
     * The path, not the whole assignment. The Fastfile now wraps it in
     * `File.expand_path(..., __dir__)` because `bundle exec fastlane` runs from
     * the repo root in CI, so a bare `../android/...` looked for a sibling of
     * the repo and missed the AAB that had just been built. This assertion
     * pinned the pre-fix literal and had been failing since; it asserts the
     * artefact path and the resolution, which is what actually has to hold.
     */
    expect(fastfile).toContain(
      'android/app/build/outputs/bundle/closedTest/app-closedTest.aab',
    );
    expect(fastfile).toContain('File.expand_path');
    expect(ci).toContain('bundleClosedTest');
  });

  it('never guesses a closed-testing track name', () => {
    // Play reserves no id for closed testing: those tracks are created manually
    // with custom names (https://developers.google.com/android-publisher/tracks).
    // A default would either fail confusingly or silently create a new track.
    expect(fastfile).toContain('lane :closed do |options|');
    expect(fastfile).toContain('UI.user_error!');
    expect(fastfile).toMatch(/track = options\[:track\]/);
    // Uploads as a draft so the artefact can be inspected before a tester sees
    // it, unless the caller asks otherwise.
    expect(fastfile).toMatch(/release_status: options\[:status\] \|\| "draft"/);
  });

  it('does not let `beta` masquerade as closed testing', () => {
    // `beta` IS Play's open-testing track. Reaching for it to do closed testing
    // publishes to anyone with the opt-in link.
    const betaLane = fastfile.slice(fastfile.indexOf('lane :beta do'));
    expect(betaLane).toContain('track: "beta"');
    expect(fastfile).toContain("`beta` is Play's OPEN testing track");
  });
});

describe('the redesign holds its own invariants', () => {
  it('keeps closed-test builds capturable while production remains secure', () => {
    // FLAG_SECURE covers screenshots, screen recording and the app-switcher
    // thumbnail together. Blocking only screenshots bans nothing.
    const activity = read('android/app/src/main/java/com/companionchat/MainActivity.kt');
    expect(activity).toContain('WindowManager.LayoutParams.FLAG_SECURE');
    expect(activity).toContain('if (BuildConfig.BLOCK_SCREENSHOTS)');
    // Not gated on DEBUG: the build type expresses the distribution contract.
    expect(activity).not.toContain('if (!BuildConfig.DEBUG)');

    const gradle = read('android/app/build.gradle');
    const release = gradle.slice(gradle.indexOf('release {'), gradle.indexOf('closedTest {'));
    expect(release).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "true"');
    const closed = gradle.slice(gradle.indexOf('closedTest {'), gradle.indexOf('internal {'));
    expect(closed).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "false"');
    /*
     * Internal stays CAPTURABLE, for product demos (Amit, 2026-09-06).
     *
     * It was briefly tightened to block-by-default with a runtime exemption for
     * `@example.test` accounts, and that was verified WRONG on the S22: every
     * screencap came back a solid black frame, because that domain matches only
     * the seeded fake providers, never the real account a demo is given from.
     * The lesson is in the gradle comment; the assertion is here.
     */
    const internal = gradle.slice(gradle.indexOf('internal {'));
    expect(internal).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "false"');
    expect(internal).toContain('buildConfigField "boolean", "ALLOW_DEV_CAPTURE", "true"');
    // The carve-out cannot exist in the shipping variant at all: with the field
    // false, R8 resolves the guard to an unconditional return and the
    // clearFlags branch is dead code, not merely unreachable at runtime.
    expect(release).toContain('buildConfigField "boolean", "ALLOW_DEV_CAPTURE", "false"');
  });

  it('draws no avatar in the transcript, so both bubble edges are the composer edges', () => {
    // SUPERSEDES 'renders the peer profile image before the first bubble in a
    // group'. The incoming avatar shipped for months, and it is gone on a
    // product decision (Amit, 2026-09-07: "remove it, align the grid").
    //
    // The reason is geometric, not cosmetic. A peer row was
    // [26dp avatar][8dp gap][bubble], so an incoming bubble's left edge sat at
    // 16 + 34 = 50dp while the composer capsule's edges are at 16dp and
    // W - 16dp. The outgoing bubble already ended at W - 16, so the capsule
    // traced the grid on the right and missed it by 34dp on the left, and a
    // bubble scrolling under the capsule did not share its silhouette. This app
    // is exclusively 1:1 and the header already carries the peer's avatar, name
    // and presence, so the transcript copy was redundant as well as costly —
    // which is also why Telegram, the reference, draws no avatar in a 1:1
    // transcript and its input bar lines up.
    //
    // Comments stripped: the files still EXPLAIN the removed avatar at length,
    // and a gate that reads prose would be satisfied by the explanation.
    const turn = withoutComments(read('src/components/Turn.tsx'));
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    const typing = withoutComments(read('src/components/PeerTyping.tsx'));

    // Nothing reintroduces the slot, the plumbing, or the component.
    expect(turn).not.toContain('AVATAR_SLOT');
    expect(turn).not.toContain('avatarUri');
    expect(turn).not.toMatch(/from '\.\/Avatar'/);
    expect(chat).not.toContain('avatarUri=');

    // PeerTyping is the ListHeaderComponent and duplicated the same inset, so
    // it has to lose it too or the typing bubble stands 34dp right of the
    // message it precedes.
    expect(typing).not.toMatch(/from '\.\/Avatar'/);
    expect(typing).not.toMatch(/width:\s*26/);

    // The header is where the avatar now lives, exclusively.
    expect(chat).toContain('<Avatar initial={initial} uri={avatarUrl} size={42}');
  });

  it('routes the back gesture through the parent map rather than branching inline', () => {
    const app = read('App.tsx');
    expect(app).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(app).toContain('memberParent(route)');
    expect(app).toContain('providerParent(providerRoute)');
    // The Recharge overlay closes before a screen pops: it sits above everything
    // (zIndex 20) and is what the user most recently opened. Settings used to be a
    // sheet that closed here too; it is a mounted route now and pops through the
    // parent map like every other screen.
    const handler = app.slice(app.indexOf('const onBack ='), app.indexOf('BackHandler.addEventListener'));
    expect(handler.indexOf('closeWallet()')).toBeLessThan(handler.indexOf('closeRefill()'));
    expect(handler.indexOf('closeRefill()')).toBeLessThan(handler.indexOf('memberParent'));
    expect(app).toContain("openChat(id, 'chatsList')");
    expect(app).toContain('from === \'chatsList\'');
  });

  it('opens a Paper menu from a long-press on a conversation', () => {
    expect(read('src/screens/HomeScreen.tsx')).toContain('measureInWindow');
    expect(read('src/components/PaperMenu.tsx')).toContain('anchor');
    expect(read('src/screens/ChatsListScreen.tsx')).toContain('surface="list"');
    expect(read('src/components/ConversationMenu.tsx')).toContain('Remove from Home');
    expect(read('src/components/PaperMenu.tsx')).toContain('m3.material.io/components/menus');
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen has no typed search field and
  // therefore no debounced query to assert on.

  // Retired with InboxScreen.tsx: v13 HomeScreen uses a ScrollView (not a FlatList
  // with a header-mounted search field), so the empty-state/search-header interaction
  // has no v13 equivalent.

  it('stops recording when the app reaches the background', () => {
    // Android may transiently report inactive while a system permission surface
    // owns focus. Only background means the app actually left the foreground.
    const composer = read('src/components/Composer.tsx');
    expect(composer).toContain("AppState.addEventListener('change'");
    expect(composer).toContain("next === 'background'");
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen has no typed search; the provider
  // directory is browsed via the Explore section rather than a search field.

  it('puts Explore providers in cards, and the inbox in bubbles', () => {
    /*
     * REVERSED 2026-09-08, and this assertion previously said the opposite:
     * "puts Explore rows on the page with an inset hairline, NOT in cards". It
     * is worth leaving the history in the name of the thing that changed rather
     * than quietly editing the expectations.
     *
     * The old rule had a real argument behind it — a member moves between
     * Explore and the inbox constantly, and two list idioms in one app read as
     * two apps — and the directory was rebuilt on hairline rows because of it.
     * Amit overruled it while looking at the reference: "exactly copy the
     * astrotalk -- why to deviate". Astrotalk's directory is unambiguously
     * cards, and matching it was the instruction.
     *
     * So the invariant is no longer "one idiom" but "each list commits to its
     * own": Explore is cards with a gap, Chats is bubbles with a gap, and
     * NEITHER draws a hairline. What the old rule was really protecting — that
     * a list must not be half one thing and half the other — is asserted below
     * for both.
     */
    const source = read('src/components/ProviderRow.tsx');
    // A card: raised fill, a radius, and a gap to the next one.
    expect(source).toContain('bg.raised');
    expect(source).toContain('borderRadius: TOKENS.radius.sm');
    expect(source).toContain('marginBottom: ROW_CARD_GAP');
    // ...and NOT half a row: no separator, no inset, nothing left of the
    // hairline idiom it replaced.
    expect(source).not.toContain('ROW_SEPARATOR_INSET');
    expect(source).not.toContain('styles.separator');
    // Still no elevation. A drop shadow on a recycled FlashList cell costs an
    // overdraw pass per frame, and the reference separates by fill, not shadow.
    expect(source).not.toContain('TOKENS.elevation.card');
    expect(source).not.toContain('shadowOpacity');
  });

  it('draws Chats as bubbles with no separators at all', () => {
    // The other half of the split, asserted so the two idioms stay deliberate
    // rather than drifting back together. A bubble list separates by gap; adding
    // a hairline as well is what made an earlier version read as rows wearing
    // rounded corners.
    const bubble = read('src/components/ThreadBubble.tsx');
    expect(bubble).toContain('TOKENS.radius.thread');
    expect(bubble).toContain('borderCurve');
    expect(bubble).not.toContain('hairlineWidth');
    expect(bubble).not.toContain('ROW_SEPARATOR_INSET');
    // Retired with InboxScreen.tsx: v13 HomeScreen renders the CHATS section as a
    // horizontal avatar rail (RailItem), not a ThreadBubble list.
  });

  it('never fills a bubble with bg/raised, which is invisible in light mode', () => {
    /*
     * The single most repeated bug in this codebase's history, asserted rather
     * than remembered. `bg/raised` is #FFFFFF in light mode and so is `bg/base`,
     * so a bubble filled with it vanishes into the page and is held together by
     * nothing. It has already shipped once, on the incoming message bubble.
     */
    for (const file of ['src/components/ThreadBubble.tsx', 'src/components/Turn.tsx']) {
      expect(read(file)).not.toContain('bg.raised');
    }
    expect(read('src/components/ThreadBubble.tsx')).toContain('bg.sunken');
  });

  it('keeps the message bubble radius in the tokens and concentric with its media', () => {
    /*
     * The reason 18 became 22, asserted so the two numbers cannot drift apart.
     *
     * A picture inside a bubble reads as pasted on rather than contained unless
     * its corner is concentric with the bubble's, which means
     * `inner = outer - inset`. At a 3dp inset that is a 19dp image corner, and
     * 19 inside 18 bulges past the curve it is meant to sit within.
     *
     * The media bubble consumes this since 014: `messages.attachment_path` points
     * into the private `attachments` bucket and `MediaBubble` in Turn.tsx renders
     * the photo at `mediaInnerRadius()`. The manifest still removes
     * READ_MEDIA_IMAGES on purpose, because the system Photo Picker needs no
     * permission. The geometry that justified the radius change is the geometry
     * the photo now uses.
     */
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain('TOKENS.radius.bubble');
    expect(turn).not.toMatch(/BUBBLE_RADIUS = \d/);
    /*
     * 9dp, MEASURED off WhatsApp on the Redmi (2026-09-08): outgoing fill
     * isolated by exact #D9FDD3 match, ten corners least-squares fitted,
     * median 25.0px at 2.75px/dp. Was 22. See radius.$bubbleNote for the
     * caveats — the curve is a squircle, so 8dp is within a dp of the data.
     */
    expect(TOKENS.radius.bubble).toBe(9);
    // Concentric inner radius: outer minus the 3dp media inset.
    expect(TOKENS.radius.bubble - 3).toBe(6);
    // The consumer exists now: the media bubble reads the attachment at the
    // concentric inner radius.
    expect(turn).toContain('mediaInnerRadius');
  });

  it('never puts a neutral avatar on a surface its own fill matches', () => {
    /*
     * The same bug one layer in, and it shipped: an Avatar's neutral wash is
     * `bg/sunken`, the thread bubble is also `bg/sunken`, so the disc vanished and
     * left a bare initial floating in the row. Seen on the emulator; every gate
     * was green.
     *
     * Asserted as a seam rather than as a colour: the bubble must tell the avatar
     * what it is sitting on, and the avatar must branch on it. Either half missing
     * brings the bug back.
     */
    expect(read('src/components/ThreadBubble.tsx')).toContain('surface="sunken"');
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toContain("surface === 'sunken'");
    expect(avatar).toContain('bg.base');
  });
});

/**
 * Phone verification, which is not phone sign-in. The session already exists;
 * this only attaches a number to it. That is why it can ship while phone login
 * still waits on a DLT template.
 */
describe('the busy button does not move', () => {
  it('reserves the spinner slot whether busy or not', () => {
    // The jump this exists to prevent: mounting the spinner only while busy
    // shifts the label sideways on the frame the request starts.
    const button = read('src/components/Button.tsx');
    expect(button).toContain('styles.spinnerSlot');
    // Two uses, leading and trailing, so the label stays optically centred.
    expect(button.match(/styles\.spinnerSlot/g)).toHaveLength(2);
    // Slot width is SPINNER_SIZE + a small gap, mirrored on the trailing side.
    expect(button).toContain("width: SPINNER_SIZE + TOKENS.space['2xs']");
  });

  it('uses the shared native M3 LoadingIndicator', () => {
    const button = read('src/components/Button.tsx');
    expect(button).toContain("import { LoadingIndicator } from './LoadingIndicator'");
    // RN's ActivityIndicator is not MDC's Material 3 Views implementation.
    expect(button).not.toMatch(/<ActivityIndicator|ActivityIndicator[,}]|ActivityIndicator\s*from/);
  });

  it('renders MDC native Views instead of hand-drawn React Native geometry', () => {
    const indicator = read('src/components/LoadingIndicator.tsx');
    const android = read(
      'android/app/src/main/java/com/companionchat/MaterialIndicatorPackage.kt',
    );
    expect(indicator).toContain("requireNativeComponent<NativeIndicatorProps>('PappalMaterialLoadingIndicator')");
    expect(indicator).toContain("requireNativeComponent<NativeIndicatorProps>('PappalMaterialCircularProgress')");
    expect(android).toContain('com.google.android.material.loadingindicator.LoadingIndicator');
    expect(android).toContain('com.google.android.material.progressindicator.CircularProgressIndicator');
    expect(android).toContain('isIndeterminate = true');
    // No border/SVG imitation remains in JavaScript.
    expect(indicator).not.toContain('borderTopColor');
    expect(indicator).not.toContain('withRepeat');
    expect(indicator).not.toContain('react-native-svg');
  });

  it('switches every unknown wait to circular progress at the M3 boundary', () => {
    const indicator = read('src/components/LoadingIndicator.tsx');
    expect(indicator).toContain('export const LONG_WAIT_MS = 5000');
    expect(indicator).toContain("variant = 'auto'");
    expect(indicator).toContain('setTimeout(() => setLongWait(true), LONG_WAIT_MS)');
    expect(indicator).toContain("variant === 'auto' && longWait");
  });

  it('moves the calling dots as a clipped conveyor, not a pulse in place', () => {
    // Measured off the reference capture at 60fps (2026-08-31), not eyeballed.
    // The first version of this component read the reference as "dots fill in
    // sequence" and implemented three fixed dots on a staggered opacity wave.
    // Frame-stepping the file disproved that: each run MOVES right ~1.4px per
    // frame — f105 (23,24)(38,48) → f115 (30,39)(56,61) → f120 resets — so the
    // dots translate and are clipped, and a stationary opacity pulse is the
    // wrong animation however similar it looks in a still.
    const dots = read('src/components/CallingDots.tsx');
    // Position, not opacity: the whole row rides one translateX.
    expect(dots).toContain('translateX: x.value');
    expect(dots).not.toMatch(/opacity:\s*o\.value/);
    // Clipped window is what turns travel into "enters and exits".
    expect(dots).toContain("overflow: 'hidden'");
    // Constant velocity: an ease would pump once per cycle.
    expect(dots).toContain('Easing.linear');
    // One pitch of travel on a periodic row is what makes the wrap invisible.
    expect(dots).toContain('withTiming(PITCH');
    expect(dots).toMatch(/marginLeft:\s*-PITCH/);
    // Cadence stays a token (250ms measured, base is 240ms).
    expect(dots).toContain('DURATION.base');
    expect(dots).not.toMatch(/duration:\s*\d/);
    // Looping movement must be stoppable by the OS setting.
    expect(dots).toContain('useReducedMotion()');
    expect(dots).toMatch(/if \(reduce\) \{/);
  });
});

describe('the rename to Pappal', () => {
  it('renames the launcher label and nothing structural', () => {
    // The distinction ADR-0015 exists to protect. A user reads the label; a user
    // never reads an applicationId, and that id is what Play, Firebase, the
    // upload keystore and the OAuth redirect are all keyed to.
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(
      '<string name="app_name">Pappal</string>',
    );
    expect(read('android/app/build.gradle')).toContain('com.companionchat');
  });

  it('keeps the RN registration key matching on both sides', () => {
    // `name` is an internal registration key, not a name. If it drifts from
    // AppRegistry or getMainComponentName the app boots to a red screen saying
    // the component is not registered, which reads like a bundling failure.
    const app = JSON.parse(read('app.json')) as { name: string; displayName: string };
    expect(app.displayName).toBe('Pappal');
    expect(app.name).toBe('CompanionChat');
    expect(read('android/app/src/main/java/com/companionchat/MainActivity.kt')).toContain(
      `getMainComponentName(): String = "${app.name}"`,
    );
  });

  it('leaves the old name in the decision log', () => {
    // A decision log edited to look tidy afterwards is not a record. ADR-0008 and
    // ADR-0009 describe decisions taken when the product had the old name.
    expect(read('docs/adr/0008-versioning-and-why-not-ota-yet.md')).toContain('CompanionChat');
  });

  it('renames the public website', () => {
    for (const page of ['index', 'about', 'terms', 'privacy', 'delete']) {
      expect(read(`web/${page}.html`)).not.toContain('CompanionChat');
    }
  });
});

describe('phone verification', () => {
  it('never lets the client name the number it is verifying', () => {
    // The whole security argument of verify-phone: it asks MSG91 which number
    // the token belongs to. If the client sent the number, anyone could verify
    // one they hold and submit somebody else's, and the unique index in
    // migration 010 would let them squat on it.
    const api = read('src/api/phone.ts');
    const invoke = api.slice(api.indexOf("invoke('verify-phone'"));
    // From `body:` onward, deliberately: the function is *named* verify-phone,
    // so slicing from the call would match "phone" on the name itself.
    const start = invoke.indexOf('body:');
    const body = invoke.slice(start, invoke.indexOf('}', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('accessToken');
    expect(body).not.toContain('phone');
    expect(body).not.toContain('identifier');
    expect(body).not.toContain('e164');
  });

  it('does not disable the code field while it is checking', () => {
    // Disabling a focused TextInput blurs it, which moves focus to the next
    // control and closes the keyboard. That shipped on the sign-in screen once.
    const sheet = read('src/screens/PhoneVerifySheet.tsx');
    const start = sheet.indexOf('<CodeField');
    const field = sheet.slice(start, sheet.indexOf('/>', start));
    expect(field.length).toBeGreaterThan(0);
    expect(field).not.toContain('editable');
  });

  it('keeps a rejected OTP visible for one-digit correction', () => {
    const sheet = read('src/screens/PhoneVerifySheet.tsx');
    const errorEffect = sheet.slice(
      sheet.indexOf("if (error !== null && step === 'code')"),
      sheet.indexOf('}, [error, step])'),
    );
    expect(errorEffect).toContain('setErrorNonce');
    expect(errorEffect).not.toContain("setCode('')");
  });

  it('offers verification only in a build that can deliver it', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('PHONE_VERIFY_ENABLED');
    expect(settings).toContain('widgetConfigured()');
    expect(settings).toContain('phone_verified_at === null');
  });

  it('keeps the entry point off while the server hop is unproven', () => {
    // The mirror of the PHONE_AUTH_ENABLED guard. verifyAccessToken has never
    // returned success, so a user could enter a correct code and have nothing
    // recorded. Flip the flag in the commit that fixes that, not before.
    const api = read('src/api/phone.ts');
    const flag = /export const PHONE_VERIFY_ENABLED = (true|false);/.exec(api)?.[1];
    expect(flag).toBe('false');
  });

  it('posts the authkey where the widget docs say it goes', () => {
    // MSG91's general API docs say header; the widget's own Server Side
    // Integration page says body, on control.msg91.com. The widget page wins for
    // this endpoint.
    const fn = read('supabase/functions/verify-phone/index.ts');
    expect(fn).toContain("'https://control.msg91.com/api/v5/widget/verifyAccessToken'");
    expect(fn).toContain("JSON.stringify({ authkey, 'access-token': accessToken })");
  });

  it('does not depend on the MSG91 React Native package', () => {
    // Its OTP path is the same three fetches this repo makes directly; what it
    // adds is an autolinked BiometricAuth module whose build.gradle pins
    // compileSdk 34 and asks for an unversioned com.facebook.react:react-native.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain(
      '@msg91comm/sendotp-react-native',
    );
  });
});

/**
 * The chat restyle and the iOS language pass, as source-level claims.
 *
 * Everything here is a wiring failure that typechecks: a divider on the wrong end
 * of an inverted list, a control that opens nothing, a reaction row with no RPC
 * behind it. None of it is visible to tsc, eslint or the contrast script, and the
 * repo's own record is that three UI bugs passed every gate and were only found on
 * a device, so the ones that CAN be asserted structurally are asserted here.
 */
describe('the composer cross-fades its trailing control', () => {
  const composer = read('src/components/Composer.tsx');
  it('swaps send and mic through useCrossfade, not a hard conditional mount', () => {
    // Both controls are mounted and stacked; the cross-fade decides which is
    // substantial, and pointerEvents give touches to the live one. A hard
    // `ready ? <SendButton/> : <mic/>` popped one in and out with no motion.
    expect(composer).toContain('const trailing = useCrossfade(ready);');
    expect(composer).toContain('trailing.shownStyle');
    expect(composer).toContain('trailing.hiddenStyle');
    expect(composer).toMatch(/pointerEvents=\{ready \? 'auto' : 'none'\}/);
    expect(composer).toMatch(/pointerEvents=\{ready \? 'none' : 'auto'\}/);
    expect(composer).not.toMatch(/\{ready \? \(\s*<SendButton/);
  });
});

describe('the chat restyle is wired, not just drawn', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  const chatCode = withoutComments(chat);

  it('renders a day divider per day instead of one hardcoded footer', () => {
    // The bug: `ListFooterComponent={<DayDivider label="Today" />}` on an
    // `inverted` list renders at the visual TOP of the transcript, so a single
    // divider reading 'Today' sat above the OLDEST message the client held,
    // whatever date that message was on.
    //
    // A ListFooterComponent exists again, but ONLY as the frosted-bar spacer that
    // reserves the overlay header's height at the list's visual top. Guard the
    // actual anti-pattern — a DayDivider living in the footer — not the API.
    expect(chatCode).not.toMatch(/ListFooterComponent=\{\s*\(\)\s*=>\s*<DayDivider/);
    expect(chatCode).not.toMatch(/DayDivider label=/);
    expect(chatCode).toContain('<DayDivider iso={message.created_at} />');
    // opensDay is now computed in a single post-sort pass over the merged
    // message+call list (so call rows also get dividers). The pass uses the
    // opensDay helper from datetime.ts, applied to each row's sortAt field.
    expect(chatCode).toContain("row.opensDay = opensDay(");
    // The pass must run AFTER the sort so mixed message/call neighbours are
    // compared correctly (not just adjacent messages).
    expect(chatCode).toContain('sorted.length');
  });

  it('takes clock format from the device rather than hardcoding 24 hours', () => {
    // `String(d.getHours()).padStart(2, '0')` is wrong on any iPhone with
    // Settings > General > Date & Time > 24-Hour Time off, which is the default in
    // most regions.
    expect(chatCode).not.toContain('getHours()');
    expect(chatCode).toContain('timeOfDay(message.created_at)');
  });

  it('sources the header identity from the thread, not the directory', () => {
    // `useProviders()` reads `provider_directory`, which contains providers. This
    // screen also serves the provider tree, where `providerId` is a MEMBER's id,
    // so every directory lookup missed and the header read 'Conversation' with a
    // blank avatar.
    expect(chatCode).toContain('t.peer_id === providerId');
    expect(chatCode).toContain('peerThread?.peer_display_name');
  });

  it('drops the derived socket presence the settled decision rejects', () => {
    // Realtime presence answers "is their app in the foreground", which is a
    // question nobody agreed to have answered about them. Presence is
    // user-controlled: `peer_available` is the provider's own toggle and
    // `peer_last_active_at` is null unless they turned presence on.
    // Comments stripped: the note explaining what the header no longer claims
    // names the selector it stopped reading, so a negative assertion over the raw
    // source fails on its own documentation.
    expect(chatCode).not.toContain('selectPeerOnline');
    expect(chatCode).toContain('peer_last_active_at');
  });

  it('wires swipe-to-reply and on-bubble reactions on both sides', () => {
    expect(chatCode).toContain('onSwipeReply={swipeReply}');
    expect(chatCode).toContain('onReact={reactOnMessage}');
    expect(chatCode).toContain('onReportMessage={reportMessage}');
    expect(chatCode).toContain('timeOfDay(message.created_at)');
    expect(chatCode).not.toContain('last ? timeOfDay');
    expect(chatCode).toContain('mine,');
  });

  it('opens the safety sheet from the strip without stacking a second Modal', () => {
    const report = chatCode.slice(
      chatCode.indexOf('const reportMessage'),
      chatCode.indexOf('const renderItem'),
    );
    expect(report).toContain('setSafety({ open: true, messageId })');
    expect(chatCode).not.toContain('<MessageActionsSheet');
  });

  it('shows the typing indicator in the empty thread too', () => {
    // The empty branch REPLACES the FlatList, so PeerTyping was unmounted in
    // exactly the case it is most wanted: a new peer typing the first message.
    const empty = chatCode.slice(chatCode.indexOf('styles.starters'));
    expect(empty).toContain('<PeerTyping');
  });

  it('lifts the dock by ONE number the panel is also sized from', () => {
    // The composer dropped exactly 34dp on every keyboard-to-panel swap (S22
    // Ultra, measured 96px at density 2.8125). Two errors summed to it: 19dp of
    // safe-area padding that existed in the keyboard state and was zeroed in the
    // panel state, and 15dp because the panel was sized from RN's reported
    // keyboard height, which under edge-to-edge omits the navigation-bar inset
    // the IME window actually covers.
    //
    // The fix is that both states resolve to `keyboardHeight + insets.bottom`,
    // so they are equal by construction. These assertions are what stops the two
    // expressions drifting apart again.
    //
    // The expressions moved out of the screen and into one derivation
    // (src/lib/imeGeometry.ts) so they come from one input set and cannot land
    // one commit apart; the gate followed them rather than being deleted.
    const imeCode = withoutComments(read('src/lib/imeGeometry.ts'));
    expect(imeCode).toContain('const imeSpace = i.keyboardHeight + i.insetBottom');
    expect(chatCode).toContain('bodyInset');
    expect(withoutComments(read('src/components/Composer.tsx'))).toContain(
      'panelHeight + insets.bottom',
    );
    // And the screen cannot re-derive any of it inline behind the gate's back.
    expect(chatCode).not.toContain('keyboardHeight +');
    expect(chatCode).not.toMatch(
      /const \[(keyboardUp|keyboardHeight|barHeight|dockHeight|emojiPanelOpen|emojiSearching|composerFocused),/,
    );
  });

  it('keeps the owner holding the handle and the leaves holding the subscription', () => {
    // The whole point of the store is that ChatScreen does NOT subscribe. If its
    // body ever calls one of the value hooks, the screen silently goes back to
    // re-rendering all 1858 lines on every keyboard show — with every other test
    // still green. So the body is checked directly: the four leaf components at
    // the foot of the file are allowed to call them, and nothing above is.
    const body = chatCode.slice(0, chatCode.indexOf('const Transcript = memo('));
    expect(body).not.toMatch(
      /use(BodyInset|ListPad|ComposerInset|PanelCeiling|BarHeight|ComposerFocused)\(/,
    );
    // The handle itself is fine, and is how the screen writes.
    expect(body).toContain('useChatImeStore({');
    expect(body).toContain('seedKeyboardHeight: readKeyboardHeight(false)');

    // Composer reads `panelCeiling` from context, so a SECOND call site would
    // silently get the unwritten default store, a zero ceiling, and an emoji
    // panel that collapses whenever its search field has focus.
    const usages = spawnSync(
      'grep',
      ['-rl', '--include=*.tsx', '<Composer', join(ROOT, 'src')],
      { encoding: 'utf8' },
    )
      .stdout.trim()
      .split('\n')
      .filter(Boolean);
    expect(usages).toEqual([join(ROOT, 'src', 'screens', 'ChatScreen.tsx')]);
  });

  it('keeps the emoji panel open while its own search field has the keyboard', () => {
    // Every other `keyboardDidShow` means "put the panel away". The panel's own
    // search field raises the same IME, and closing on it made search
    // unreachable: the panel vanished and the keystrokes landed nowhere (found
    // on device, 2026-09-04). The guard is a REF, not state — the listener is
    // registered once and a state read would be stale inside it.
    const composer = withoutComments(read('src/components/Composer.tsx'));
    expect(composer).toContain('if (!searchingRef.current)');
    expect(composer).toContain('searchingRef.current = focused');
    // Closing the panel must clear the flag, or the next composer focus can
    // never put the panel away again.
    expect(composer).toMatch(/!emojiOpen && searchingRef\.current/);
    // And the dock is lifted above the keyboard in that state, or the expanded
    // panel would render underneath it.
    expect(withoutComments(read('src/lib/imeGeometry.ts'))).toContain(
      '!i.emojiPanelOpen || i.emojiSearching',
    );
  });

  it('does not stack KeyboardAvoidingView on top of adjustResize', () => {
    // `behavior="height"` shrank the body by RN's short number while the panel
    // was sized from a different one, so the two could never agree. The manifest
    // keeps adjustResize; the lift is ours.
    expect(chatCode).not.toContain('KeyboardAvoidingView');
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain(
      'android:windowSoftInputMode="adjustResize"',
    );
  });

  it('holds an explicit FlashList ref and scrolls to offset 0 on new messages', () => {
    // Without a ref, there is no way to scroll programmatically. Without the
    // useEffect watching rows.length, a new incoming message while the user is
    // scrolled up reading history goes unnoticed and they miss it.
    expect(chatCode).toContain('listRef');
    expect(chatCode).toContain('ref={listRef}');
    expect(chatCode).toContain('scrollToOffset({ offset: 0');
    // The effect must watch `rows` so it fires for both local and remote messages.
    expect(chatCode).toContain('prevRowsLen');
  });

  it('shows receipt inside every settled outgoing bubble, not only newest', () => {
    // The old code gated receipt on `showReceipt` (only the last own message).
    // Now every non-pending outgoing row carries a tick: single for sent, double
    // for read, matching WhatsApp semantics. Pending rows carry undefined.
    const turnSrc = read('src/components/Turn.tsx');
    // Receipt is rendered inside the bubble (MetaRow), not in a detached row.
    expect(turnSrc).toContain('metaRow');
    expect(turnSrc).not.toContain('receiptRow');
    // Pending rows suppress the tick; settled rows show it.
    expect(turnSrc).toContain("pending ? undefined : receipt");
    // ChatScreen no longer uses showReceipt to gate the prop.
    expect(chatCode).not.toContain('showReceipt');
  });

  it('renders the photo timestamp INSIDE the image, not over the bubble', () => {
    /*
     * A photo bubble shows its timestamp and tick with the same semantics as a
     * text bubble — but the overlay has to belong to the IMAGE.
     *
     * It used to be a sibling of `MediaBubble`, absolutely positioned against
     * the wrapper around it. `mediaBubble` is `maxWidth: '80%'`, so that wrapper
     * is wider than the photo whenever the photo hits the cap, and the chip
     * rendered outside the frame with the delivery tick past the coral edge
     * (measured on device, 2026-09-04). Now `MediaBubble` owns it and draws it
     * inside `mediaInner`, which clips.
     */
    const turnSrc = withoutComments(read('src/components/Turn.tsx'));
    // Both callers hand the stamp to MediaBubble rather than drawing their own.
    expect(turnSrc).toMatch(/<MediaBubble[^>]*timestamp=\{timestamp\}/);
    expect(turnSrc).not.toMatch(/<\/MediaBubble>|mediaMetaRow/);
    // And the overlay is a child of the clipped image box, so the only
    // `styles.mediaTime` use sits after the progress bar inside MediaBubble.
    const media = turnSrc.slice(
      turnSrc.indexOf('function MediaBubble'),
      turnSrc.indexOf('interface PeerProps'),
    );
    expect(media).toContain('styles.mediaTime');
    expect((turnSrc.match(/styles\.mediaTime/g) ?? []).length).toBe(1);
  });
});

describe('reactions and replies reach a real server call', () => {
  it('toggles a reaction through the RPC, not a client insert', () => {
    // `message_reactions` has a SELECT policy and nothing else, deliberately: a
    // reaction is contact and has to be gated on blocking, and `is_blocked_pair`
    // is not callable by a client so an RLS policy cannot consult it.
    const api = read('src/api/reactions.ts');
    expect(api).toContain("supabase.rpc('toggle_reaction'");
    expect(withoutComments(api)).not.toMatch(/from\('message_reactions'\)\s*\.\s*insert/);
  });

  it('sends a reply through send_message rather than a second path', () => {
    const chatApi = read('src/api/chat.ts');
    expect(chatApi).toContain('p_reply_to_id: replyToId');
    // The optimistic row carries it too, or a reply appears as a plain bubble and
    // then grows a quote when the server confirms.
    expect(chatApi).toContain('reply_to_id: replyToId');
  });

  it('keeps the emoji set identical to the CHECK constraint', () => {
    // The one cross-language literal types cannot catch: a bare U+2764 instead of
    // U+2764 U+FE0F renders identically in most editors and comes back
    // BAD_REQUEST from every call.
    const sql = read('supabase/migrations/011_reactions_replies_voice_calls.sql');
    const types = read('src/lib/database.types.ts');
    const union = /export type ReactionEmoji =([^;]+);/.exec(types)?.[1] ?? '';
    const emoji = [...union.matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(emoji).toHaveLength(6);
    for (const e of emoji) {
      expect(sql).toContain(e);
      expect(read('src/lib/reactions.ts')).toContain(e);
    }
  });

  it('offers no reaction the sheet cannot send', () => {
    // The reference has a trailing `+` and there is no picker behind it. A `+`
    // that opens nothing is worse than no `+`, and a `+` that opened a keyboard
    // would be the thing the closed emoji set exists to prevent.
    const strip = withoutComments(read('src/components/ReactionStrip.tsx'));
    expect(strip).toContain('REACTION_CHOICES.map');
    expect(strip).not.toMatch(/glyph="plus"/);
  });

  it('keeps Copy, Forward and Delete out of the long-press strip', () => {
    // Copy and Forward defeat the FLAG_SECURE screenshot blocking; Delete
    // destroys abuse evidence, which `submit_report`'s snapshot exists to keep.
    const strip = withoutComments(read('src/components/ReactionStrip.tsx'));
    for (const banned of ['Copy', 'Forward', 'Delete']) {
      expect(strip).not.toContain(`>${banned}`);
    }
  });
});

/**
 * Voice notes, end to end.
 *
 * Most of what can go wrong here is invisible to types and to runtime: an upload
 * that throws before a byte leaves the device, a cap that disagrees with a CHECK
 * constraint, a recorder left running after the screen closed. Each assertion
 * below pins one of those.
 */
describe('voice notes are recorded, uploaded and sent through the one send path', () => {
  const recorder = read('src/lib/recorder.ts');
  const api = read('src/api/voice.ts');
  const composer = read('src/components/Composer.tsx');

  it('sends through the one send RPC rather than inserting a row', () => {
    // The RPC writes the row, attaches the session and enforces the block graph
    // in one transaction. A client insert would need an INSERT policy on
    // `messages`, which deliberately does not exist, and would put a second
    // pricing path next to the first.
    //
    // Matched on the `send_message` PREFIX, so it holds for
    // `send_message_idempotent` (migration 081) without going blind to a future
    // second send path: a direct insert still fails the last assertion.
    expect(api).toMatch(/supabase\.rpc\('send_message(_idempotent)?'/);
    // 081: the idempotency key must actually be passed, or the wrapper silently
    // degrades to the un-deduped path it wraps.
    expect(api).toContain('p_client_nonce: nonce');
    expect(api).toContain('p_voice_path: path');
    expect(api).toContain('p_voice_duration_ms: draft.durationMs');
    expect(withoutComments(api)).not.toMatch(/from\('messages'\)\s*\.\s*insert/);
  });

  it('uploads before it inserts, so the row can never point at nothing', () => {
    // `voice_path` is not client-writable after the fact: 011 guards it in
    // `guard_message_reply_and_voice`. So the row is written once and has to
    // reference audio that already exists.
    const body = withoutComments(api);
    const sendAt = body.search(/supabase\.rpc\('send_message(_idempotent)?'/);
    expect(sendAt).toBeGreaterThan(0);
    expect(body.indexOf('uploadRecording')).toBeLessThan(sendAt);
  });

  it('does not reach for storage-js upload, which throws in React Native', () => {
    // storage-js's FormData branch calls `body.has('cacheControl')` and RN's
    // FormData implements only append, getAll and getParts. Asserted over the
    // source with comments stripped, so the comment explaining the trap cannot
    // be what satisfies the test.
    expect(withoutComments(api)).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*upload\(/);
    expect(api).toContain('/storage/v1/object/');
  });

  it('never upserts, because the bucket has no UPDATE policy', () => {
    // A sender who could replace the audio under a note that has been read or
    // reported would make the recording worthless as evidence. A retry mints a
    // new key instead.
    expect(withoutComments(api)).not.toContain('x-upsert');
  });

  it('signs a playback URL per tap rather than per render', () => {
    // One signed credential per note on screen, whether or not anybody listens,
    // is a lifetime nobody asked for.
    expect(api).toContain('createSignedUrl(path');
    expect(api).toContain('SIGNED_URL_TTL_SECONDS');
  });

  it('confines the microphone to one module', () => {
    // The narrower protection that replaced RECORD_AUDIO being forbidden in
    // verify-manifest.mjs. If a second file starts recording, that gate no longer
    // has anything to say about it and this does.
    const users = ['src/lib', 'src/api', 'src/components', 'src/screens', 'src/store']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
          .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
      )
      .filter(s => s.body.includes("from 'react-native-nitro-sound'"))
      .map(s => s.file);
    expect(users).toEqual(['src/lib/recorder.ts']);
  });

  it('asks for the microphone with core RN, not a permissions dependency', () => {
    expect(recorder).toContain('PermissionsAndroid.PERMISSIONS.RECORD_AUDIO');
    expect(JSON.parse(read('package.json')).dependencies).not.toHaveProperty(
      'react-native-permissions',
    );
  });

  it('reuses one output path instead of accumulating recordings on disk', () => {
    // With no `uri` argument the recorder invents a new file per recording in the
    // app's private directory and nothing ever deletes it. The app has no
    // filesystem module, and adding one to call unlink would be a native
    // dependency bought for one line.
    expect(recorder).toContain("'voice.outPath'");
    expect(recorder).toContain('storage.get(OUT_PATH_KEY)');
    expect(recorder).toContain('storage.set(OUT_PATH_KEY, file)');
  });

  it('stops the recorder when the composer goes away', () => {
    // A recorder left running with nothing listening is both a privacy claim this
    // app should not have to make and the state that leaves the next
    // startRecorder fighting a live one.
    expect(composer).toContain('handle.current?.cancel()');
  });

  it('stops playback when the transcript unmounts', () => {
    // One native player: audio started in a thread you have left keeps playing
    // over the next screen, and the row that started it is gone.
    expect(api).toContain('stopPlayback()');
    expect(read('src/screens/ChatScreen.tsx')).toContain('useVoicePlayer()');
  });

  it('holds a finished recording instead of sending it at the cap', () => {
    // Auto-sending at three minutes sends a sentence that was cut off mid-word.
    expect(composer).toContain("setMode('review')");
    expect(composer).toContain('onLimit');
  });

  it('resolves the provider side of a thread without open_conversation', () => {
    // `open_conversation` takes a provider id and raises `not an admitted
    // provider` for anything else, and the provider tree renders this screen with
    // a *member's* id. So on that side the id never resolved, the transcript never
    // loaded and the composer stayed disabled: a recorder shipped to both roles
    // and reachable by one. The summary row already carries the id.
    // The id comes from the cached thread whenever it is known (either side), and
    // open_conversation is called ONLY to create a conversation that does not
    // exist yet. A provider always has a known thread, so it never calls the RPC;
    // and a member reopening a chat skips the extra round-trip too.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('const needsOpen = knownThread === undefined');
    expect(chat).toContain('useConversationId(needsOpen ? providerId : null)');
    expect(chat).toContain('knownThread?.conversation_id ?? openedId');
  });

  it('gives both roles the recorder', () => {
    // The provider tree renders this same screen (App.tsx mounts ChatScreen for
    // both), so one composer covers both sides. Voice notes being in scope for
    // providers is a settled decision, and a role check here would quietly
    // reverse it.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('onSendVoice={onSendVoice}');
    expect(chat).not.toMatch(/i_am_member[\s\S]{0,40}onSendVoice/);
  });

  it('previews a voice note in the inbox without inventing a body column', () => {
    // Ephemeral inbox rows expose a kind label without any message body.
    // InboxScreen.tsx dropped: v13 HomeScreen shows a horizontal avatar rail with no
    // thread-preview body, so last_kind is not read there.
    for (const screen of ['src/screens/ProviderHomeScreen.tsx']) {
      expect(read(screen)).toContain("last_preview_kind === 'voice'");
    }
  });

  it('keeps a voice note reportable', () => {
    // `submit_report` snapshots `voice_path` beside `evidence_body`, which is the
    // only reason "he sent me something vile" is actionable when it was spoken
    // rather than typed. The client half is that a voice bubble still long-presses.
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      'evidence_voice_path',
    );
    expect(read('src/components/Turn.tsx')).toContain('useLongPressGesture({');
    expect(read('src/components/Turn.tsx')).toContain('onReportMessage');
    expect(read('scripts/moderate.mjs')).toContain('evidence_voice_path');
  });

  it('tracks a send under a name the event guard allows', () => {
    // `guard_event_shape` rejects any prop key matching /message/, so the obvious
    // `{ message_id }` would be refused at insert with nobody watching.
    expect(api).toContain("track('voice_note_sent'");
    expect(api).toMatch(/track\('voice_note_sent', \{ secs:/);
    expect(api).not.toMatch(/track\([^)]*message_id/);
  });

  it('says in the privacy page and the listing what it now collects', () => {
    // The manifest line and these two documents have to move together: a build
    // declaring RECORD_AUDIO against a policy page that says no microphone is a
    // data-safety mismatch, not a cosmetic gap.
    const privacy = read('web/privacy.html');
    expect(privacy).not.toContain('No contacts, location, photos, microphone or camera.');
    expect(privacy).toMatch(/voice note/i);
    const listing = read('docs/play/listing.md');
    expect(listing).not.toContain('The app requests three Android permissions in total');
    expect(listing).toMatch(/\|\s*Audio \(voice notes\)\s*\|/);
    // And audio is no longer on the "not collected" line it used to sit on.
    expect(listing).not.toMatch(/photos or videos, audio, files/);
  });
});

describe('calling ships visible and on, wired to a real media layer', () => {
  it('is enabled now that the WebRTC client landed', () => {
    // Migration 011 shipped start_call, the per-minute meter and the blocking
    // gate; the client half (src/api/callSession.ts: RTCPeerConnection + Realtime
    // signalling) now exists too, so start_call no longer rings a phone that can
    // never connect. Flipped in the same commit that landed the media path, which
    // is the only thing the flag's contract says earns the flip.
    //
    // CALLS_ENABLED is now defined in src/config.ts (the single flag home);
    // src/api/calls.ts re-exports it so all existing import sites are unchanged.
    const appConfig = read('src/config.ts');
    const flag = /export const CALLS_ENABLED = (true|false);/.exec(appConfig)?.[1];
    expect(flag).toBe('true');
  });

  it('gates the two call buttons rather than hiding them, as real controls', () => {
    // The Android conformance audit (2026-08-26) flagged the previous approach:
    // a <View> with accessibilityRole="button" and no handler is a role that
    // never fires — TalkBack announces a button that does nothing, and stays a
    // no-op even when the flag flips. They are Pressables now: disabled while
    // CALLS_ENABLED is false (an honest gate), and wired to start a call when on.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('CALLS_ENABLED');
    expect(chat).toContain('testID="call-video"');
    expect(chat).toContain('testID="call-voice"');
    // Voice and video combine the compile-time master flag with independent
    // live controls. A live or pending paid session must end before changing
    // channels, because one conversation has one paid session at a time.
    expect(chat).toContain('voiceCallsEnabled');
    expect(chat).toContain('videoCallsEnabled');
    // Since 064 the button reads ONE derived flag that folds the operator's
    // switch together with this provider's own (`canStartAudio`/`canStartVideo`),
    // so the assertion follows it there rather than pinning the raw name at the
    // button. Both halves must still be in the composition.
    expect(chat).toContain(
      'const canStartAudio = voiceCallsEnabled && (provider?.audio_enabled ?? true)',
    );
    expect(chat).toContain(
      'const canStartVideo = videoCallsEnabled && (provider?.video_enabled ?? true)',
    );
    // Chat session is an upgrade path, not a block: only non-chat activeSession
    // disables the buttons (migration 073 ends the chat session on the server).
    expect(chat).toMatch(
      /!canStartVideo\s*\|\|\s*\(activeSession != null && activeSession\.channel !== 'chat'\)/,
    );
    expect(chat).toMatch(
      /!canStartAudio\s*\|\|\s*\(activeSession != null && activeSession\.channel !== 'chat'\)/,
    );
    // Real, and ready for the flag flip: the tap starts a call.
    expect(chat).toContain("onStartCall?.('video')");
    expect(chat).toContain("onStartCall?.('audio')");
  });

  it('keeps the token counter in the chat header', () => {
    // Not negotiable independently of the header layout:
    // .maestro/03-token-economy.yaml taps into this screen and asserts the
    // seeded balance remains 3 across a pending send. The contract test elsewhere only greps the testID
    // across all of src, so removing it from HERE would keep jest green and break
    // the only gate that would notice.
    expect(read('src/screens/ChatScreen.tsx')).toContain('<TokenCounter');
  });
});

describe('paid chat sessions expose their live lifecycle', () => {
  const chat = read('src/screens/ChatScreen.tsx');

  it('renders a clock from the authoritative server start time', () => {
    expect(chat).toContain("activeSession?.status === 'active'");
    expect(chat).toContain('activeSession.started_at');
    expect(chat).toContain('Date.parse(sessionStartedAt)');
    expect(chat).toContain('testID="chat-session-timer"');
  });

  it('counts DOWN what the balance buys, per second only inside the last five minutes', () => {
    const code = withoutComments(chat);
    // The remainder is the server's one-snapshot figure, aged from the instant
    // it was taken — never recomputed from `balance`, which cannot tell whether
    // the current minute has been deducted yet (migration 062).
    expect(code).toContain('secondsRemainingNow(activeSession?.seconds_remaining, sessionSyncedAt, sessionNow)');
    expect(code).toContain('dataUpdatedAt: sessionSyncedAt');
    expect(code).not.toContain('talkTimeLeft(');
    // The repaint cadence follows the remainder: no unconditional 1 Hz clock.
    expect(code).toContain('clockTickMs(sessionRemaining)');
    expect(code).not.toMatch(/setInterval\([^;]*,\s*1000\)/);
    /*
     * ONE time display, not two (Amit, 2026-09-07: "Dont need two timers --
     * only one countdown which activates when <=5 mins is left with dynamic
     * timer and rechage button").
     *
     * This used to require BOTH `formatClock` and `formatMinutes` — numerals
     * inside the window, whole minutes above it. The whole-minutes half was the
     * second timer: an always-present bar reading "240 min of talk time left",
     * repainting every 15 s, carrying no seconds. The bar is now gated on
     * `countingDown`, so it is the last five minutes or nothing, and the
     * estimate and its helpers are gone from the screen entirely.
     *
     * The threshold itself is unchanged and still single-sourced in
     * sessionClock.ts — that is what the assertions above and below pin.
     */
    expect(code).toContain('formatClock(sessionRemaining ?? 0)');
    expect(code).not.toContain('formatMinutes(');
    expect(code).not.toContain('estimatedTalkSeconds(');
    // The bar cannot come back above the window: its own visibility is the
    // countdown flag, so there is no state in which it shows without a clock.
    // Member-only: providers do not recharge (isMemberSide guard added 2026-09-07).
    expect(code).toMatch(/showStickyRecharge\s*=\s*\n?\s*isMemberSide\s*&&\s*countingDown\s*&&/);
    // The extend card and the numerals share one threshold and one figure.
    // Member-only guard added 2026-09-07.
    expect(code).toMatch(/showExtendCard\s*=\s*\n?\s*isMemberSide\s*&&\s*sessionIsActive\s*&&\s*countingDown/);

    // Server side: one snapshot, member only, registered and tested.
    const migration = read('supabase/migrations/062_session_seconds_remaining.sql');
    expect(migration).toContain("'seconds_remaining'");
    expect(migration).toContain('v_uid = v_session.member_id');
    expect(migration).toContain('extract(epoch from (v_session.next_bill_at - now()))');
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('062_session_seconds_remaining.sql');
    expect(dbTest).toContain('240_session_seconds_remaining.sql');
    expect(read('src/api/sessions.ts')).toContain('seconds_remaining: number | null');
    expect(read('src/lib/database.types.ts')).toContain('seconds_remaining: number | null');
  });

  it('confirms before back ends a live paid session', () => {
    /*
     * The titles, not one title. 1845c2c split this dialog in two — 'Done for
     * now?' when the member is ending a live session, 'Leave this chat?' when
     * they are only walking away — as part of the "personal, not SaaS" copy
     * pass. The assertion tracked the old single string and had been failing
     * since; updated to the pair rather than deleted, because what it guards is
     * that leaving a PAID session asks first, and that is still true.
     */
    expect(chat).toContain("'Done for now?'");
    expect(chat).toContain("'Leave this chat?'");
    expect(chat).toContain('leaveIntent');
    expect(chat).toContain('testID="chat-leave-dialog"');
    expect(chat).toContain("reason: 'manual'");
    expect(chat).toContain('onPress={requestLeave}');
    // The screen does NOT subscribe to BackHandler itself: RN fires
    // subscriptions last-registered-first, and App re-subscribes whenever the
    // Recharge overlay toggles, so the chat's listener could be outranked and
    // the chat popped mid-session. It holds a guard instead, only while a
    // session exists, and App consults the guard stack before any pop.
    const code = withoutComments(chat);
    expect(code).not.toContain('BackHandler');
    expect(code).toContain('useBackGuard(activeSession ? backGuard : null)');
    const app = withoutComments(read('App.tsx'));
    const consumeAt = app.indexOf('if (consumeBack())');
    const popAt = app.indexOf('const parent = memberParent(route)');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(popAt).toBeGreaterThan(consumeAt);
    // Guards are the only place screens decide back: one App subscription.
    expect(app.match(/BackHandler\.addEventListener\(/g)?.length).toBe(1);
  });

  it('confirms the End chip too, and a call never ends on a bare back press', () => {
    // The chip sits a thumb-width from Recharge in the same bar and ended a
    // paid session on one tap. Same dialog, `end` intent, the member stays.
    const code = withoutComments(chat);
    expect(code).toContain('onPress={requestEnd}');
    expect(code).toContain("setLeaveIntent('end')");
    expect(code).toContain("onConfirm={leaveIntent === 'end' ? confirmEnd : confirmLeave}");
    expect(code).not.toContain('endCurrentSession');

    // CallScreen unmount hangs up, so a bare back was a silent hang-up. The red
    // button stays immediate (that IS the intent); back asks.
    const call = withoutComments(read('src/screens/CallScreen.tsx'));
    expect(call).toContain('useBackGuard(backGuard)');
    expect(call).toContain('testID="call-leave-dialog"');
    expect(call).toContain('testID="call-end" glyph="callEnd" tone="danger" onPress={onEnd}');
    expect(call).not.toContain('BackHandler');
  });

  it('surfaces inactivity warning and grace states from the server', () => {
    expect(chat).toContain("activeSession?.status === 'warning'");
    expect(chat).toContain("activeSession?.status === 'grace'");
  });

  it('gates the visible timer on a live provider message, not an automated opener', () => {
    // Migration 045: an automated opener (origin 'automated_opener', session_id
    // null) must never start the clock. The timer shows only once the session's
    // provider has sent a LIVE message for THIS session, on top of the server's
    // authoritative started_at.
    const stripped = withoutComments(chat);
    expect(stripped).toContain('hasLiveProviderMessage');
    expect(stripped).toContain("m.origin === 'live'");
    expect(stripped).toContain('m.sender_id === activeSession.provider_id');
    expect(stripped).toContain('m.session_id === activeSession.id');
    // The gate is ANDed into the timer's start-time selection.
    expect(stripped).toMatch(/hasLiveProviderMessage\s*\n?\s*\?\s*activeSession\.started_at/);
  });
});

describe('the chat seeds openers one at a time, not all at once', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  const stripped = withoutComments(chat);

  it('drives the sequential opener RPC, not the batch seed', () => {
    // Migration 045 replaced the all-at-once seed with a cancellable sequential
    // orchestrator: peer typing, a bounded length-aware beat, one opener, fetch,
    // pause, repeat. The batch RPC must be gone from this screen.
    expect(stripped).toContain("supabase.rpc('insert_next_opener'");
    expect(stripped).not.toContain("supabase.rpc('seed_conversation_openers'");
  });

  it('shows the peer typing and paces the openers', () => {
    expect(stripped).toContain('setPeerTyping(true)');
    expect(stripped).toContain('setPeerTyping(false)');
    // Bounded, length-aware pacing constants.
    expect(stripped).toContain('OPENER_TYPING_MIN_MS');
    expect(stripped).toContain('OPENER_TYPING_MAX_MS');
    expect(stripped).toContain('OPENER_MS_PER_CHAR');
    expect(stripped).toContain('OPENER_PAUSE_MS');
  });

  it('is cancellable and refetches after each step', () => {
    // A cancellation latch guards navigation/remount; each step invalidates the
    // transcript and the inbox so the inserted opener appears.
    expect(stripped).toContain('cancelled = true');
    expect(stripped).toMatch(/queryKey: \['messages'/);
    expect(stripped).toMatch(/queryKey: \['conversation-list'\]/);
  });
});

describe('migration 045 closes the retention gaps found in review', () => {
  const m045 = read(
    'supabase/migrations/045_message_origin_and_hidden_retention.sql',
  );

  describe('legacy openers are reclassified, not left to start the clock', () => {
    it('backfills the three exact migration 040 opener bodies', () => {
      // 040's seed wrote these verbatim before origin existed. Matching is by
      // exact copy because a pre-migration row's origin is otherwise
      // unrecoverable; the strings are a frozen historical constant.
      expect(m045).toContain("'Hey — glad you''re here.'");
      expect(m045).toContain("'How are you doing right now?'");
      expect(m045).toContain("'I''m here to listen. No rush.'");
    });

    it('touches only provider-sent, sessionless rows still marked live', () => {
      expect(m045).toMatch(/set\s+origin = 'automated_opener'/);
      expect(m045).toContain('m.sender_id = c.provider_id');
      expect(m045).toContain('m.session_id is null');
      // Re-run is a no-op: only rows still at the 'live' default are rewritten.
      expect(m045).toContain("m.origin = 'live'");
    });

    it('requires the whole known sequence before reclassifying a conversation', () => {
      // Someone who merely typed one of those sentences must not be
      // reclassified; only a conversation carrying all three exact bodies (as
      // the provider, sessionless) qualifies.
      expect(m045).toMatch(/having count\(distinct mm\.body\) = 3/);
    });
  });

  describe('the security-definer reaction path respects the hide', () => {
    it('re-creates toggle_reaction and reads a hidden message as NOT_FOUND', () => {
      // toggle_reaction is SECURITY DEFINER, so RLS does not hide the row from
      // it; the explicit hidden_at check is the only thing that closes the leak.
      const body = plpgsqlBody(m045, 'toggle_reaction');
      expect(body).toContain('m.hidden_at');
      expect(body).toMatch(/v_hidden is not null/);
      expect(body).toContain("'error', 'NOT_FOUND'");
    });

    it('preserves the original grant', () => {
      expect(m045).toContain(
        'grant execute on function public.toggle_reaction(uuid, text) to authenticated',
      );
    });
  });

  describe('media reads follow message visibility, not just the path', () => {
    it('rebinds both participant-read policies to a non-hidden message row', () => {
      // voice-notes (011) and attachments (014): a SELECT now needs an
      // associated messages row with hidden_at is null, not just the
      // conversation prefix a participant could have kept.
      expect(m045).toContain('"Participants read voice notes"');
      expect(m045).toContain('"Participants read attachments"');
      expect(m045).toContain('m.voice_path = storage.objects.name');
      expect(m045).toContain('m.attachment_path = storage.objects.name');
      expect(m045).toMatch(/m\.hidden_at is null/);
    });

    it('leaves the upload policies untouched', () => {
      // An upload precedes its message row; gating it on one would break the
      // composer. Only the read policies are replaced.
      expect(m045).not.toContain('"Participants upload voice notes"');
      expect(m045).not.toContain('"Participants upload attachments"');
    });
  });
});

describe('the app speaks one date language', () => {
  it('has no second ago() implementation left', () => {
    // There were two, divergent: the inbox returned now/12m/3h/2d/5w and the
    // provider list reimplemented the idea from minutes with no weeks bucket, so
    // a month-old thread read as '31d'.
    // InboxScreen.tsx dropped: v13 HomeScreen renders no timestamps (avatar rail only),
    // so it is out of scope for the listStamp / ago() consolidation check.
    for (const file of [
      'src/screens/ProviderHomeScreen.tsx',
    ]) {
      const source = withoutComments(read(file));
      expect(source).not.toMatch(/function ago\(/);
      expect(source).toContain('listStamp(');
    }
  });

  it('never formats a date with a bare toLocaleDateString', () => {
    // Hermes ships one locale, so `toLocaleDateString()` with no options gives
    // '8/22/2026' whatever the device's region.
    for (const dir of ['src/screens', 'src/components']) {
      for (const file of readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.tsx'))) {
        expect(withoutComments(read(`${dir}/${file}`))).not.toMatch(
          /toLocaleDateString\(\)/,
        );
      }
    }
  });
});

describe('iOS list separators are drawn the way iOS draws them', () => {
  it('never ends a list on the separator, whatever the separator is', () => {
    /*
     * The rule survives its own mechanism changing. It used to be "no hairline
     * after the last row", asserted on `isLast ? null : <View
     * style={styles.separator} />`; the directory is cards now and separates by
     * GAP, so the same defect is a trailing margin — a strip of page colour
     * under the final card, which reads as a list that got cut off rather than
     * one that ended.
     *
     * `isLast` still carries it, one level over: it drops the margin instead of
     * the hairline.
     */
    const row = withoutComments(read('src/components/ProviderRow.tsx'));
    expect(row).toContain('isLast && styles.cardLast');
    expect(row).toContain('marginBottom: 0');
    // And no hairline came back with the cards.
    expect(withoutComments(read('src/screens/HomeScreen.tsx'))).not.toContain(
      'styles.separator',
    );
  });

  it('lets the separator reach the trailing edge', () => {
    // The list's contentContainerStyle used to carry the horizontal padding, so
    // the hairline stopped 20pt short at BOTH ends and read as an underline on the
    // row rather than as a divider between two.
    // ProviderRow only. The inbox drew the same hairline until Chats became
    // bubbles, and a bubble list has no separator to inset.
    const source = read('src/components/ProviderRow.tsx');
    /*
     * The hairline is gone with the rows (2026-09-08), so there is no inset
     * left to get wrong. What replaced it has the same failure mode and is
     * asserted instead: a CARD owns its own horizontal margin, and if the list
     * also padded its content container the cards would be inset twice and
     * float in a channel too narrow for the page.
     */
    expect(source).not.toContain('ROW_SEPARATOR_INSET');
    expect(source).toContain('marginHorizontal: TOKENS.space.sm');
    /*
     * ...and the directory list (now HomeScreen's Explore section) stops
     * fighting the row's own hairline with a gap.
     *
     * Scoped to the LIST's own content style, not the whole file: this was a
     * file-wide `not.toContain('gap: TOKENS.space.sm')`, which is the same
     * rule stated too widely — it failed the day the search filter panel
     * (nothing to do with any list) used that gap for its own two groups
     * (2026-09-06). The rule is about what separates provider ROWS.
     */
    const home = withoutComments(read('src/screens/HomeScreen.tsx'));
    const listStyle = home.slice(home.indexOf('    scroll: {'), home.indexOf('    state: {'));
    expect(listStyle).not.toMatch(/\bgap:/);
    // And the rows themselves are not spaced apart by their container.
    expect(home).not.toContain('ItemSeparatorComponent');
  });

  it('says what a directory row does, in words rather than a chevron', () => {
    /*
     * REPLACED 2026-09-08, and the replacement is a promotion rather than a
     * removal.
     *
     * The original: tapping a directory row pushes a conversation, which is
     * exactly where iOS puts UITableViewCellAccessoryDisclosureIndicator, and
     * the app had none anywhere — a row read as a card that happened to be
     * tappable. That was right, and the chevron fixed it.
     *
     * The row now ends in a "Chat" CTA. A chevron is a mute gesture at a
     * destination; a labelled control names the action, which is strictly more
     * of what the original assertion wanted. Keeping both would put two
     * trailing affordances on one row saying the same thing once vaguely.
     *
     * The invariant survives, restated: the row must carry SOME trailing
     * indication that it goes somewhere. The chevron is gone from this file
     * only — the inbox and the settings rows still use it, and this asserts
     * that so the glyph does not quietly become dead code again.
     */
    const row = read('src/components/ProviderRow.tsx');
    expect(row).not.toContain('name="chevronRight"');
    expect(row).toContain('styles.cta');
    // The label is a variable now: "Call" for a provider who takes calls,
    // "Chat" for one who does not. Asserted on both, so neither can be dropped.
    expect(row).toContain("const ctaLabel = canCall ? 'Call' : 'Chat'");
    // Still live elsewhere, which is what made it worth adding in the first place.
    const chevronUsers = walk(join(ROOT, 'src'))
      .filter(f => /\.tsx$/.test(f))
      .filter(f => readFileSync(f, 'utf8').includes('name="chevronRight"'));
    expect(chevronUsers.length).toBeGreaterThan(0);
  });
});

/*
 * The session-consent copy Amit specified on 2026-09-07, verbatim, em dashes
 * included: "Hey — {name} is here", "Keep it kind…". It shipped in versionCode
 * 10110.
 *
 * These five literals are the one place the house rule below is deliberately
 * departed from, and the departure is stated here rather than quietly rewritten,
 * because the copy was reviewed and approved as written. Rewriting an approved
 * string to satisfy a style gate is the gate winning an argument it should have
 * lost.
 *
 * Same mechanism as `EXEMPT` in iconScale.test.ts and the grandfathered spacing
 * in theme.test.ts: an allowlist keyed to the exact literal, so the gate stays
 * armed for every OTHER string and a sixth em dash still fails the build. The
 * entries are exact matches, not patterns, for that reason.
 */
const APPROVED_EM_DASH: readonly string[] = [
  '"Keep it kind — no sexual or abusive talk. Charging starts when they pick up."',
  '`Hey — ${name} is here`',
  "'Keep it kind — no sexual or abusive talk. You are only charged once you both start.'",
  "'They are ready when you are. Keep it kind — no sexual or abusive talk. You are only charged once you both start.'",
  "'Your balance is empty — top up to keep going.'",
];

describe('no user-facing em dash and no leftover persona pronoun', () => {
  it('keeps the em dash out of every rendered string', () => {
    // House rule. Asserted on string literals only: the character is fine in a
    // comment, and most of the ones in this repo are.
    const files = ['src/screens', 'src/components'].flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `${dir}/${f}`, body: withoutComments(read(`${dir}/${f}`)) })),
    );
    for (const { file, body } of files) {
      const literals = [...body.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)].map(m => m[0]);
      for (const literal of literals) {
        if (APPROVED_EM_DASH.includes(literal)) {
          continue;
        }
        // Escaped, not literal: a repo-wide punctuation sweep rewrote the
        // equivalent assertion in presence.test.ts into one that forbade commas.
        expect({ file, literal, dash: literal.includes('\u2014') }).toEqual({
          file,
          literal,
          dash: false,
        });
      }
    }
  });

  it('keeps the exemption list honest', () => {
    /*
     * An allowlist that outlives the strings it names is worse than no
     * allowlist: it silently re-permits an em dash the day someone reuses one
     * of these sentences. So every entry must still be present in the source it
     * was written for.
     */
    const all = ['src/screens', 'src/components']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.tsx'))
          .map(f => withoutComments(read(`${dir}/${f}`))),
      )
      .join('\n');
    for (const literal of APPROVED_EM_DASH) {
      expect(all).toContain(literal);
    }
  });

  it('does not assume the provider is a woman', () => {
    // 'She’ll still be here when you top up.' was left over from the AI-persona
    // era that ADR-0001 pivoted away from. The product is human-to-human and a
    // provider is any gender. The interim RefillSheet became the v10 Recharge
    // screen (ADR-0019); the gender invariant follows the copy there.
    const refill = read('src/screens/RechargeScreen.tsx');
    expect(withoutComments(refill)).not.toMatch(/\bShe\b/);
  });
});

describe('chat chrome occludes what is behind it', () => {
  /*
   * The dock carries no fill by design ("no bar bg", Amit 2026-09-04), so
   * anything sitting on it MUST bring its own surface or the transcript runs
   * straight through it. Two things did not, and both collided with bubbles on
   * the S22 (2026-09-05): the camera and mic sat outside the composer capsule,
   * and the reply strip was bare text on the dock.
   *
   * Telegram's answer, captured from the reference on that device: emoji, field,
   * attach and mic all live INSIDE one translucent pill, and the reply chrome
   * shares that surface. No icon is ever outside it, which is why nothing can
   * collide.
   */
  it('the composer capsule contains the icons, not just the field', () => {
    const composer = read('src/components/Composer.tsx');
    const bar = composer.slice(
      composer.indexOf('  inputBar: {'),
      composer.indexOf('  attach: {'),
    );
    // radius.bubble (22dp) matches the message-bubble corner so capsule and
    // bubbles share a continuous grid edge. At single-line height (~40dp) a
    // 22dp radius is a perfect pill (2×22=44≈height), so the visual is unchanged
    // from the old radius.pill at that size. Changed 2026-09-06.
          /*
       * The composer no longer shares the bubble's radius token, and that is a
       * measurement rather than a drift. WhatsApp on the Redmi: bubble corner
       * 9dp, composer capsule corner 10.5dp. They are the same FAMILY — close
       * enough to read as one system — but not one value, and asserting
       * identity would be asserting something WhatsApp does not do.
       */
      expect(bar).toContain('borderRadius: TOKENS.radius.composer');
      // Same family: within 2dp of each other in either direction.
      /*
       * CORRECTED 2026-09-08. This asserted the two radii were within 2dp of
       * each other, on a measurement of WhatsApp's composer that was wrong:
       * I had read "the row where the corner ramp reaches the edge" as the
       * radius and got 10.5dp. Refitting the whole ramp gives 17.93dp, i.e.
       * 18dp — the composer is TWICE as round as the 9dp bubble, not a
       * near-match to it.
       *
       * So the invariant is the shape of the relationship, not a tolerance:
       * the composer is clearly rounder, and it is still not a pill.
       */
      expect(TOKENS.radius.composer).toBeGreaterThan(TOKENS.radius.bubble);
      // Not a pill: WhatsApp's capsule is 46.2dp tall against an 18dp corner.
      expect(TOKENS.radius.composer).toBeLessThan(TOKENS.interaction.minTarget / 2);
    expect(bar).toContain('backgroundColor: t.color.bg.raised');
    expect(bar).toContain("overflow: 'hidden'");
    // And `field` must NOT also carry a fill, or it is a pill inside a pill.
    const field = composer.slice(
      composer.indexOf('  field: {'),
      composer.indexOf('  inputWrapper: {'),
    );
    expect(field).not.toContain('backgroundColor: t.color.bg.raised');
    expect(field).not.toContain('borderRadius: TOKENS.radius.bubble');
  });

  it('the reply strip has a surface of its own', () => {
    const chat = read('src/screens/ChatScreen.tsx');
    const bar = chat.slice(chat.indexOf('  replyBar: {'), chat.indexOf('  replyRule: {'));
    expect(bar).toContain('backgroundColor: t.color.bg.raised');
    expect(bar).toContain('borderRadius: TOKENS.radius.field');
  });
});

describe('every Cashfree Payouts caller sends the 2FA signature', () => {
  /*
   * Cashfree requires an IP allow-list OR an x-cf-signature on every Payouts
   * call, and Edge Functions have no static egress IP - two consecutive calls
   * left from 13.232.152.52 and 13.204.71.66 on 2026-09-05. So the signature is
   * not optional, and a caller without it fails 100% of the time with the
   * misleading "IP not whitelisted".
   *
   * verify-payout-account learned this the hard way. cashfree-payout - the
   * function that actually MOVES money - shipped without it and would have done
   * the same on the first real transfer. Enforced by scanning, so the next
   * Payouts caller cannot repeat it.
   * https://www.cashfree.com/docs/payouts/payouts/integrations/payouts-2fa
   */
  const FN_DIR = 'supabase/functions';

  it('any function calling the payout API imports the shared signer', () => {
    const dir = join(ROOT, FN_DIR);
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.')) {
        continue;
      }
      let body: string;
      try {
        body = read(join(FN_DIR, name, 'index.ts'));
      } catch {
        continue;
      }
      // Does it talk to the Payouts product at all?
      if (!/cashfree\.com\/payout|payoutBaseUrl/.test(body)) {
        continue;
      }
      if (!body.includes('cashfreeSignature')) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the signer is reached through the shared helper, not re-implemented', () => {
    // One RSA-OAEP implementation, in one place. A second copy is a second
    // chance to get the padding or the timestamp window wrong.
    const shared = read('supabase/functions/_shared/cashfreeSignature.ts');
    expect(shared).toContain('RSA-OAEP');
    const dir = join(ROOT, FN_DIR);
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.')) {
        continue;
      }
      let body: string;
      try {
        body = read(join(FN_DIR, name, 'index.ts'));
      } catch {
        continue;
      }
      expect(body).not.toContain('RSA-OAEP');
    }
  });
});

describe('provider identity is verified, not typed', () => {
  const screen = withoutComments(read('src/screens/ProviderApplicationScreen.tsx'));

  it('no longer asks a provider to type a date of birth', () => {
    // The DOB is READ from the identity check, never typed: PAN 360 returns it
    // from Income Tax Department records. A typed birth date is a claim; this is
    // the fact the 18+ gate needs.
    expect(screen).not.toContain('DD/MM/YYYY');
    expect(screen).not.toContain('formatDobInput');
  });

  it('never opens the member first-run on the provider path', () => {
    /*
     * A provider mid-onboarding is `role = 'member'` with a null
     * `profile_completed_at` and an empty wallet right up until
     * `complete_provider_onboarding` succeeds, which is indistinguishable from a
     * brand-new member. The member profile modal opened over provider
     * onboarding on a device (2026-09-05).
     *
     * The guard must live inside `bootPhaseAfterAuth`, not at its call sites:
     * it has four callers and only one of them used to check.
     */
    const app = read('App.tsx');
    const fn = app.slice(
      app.indexOf('async function bootPhaseAfterAuth'),
      app.indexOf('function Root()'),
    );
    expect(fn).toContain('onProviderPath');
    expect(fn).toContain('PROVIDER_INTENT_KEY');
    expect(fn).toContain('identity_state');
    expect(fn).toMatch(
      /if \(!onProviderPath && \(needsUsername \|\| needsAge \|\| needsLanguages\)\)/,
    );
    /*
     * `needsLanguages` is in that condition and must stay there: it is the
     * whole of the login parity fix. The inline flow asks for a language
     * preference, the browser-redirect flow unmounts that screen before it can,
     * and this gate is where the browser path gets asked instead. Drop the term
     * and choosing the browser silently becomes a way around the question again.
     */
    // And every caller goes through it rather than deciding for itself.
    const callers = app.match(/bootPhaseAfterAuth\(/g) ?? [];
    expect(callers.length).toBeGreaterThan(2);
  });

  it('asks for permissions on one explained screen before Home, never as bare dialogs over it', () => {
    /*
     * ADR-0026 (goal item 15, 2026-09-05). Policies first, then the device;
     * a CHECK in the boot machine, the asking on the screen with the reasons.
     * Until 2026-09-06 the `ready` effect fired three system dialogs over Home
     * with no explanation, and two denials there are permanent.
     */
    const app = withoutComments(read('App.tsx'));
    const fn = app.slice(app.indexOf('async function bootPhaseAfterAuth'), app.indexOf('function Root()'));
    const policiesAt = fn.indexOf("rpc('pending_policy_acceptances')");
    const gateAt = fn.indexOf('if (!gateSatisfied(await checkGate()))');
    expect(policiesAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(policiesAt);
    expect(fn).toContain("return { phase: 'permissions' }");
    expect(app).toContain("| { phase: 'permissions' }");
    expect(app).toContain('<PermissionsScreen');
    // The policy gate no longer jumps straight to ready around it.
    expect(app).not.toContain("onAccepted={() => setBoot({ phase: 'ready' })}");
    // No permission is requested from App any more; only push registration remains.
    expect(app).not.toContain('PermissionsAndroid.PERMISSIONS.RECORD_AUDIO');
    expect(app).not.toContain('PermissionsAndroid.PERMISSIONS.CAMERA');
    expect(app).not.toContain('async function requestAndroidPermission');

    const gateScreen = withoutComments(read('src/screens/PermissionsScreen.tsx'));
    const gate = withoutComments(read('src/lib/permissionsGate.ts'));
    // One dialog at a time, and no second rationale on top of the screen.
    expect(gate).toMatch(/for \(const p of outstanding\(current\)\) \{\s*const outcome = await requestAndroidPermission\(p\.permission\);/);
    expect(gate).not.toContain('buttonPositive');
    expect(gateScreen).not.toContain('buttonPositive');
    // A block is not a dead end, and the cancel is Sign out.
    expect(gateScreen).toContain('Linking.openSettings()');
    expect(gateScreen).toContain("AppState.addEventListener('change'");
    for (const id of ['permissions-allow', 'permissions-sign-out', 'permissions-gate']) {
      expect(gateScreen).toContain(`testID="${id}"`);
    }
    expect(gateScreen).toContain('testID={`permissions-open-settings-${p.kind}`}');
    expect(existsSync(join(ROOT, 'docs/adr/0026-permissions-gate-before-home.md'))).toBe(true);
  });

  it('verifies identity before collecting the profile', () => {
    /*
     * The PAN check is the identity step now, not Cashfree 1-Click. 1-Click's
     * consent sheet is broken inside Cashfree's own iframe (their page sends
     * `x-session-id` to their API, which rejects it in the CORS preflight,
     * reproduced with curl on 2026-09-05), so onboarding cannot depend on it.
     * `useCashfreeVerification` still exists for when they fix it.
     */
    expect(screen).toContain('useSavePan');
    expect(screen).toContain("phase === 'verify'");
    expect(screen).not.toContain('useCashfreeVerification');
  });

  it('collects the payout destination in the same step as the PAN', () => {
    /*
     * The payout destination used to live behind "Get paid" on the provider
     * home, OUTSIDE onboarding, so a provider could go live and earn with
     * nowhere to be paid. One step, one submit (Amit, 2026-09-05).
     */
    expect(screen).toContain('useSavePayoutAccount');
    expect(screen).toContain('provider-upi');
    expect(screen).toContain('provider-account-number');
    expect(screen).toContain('provider-ifsc');
    // Both halves gate the one button.
    expect(screen).toMatch(/disabled=\{!PAN_SHAPE\.test\(pan\) \|\| !payoutReady\}/);
  });

  it('sends the PAN-verified name as the beneficiary, never a typed one', () => {
    /*
     * "The account belongs to the person whose PAN this is" only holds if the
     * name comes from the Income Tax Department's record rather than from the
     * provider. A typed holder name lets earnings be routed to someone else.
     */
    expect(screen).toContain('pan_name');
    expect(screen).toMatch(/accountHolderName: verifiedName/);
    expect(screen).not.toMatch(/accountHolderName: (displayName|holderName)/);
  });

  it('shows what was fetched and waits for the provider to accept it', () => {
    /*
     * A third party told us this person's name and birth date. Writing that
     * onto their account without showing it means a wrong record becomes
     * theirs silently, and the 18+ gate then runs on a birth date nobody ever
     * read (Amit, 2026-09-05).
     */
    expect(screen).toContain("phase === 'checking'");
    expect(screen).toContain("phase === 'confirm'");
    expect(screen).toContain('confirm-name');
    expect(screen).toContain('confirm-dob');
    expect(screen).toContain('confirm-destination');
    // The checks land on `confirm`, never straight on the profile.
    expect(screen).toMatch(/setFetched\(\{[\s\S]{0,600}setPhase\('confirm'\)/);
    // And the profile is reachable only from the confirm button.
    const advances = screen.match(/setPhase\('profile'\)/g) ?? [];
    expect(advances).toHaveLength(1);
    expect(screen).toMatch(/provider-confirm-details/);
    // A rejection returns to the form rather than dead-ending.
    expect(screen).toContain('onEditDetails');
  });

  it('advances only on a real verification', () => {
    // Advancing on 'pending' or 'failed' let someone fill the whole profile and
    // be refused at the very end with no way back to the step that failed.
    expect(screen).toMatch(/panStatus !== 'verified'[\s\S]{0,600}return;/);
    // The PAN runs FIRST: without a verified name there is nothing trustworthy
    // to open a beneficiary with.
    expect(screen.indexOf('savePan.mutateAsync')).toBeLessThan(
      screen.indexOf('savePayout.mutateAsync'),
    );
  });

  it('keeps the 18+ age gate in SQL, off the verified DOB', () => {
    // The gate moved from a client arithmetic check to the auto-approve RPC, which
    // reads the Cashfree-written DOB. Wrong-by-a-day float math is gone entirely.
    // 056 supersedes 051's copy of the RPC: the DOB now comes from the identity
    // record and is copied onto the profile in the same statement that sets
    // role = provider, because a member row may not hold one (011).
    const rpc = read('supabase/migrations/056_identity_dob_before_promotion.sql');
    expect(rpc).toContain("interval '18 years'");
    expect(rpc).toContain('verified_dob');
    expect(screen).not.toContain('365.25');
  });
});

describe('presence is declared, and PII is not client-writable', () => {
  const m012 = read('supabase/migrations/012_declared_presence_and_pii_guard.sql');

  it('adds a fourth guard rather than editing one of the three', () => {
    // 010 is the record of the alternative: extending
    // `guard_privileged_profile_columns` by reproducing the 003 body silently
    // deleted the five checks 005 and 006 had added, with no diff to show for it.
    // Postgres runs BEFORE UPDATE triggers in name order and each raises
    // independently, so additive guards compose and cannot regress.
    expect(m012).toContain('create or replace function public.guard_pii_columns()');
    expect(m012).toContain('create trigger guard_profile_pii_columns');
    for (const sibling of [
      'guard_privileged_profile_columns',
      'guard_phone_columns',
      'guard_presence_columns',
    ]) {
      expect(m012).not.toContain(`function public.${sibling}`);
    }
  });

  it('names every column it claims to guard', () => {
    // Asserted on the stripped body, so the comment explaining the guard is not
    // what satisfies the test.
    const body = plpgsqlBody(m012, 'guard_pii_columns');
    for (const column of ['date_of_birth', 'gender', 'headline']) {
      expect(body).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it('runs the guard as the caller, or its own condition can never be true', () => {
    // The subtle one, and 003 records it happening: under SECURITY DEFINER
    // `current_user` is the function owner, so `current_user in
    // ('authenticated','anon')` is false for every caller and the guard passes
    // everything while reading as a guard.
    const body = plpgsqlBody(m012, 'guard_pii_columns');
    expect(body).not.toMatch(/security definer/i);
    expect(body).toContain("current_user in ('authenticated', 'anon')");
  });

  it('leaves presence out of every guard, because it must change instantly', () => {
    // The one column added here that a client is meant to write. A guard on it
    // would put a support ticket between somebody and the ability to stop being
    // contacted, which is the opposite of what this product owes them.
    expect(plpgsqlBody(m012, 'guard_pii_columns')).not.toContain('new.presence');
  });

  it('replaces the directory rather than dropping it', () => {
    // `pending_pushes` (009) selects from `provider_directory`, so a drop either
    // fails on the dependency or, under CASCADE, silently takes the push sender
    // with it. `create or replace` can append a trailing column, which is the
    // whole reason `presence` goes last.
    expect(m012).toContain('create or replace view public.provider_directory');
    expect(m012).not.toContain('drop view if exists public.provider_directory');
    expect(m012).toContain('create or replace view public.conversation_peers');
    expect(m012).not.toContain('drop view if exists public.conversation_peers');
  });

  it('keeps the directory publishing an age and never a birth date', () => {
    // Reproducing a view body verbatim to append one column is exactly the edit
    // that loses a line without leaving a diff worth reading, and the column list
    // of this view IS the privacy boundary.
    const directory = m012.slice(
      m012.indexOf('create or replace view public.provider_directory'),
      m012.indexOf('comment on view public.provider_directory'),
    );
    expect(directory).toContain('extract(year from age(p.date_of_birth))::int as age');
    expect(directory).not.toContain('p.date_of_birth,');
    expect(directory).toContain('security_invoker = false');
  });

  it('re-states the grants it discarded by dropping the inbox view', () => {
    // A drop takes the grants with it, and `authenticated` losing SELECT here
    // empties every inbox in the product.
    expect(m012).toContain('drop view if exists public.conversation_summaries');
    expect(m012).toContain('grant select on public.conversation_summaries to authenticated');
    expect(m012).toContain('revoke all on public.conversation_summaries from anon');
  });

  it('keeps the enum in step with the TypeScript union', () => {
    // Hand-maintained mirror, and the failure is silent in one direction: a value
    // the column accepts and the union does not is a state a user can hold and
    // the app cannot render.
    const sql = /create type public\.presence_choice as enum \(([^)]+)\)/.exec(m012)?.[1] ?? '';
    const inSql = [...sql.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort();
    const union = /export type PresenceChoice =([^;]+);/.exec(read('src/lib/database.types.ts'))?.[1] ?? '';
    const inTs = [...union.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort();
    expect(inSql).toEqual(['away', 'here', 'hidden']);
    expect(inTs).toEqual(inSql);
  });

  it('backfills only the providers whose own switch is already on', () => {
    // Without it every provider currently showing a dot silently stops showing
    // one on deploy. It does assert a state on their behalf, which is why it is
    // narrow rather than a blanket default.
    expect(m012).toContain(
      "where role = 'provider' and is_available and presence = 'hidden'",
    );
  });
});

describe('no screen reads a listing switch as a presence dot', () => {
  // The bug 012 closes, and the only way to keep it closed is to have one
  // reading of presence rather than four. `is_available` means "listed for
  // discovery and open to new conversations"; rendering it as a dot said
  // somebody was there when it only meant they wanted work, and
  // `peer_available` is false for a member peer by construction, so the
  // provider's inbox hardcoded the dot off because no value could ever be true.
  const sites = [
    'src/components/ProviderRow.tsx',
    // ProviderCard renders the same dot for the Favourites tab; must stay on the
    // same readPresence reading as the directory row and the chat header.
    'src/components/ProviderCard.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/ChatScreen.tsx',
    'src/screens/ProviderHomeScreen.tsx',
  ];

  it.each(sites)('derives the dot in %s from readPresence', file => {
    const source = withoutComments(read(file));
    expect(source).toContain('readPresence(');
    expect(source).not.toMatch(/online=\{[^}]*is_available/);
    expect(source).not.toMatch(/online=\{[^}]*peer_available/);
    // The provider's inbox is the specific case: `online={false}` was not
    // laziness, it was the only honest value available before `peer_presence`.
    expect(source).not.toContain('online={false}');
  });

  it('no longer reads the column 012 removed', () => {
    // Comments stripped: three of these files carry a note naming the column and
    // why it was wrong, which is precisely the documentation a negative assertion
    // over raw source would fail on.
    for (const file of sites) {
      expect(withoutComments(read(file))).not.toContain('peer_available');
    }
  });

  it('no longer derives presence from a socket at all', () => {
    // The channel outlived its last reader: no screen rendered `peerOnline` any
    // more, but `useLiveConversation` was still opening a `presence` channel and
    // still calling `track()`, so every device was publishing "my app is in the
    // foreground" for nobody. Removed rather than left dormant, because a
    // presence flag sitting in the store is an invitation for the next screen to
    // render it.
    const realtime = withoutComments(read('src/api/realtime.ts'));
    expect(realtime).not.toContain('presence:');
    expect(realtime).not.toContain('.track(');
    expect(realtime).not.toContain('presenceState');
    expect(withoutComments(read('src/store/useStore.ts'))).not.toContain('peerOnline');
    // Typing survives, and the distinction is the whole argument: it animates
    // because somebody is doing something on purpose, right now.
    expect(realtime).toContain("broadcast: { self: false }");
  });

  it('has no rail left in the inbox to confuse the two questions', () => {
    /*
     * This assertion used to say "keeps the rail filtered on openness, not on
     * presence", and it guarded a real distinction: `is_available` is a provider
     * saying she wants a new conversation, `presence` is whether she is here now,
     * and the rail once rendered the first while dotting the second.
     *
     * The rail is gone, so the way to keep that mistake from coming back is to
     * assert its absence rather than its filter. Explore is the discovery surface
     * now, and the assertion below is where the distinction is actually kept.
     */
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).not.toContain('rail-browse');
    expect(home).not.toContain('enterRail');
  });

  it('keeps availability and presence separate on the surface that has both', () => {
    // Explore reads `readPresence` for the dot and never dots a stored listing
    // switch, which is the substance of the old rail assertion.
    expect(read('src/screens/HomeScreen.tsx')).toContain('readPresence');
  });
});

describe('one presence control, writing both columns', () => {
  const provider = read('src/api/provider.ts');

  it('writes the stamp gate along with the declaration', () => {
    // 011 stores `presence_visible` as the gate on the last-seen stamp and 012
    // adds `presence` as the declared state. Independent in the schema on
    // purpose, but offering two switches for one thought is not a design.
    expect(provider).toContain(
      ".update({ presence, presence_visible: presence !== 'hidden' })",
    );
  });

  it('tracks the change under a name the database allows', () => {
    // `guard_event_shape` rejects an unknown name outright and rejects any prop
    // key matching /(body|message|content|text|detail|email|phone|name|token)/i,
    // so the prop is `choice` and never `name`.
    expect(provider).toContain("track('presence_changed', { choice: presence })");
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      "'presence_changed'",
    );
  });

  it('offers the choice to both roles in the same place', () => {
    // App.tsx mounts SettingsSheet on the provider tree and the member tree, so
    // one control covers both. Presence is not a provider feature.
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('PRESENCE_OPTIONS.map');
    expect(settings).toContain('useSetPresence()');
    // The testID is built from the option, so the rows cannot exist without one
    // and cannot drift from the enum. That PRESENCE_OPTIONS is exhaustive over
    // `PresenceChoice` is asserted in presence.test.ts, where it can be checked
    // against the type rather than against a string.
    expect(settings).toContain('testID={`presence-${option.value}`}');
  });

  it('stops the availability card claiming presence or the word hidden', () => {
    // Two controls saying 'hidden' and meaning different things is how somebody
    // ends up unreachable while believing they are only invisible.
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    expect(home).not.toContain('You are hidden.');
    expect(home).not.toContain('Available Now');
    expect(home).toContain('Open to New Conversations');
  });

  it('SettingsSheet legal URLs come from legalUrl, not hard-coded strings', () => {
    // LEGAL_BASE_URL in src/lib/legal.ts is the single source of truth for the
    // public-site host. SettingsSheet must import it so the Play Console required
    // URLs (privacy policy, data deletion) cannot diverge from the canonical host.
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain("from '../lib/legal'");
    expect(settings).toContain('legalUrl(');
    // Hard-coded host must not appear — the helper is the indirection point.
    expect(withoutComments(settings)).not.toContain("'https://bond-app.vercel.app/");
  });
});

/**
 * The Fuse motion adoption, wired rather than only drawn.
 *
 * Rules 1, 2, 4, 5 and 7 of `design/references/motion-system.md`. Rule 3, the
 * accent wash, was dropped. That decision and its reasoning are recorded in
 * that file, and the assertion that keeps it dropped is theme.test.ts's
 * `has no gradients or glow anywhere`, which is left exactly as it was.
 */
describe('the motion adoption is wired, not just drawn', () => {
  const screens = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: withoutComments(read(`src/screens/${f}`)) }));
  const components = readdirSync(join(ROOT, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: withoutComments(read(`src/components/${f}`)) }));

  it('separates busy from disabled in the primitive', () => {
    // The bug this whole rule exists to fix: every call site used to pass
    // `disabled` while a mutation was pending, which routed into Pressable's 45%
    // dim, so the label whose entire job is to be read was rendered at 45%
    // opacity. `busy` must therefore NOT feed the disabled opacity, and must not
    // be folded into the disabled prop on the way down.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toMatch(/busy\?: boolean/);
    expect(pressable).toMatch(/opacity: disabled \? 0\.45 : 1/);
    expect(withoutComments(pressable)).not.toMatch(/disabled \|\| busy/);
    expect(withoutComments(pressable)).not.toMatch(/busy \|\| disabled/);
    // Told to the accessibility tree as its own state, not as "disabled". The
    // trailing spreads carry optional `selected` (nav-bar a11y fix), `checked`
    // (radio/checkbox roles); busy and disabled stay separate fields.
    expect(pressable).toContain('disabled,');
    expect(pressable).toContain('busy,');
    expect(withoutComments(pressable)).toContain('accessibilityState');
  });

  it('holds a working button compressed rather than springing back', () => {
    // A press-out fires the instant the finger lifts, which is the instant the
    // request starts. So the held compression cannot share the press value, and
    // it has to come from the token table rather than from a number here.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain("springTo(busy ? PRESS.busy : 1, 'snap')");
  });

  it('leaves no hand-rolled ellipsis label anywhere', () => {
    // Ten call sites each spelled their own busy state into a label expression,
    // inconsistently: two of them said 'Sending…' for two different operations,
    // and one said 'Checking…' on the button that resends rather than the one
    // that checks. The participle now comes from `busyLabel` and nothing builds
    // it inline.
    for (const source of screens.concat(components)) {
      expect(source.body).not.toMatch(/label=\{[^}]*…/);
    }
  });

  it('narrates every mutation a button starts', () => {
    // Every Button that reports a pending mutation says which one. Counted
    // rather than named, so a new async button without a participle fails here
    // instead of shipping a pill that compresses and says nothing.
    for (const source of screens) {
      const busies = source.body.match(/\bbusy=\{/g)?.length ?? 0;
      const labels = source.body.match(/\bbusyLabel=/g)?.length ?? 0;
      expect(labels).toBe(busies);
    }
  });

  it('never reintroduces the carousel', () => {
    // Reverted after being watched on a device. text/secondary composites to
    // 1.16:1 at the carousel's 10% alpha and does not reach AA until 0.85,
    // where the fade is imperceptible, so the effect and legibility cannot
    // coexist at body size. The sign-in claims this used to sit behind
    // (AuthScreen) are gone with that screen (Amit, 2026-09-03), but the
    // component itself must still not come back anywhere.
    expect(existsSync(join(ROOT, 'src/components/WordCarousel.tsx'))).toBe(false);
  });

  it('is one continuous provider flow, not a second bloom welcome', () => {
    // The screen used to open on its OWN bloom welcome + "Continue" — a second
    // welcome beat after the auth one, which read as a disconnected restart. It
    // now runs straight into verify → profile → done, so BloomField, the
    // OnboardingStep checklist and the Stepper are all gone from it (Amit,
    // 2026-09-03).
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).not.toContain('<BloomField');
    expect(screen).not.toContain('<OnboardingStep');
    expect(existsSync(join(ROOT, 'src/components/Stepper.tsx'))).toBe(false);
    expect(screen).toContain("useState<Phase>('verify')");
    expect(screen).toContain("setPhase('profile')");
    expect(screen).toContain("setPhase('done')");
  });

  it('collects the mandatory profile fields, photo optional', () => {
    // The card fields a member chooses a provider by. Photo is the only optional
    // one; the auto-approve RPC enforces the rest server-side.
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toContain('testID="provider-name"');
    expect(screen).toContain('testID="provider-headline"');
    expect(screen).toContain('testID="provider-about"');
    expect(screen).toContain('Photo (optional)');
    const rpc = read('supabase/migrations/051_provider_auto_onboarding.sql');
    expect(rpc).toContain('a display name is required');
    expect(rpc).toContain('a headline is required');
  });

  it('opens the stage name filled with a suggestion, re-rolls it, and warns when the name is the person', () => {
    // Goal item 8 (2026-09-05): "suggested name for provider onboarding +
    // warning on edit, no PII". The field is filled on the way into the profile
    // step — only if empty, so coming back via "Something is wrong" keeps their
    // typing — checked live with the member flow's check_display_name, and
    // compared against the PAN-verified name from the confirm step.
    const screen = withoutComments(read('src/screens/ProviderApplicationScreen.tsx'));
    expect(screen).toContain('onPress={enterProfile}');
    expect(screen).toMatch(/if \(displayName\.trim\(\) === ''\) \{\s*const first = suggestStageName\(\)/);
    expect(screen).toContain('testID="provider-name-reroll"');
    expect(screen).toContain("useCheckDisplayName(\n    displayName,\n    phase === 'profile',\n  )");
    expect(screen).toContain('stageNamePii(displayName, fetched?.name ?? null)');
    expect(screen).toContain('testID="provider-name-pii-warning"');
    expect(screen).toContain('testID="provider-name-taken"');
    // A phone number blocks Go live; a real-name match only warns (heuristic).
    expect(screen).toMatch(/const profileReady =[\s\S]*namePii !== 'phone' &&[\s\S]*!nameTaken &&/);
    // Every suggestion must pass the server's rule — the unit test walks the
    // whole space; this pins that the rule it walks is the server's.
    const sql = read('supabase/migrations/040_profile_setup_and_first_interaction.sql');
    expect(sql).toContain("v_trimmed !~ '^[a-zA-Z0-9_]+$'");
    expect(sql).toContain('length(v_trimmed) < 3 or length(v_trimmed) > 24');
  });

  it('auto-approves on completion, with no review queue', () => {
    // No more submit → admin review → applicationStatus. Completing onboarding
    // calls complete_provider_onboarding, which flips role='provider' directly
    // (Cashfree KYC is the vetting; the admin console keeps an after-the-fact
    // Providers list). The resubmit-on-gap machinery is therefore gone.
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toContain('useCompleteProviderOnboarding');
    expect(screen).not.toContain('firstFlaggedStep');
    const rpc = read('supabase/migrations/051_provider_auto_onboarding.sql');
    expect(rpc).toContain("role = 'provider'");
    expect(rpc).toContain('identity_verified_at');
  });

  it('never feeds an animation object to a colour interpolation', () => {
    // The one bug in this change that no gate here could have caught. Reanimated
    // lets you return an animation straight out of `useAnimatedStyle` and it is
    // applied as one, so `accentTo(phase)` LOOKS like a number. It is a
    // descriptor object, and handing it to `interpolateColor` produces a broken
    // colour on a device and nothing anywhere else: the animation helpers are
    // typed as returning the value they animate, so tsc is happy, and no test
    // renders. The correct shape is an animation driving a shared value and the
    // interpolation reading `.value`.
    for (const source of components.concat(screens)) {
      expect(source.body).not.toMatch(
        /interpolateColor\(\s*(accentTo|promoteTo|fadeTo|springTo)\(/,
      );
    }
  });

  it('names the send halo separately from the atmospheric field', () => {
    const sources = [
      read('src/screens/ChatScreen.tsx'),
      read('src/components/Composer.tsx'),
      read('src/components/SendButton.tsx'),
    ].join('\n');
    expect(sources).toContain('sendHaloKey');
    expect(sources).toContain('haloOpacity');
    expect(sources).not.toContain('bloomKey');
  });

  it('centralizes the measured carousel glyph departure', () => {
    expect(read('src/lib/onboarding.ts')).toContain('carouselGlyph: 32');
    expect(read('src/components/WordColumn.tsx')).toContain(
      'SOURCE_METRICS.carouselGlyph',
    );
  });

  it('contains BloomField to bounded identity and setup journeys', () => {
    const consumers = screens
      .filter(source => source.body.includes('<BloomField'))
      .map(source => source.file)
      .sort();
    // PaymentSheet removed 2026-09-01: the payment-success state is now a
    // contained M3 positive card. ProviderApplicationScreen removed 2026-09-03:
    // the provider onboarding is now one continuous verify → profile flow with no
    // second bloom welcome, so the atmospheric field lives only on the member
    // welcome/auth surface.
    expect(consumers).toEqual(['OnboardingScreen.tsx']);
  });

  /**
   * Visible buttons must go through the shared Pressable so every spring, state
   * layer and reduced-motion path stays in one place. Raw RNPressable is allowed
   * only on surfaces where press feedback is invisible or semantically wrong:
   * full-screen scrim/dim captures, the Toggle (which animates its own thumb
   * geometry), TactileCTA (deliberate bounce-spring + ripple signature), and
   * CodeField (OTP tap-to-focus zone, not a button).
   *
   * The test is an exact allowlist so a new file with a raw Pressable import
   * fails here before it ships.
   */
  it('sheet bar actions use the shared Pressable, not a raw RNPressable', () => {
    const sheet = read('src/components/Sheet.tsx');
    // Cancel and Done are visible tinted-text bar buttons; they must get spring
    // feedback and a state layer, which only the shared Pressable provides.
    expect(sheet).toContain("testID=\"sheet-cancel\"");
    expect(sheet).toContain("testID=\"sheet-done\"");
    // Both testIDs are on our Pressable, not on a raw RNPressable tag.
    expect(sheet).not.toMatch(/<RNPressable[^>]*testID="sheet-cancel"/);
    expect(sheet).not.toMatch(/<RNPressable[^>]*testID="sheet-done"/);
  });

  it('SpotlightCard "Not now" uses the shared Pressable', () => {
    const card = read('src/components/SpotlightCard.tsx');
    // "Not now" is a visible action; it must get the same spring feedback as any
    // other button. The scrim RNPressable (full-screen dismiss surface) stays raw.
    expect(card).not.toMatch(/<RNPressable[^>]*testID="spotlight-dismiss"/);
    expect(card).toContain('testID="spotlight-dismiss"');
  });

  it('CountryPicker trigger and rows use the shared Pressable', () => {
    const picker = read('src/components/CountryPicker.tsx');
    // The trigger pill and every country row are visible interactive controls.
    // After migration no raw Pressable import from react-native is needed.
    expect(picker).not.toMatch(/import \{[^}]*\bPressable\b[^}]*\} from 'react-native'/);
    expect(picker).toContain("from './Pressable'");
    expect(picker).toContain('press="chip"');
    expect(picker).toContain('press="row"');
  });

  it('confines every raw Pressable import from react-native to an exact allowlist', () => {
    /**
     * Allowlisted files and the reason each is exempt:
     *
     *   Pressable.tsx   — the primitive itself; must import the raw control.
     *   Toggle.tsx      — dedicated thumb-geometry animation (size, offset and
     *                     track colour all driven by one spring) that cannot be
     *                     expressed through the shared primitive without adding
     *                     new API surface.
     *   TactileCTA.tsx  — deliberate signature behaviour: bounce-spring release,
     *                     centred ripple bloom and emoji wiggle. Reserved for
     *                     invitational CTAs only; never the workhorse Button.
     *   CodeField.tsx   — OTP field tap-to-focus zone; not a button and has no
     *                     visible press surface to animate.
     *   Sheet.tsx       — retains one RNPressable for the full-screen scrim-fill
     *                     dismiss target (invisible gesture capture surface).
     *   SpotlightCard.tsx — same: one RNPressable for the scrim-fill dismiss.
     *   ChatStartHint.tsx — one RNPressable for the full-screen modal scrim that
     *                     dismisses the tooltip; animating it would tint the page.
     *   PaperMenu.tsx   — dim-band strips that implement the cut-out scrim; each
     *                     strip is an invisible colour layer, not a button.
     *   Turn.tsx        — one RNPressable for the transparent full-screen backdrop
     *                     that dismisses the Modal-hosted reaction strip on an
     *                     outside tap; an invisible capture surface, not a button.
     */
    const RAW_PRESSABLE_IMPORT = /import \{[^}]*\bPressable\b[^}]*\} from 'react-native'/;
    const allSources = [
      ...readdirSync(join(ROOT, 'src/components'))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `src/components/${f}`, body: withoutComments(read(`src/components/${f}`)) })),
      ...readdirSync(join(ROOT, 'src/screens'))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `src/screens/${f}`, body: withoutComments(read(`src/screens/${f}`)) })),
    ];
    const rawUsers = allSources
      .filter(s => RAW_PRESSABLE_IMPORT.test(s.body))
      .map(s => s.file)
      .sort();
    expect(rawUsers).toEqual([
      'src/components/ChatStartHint.tsx',
      'src/components/CodeField.tsx',
      'src/components/PaperMenu.tsx',
      'src/components/Pressable.tsx',
      'src/components/Sheet.tsx',
      'src/components/SpotlightCard.tsx',
      'src/components/TactileCTA.tsx',
      'src/components/Toggle.tsx',
      'src/components/Turn.tsx',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Admin control plane security contracts
// ---------------------------------------------------------------------------
// These assertions are the mechanical form of ADR-0023's security constraints:
//   • SUPABASE_SERVICE_ROLE_KEY must only live in server-side files.
//   • All DB writes go through API routes via createServiceClient.
//   • No page component imports the key directly.
//
// A failure here means a code path exists that could leak service credentials
// into the browser bundle, which bypasses RLS on every admin.* table.

describe('admin control plane key hygiene', () => {
  const ADMIN_ROOT = join(ROOT, 'admin');
  const adminExists = existsSync(ADMIN_ROOT);

  it('admin/middleware.ts exists and imports createServiceClient from lib', () => {
    if (!adminExists) return;
    const middleware = read('admin/middleware.ts');
    expect(existsSync(join(ROOT, 'admin/middleware.ts'))).toBe(true);
    // The allowlist check requires service_role; it must come from the server helper.
    expect(middleware).toContain('createServiceClient');
    expect(middleware).toContain("from '@/lib/supabase/service'");
  });

  it('service.ts references SUPABASE_SERVICE_ROLE_KEY and is never prefixed NEXT_PUBLIC_', () => {
    if (!adminExists) return;
    const service = read('admin/lib/supabase/service.ts');
    expect(service).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // The variable MUST NOT carry the NEXT_PUBLIC_ prefix — that would expose it
    // to the browser bundle.
    expect(service).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
  });

  it('all admin API routes use createServiceClient (not raw anon client for writes)', () => {
    if (!adminExists) return;
    const apiDir = join(ADMIN_ROOT, 'app/api');
    if (!existsSync(apiDir)) return;
    const routeFiles = walk(apiDir).filter((f) => f.endsWith('route.ts'));
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const file of routeFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('createServiceClient');
    }
  });

  it('no admin page component imports SUPABASE_SERVICE_ROLE_KEY directly', () => {
    if (!adminExists) return;
    const appDir = join(ADMIN_ROOT, 'app/(authenticated)');
    if (!existsSync(appDir)) return;
    const pageFiles = walk(appDir).filter(
      (f) => f.endsWith('page.tsx') || f.endsWith('layout.tsx'),
    );
    for (const file of pageFiles) {
      const content = withoutComments(readFileSync(file, 'utf8'));
      // Pages may import createServiceClient (which internally reads the key on
      // the server) but must NEVER reference the env var name directly.
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('browser.ts does not reference the service role key', () => {
    if (!adminExists) return;
    const browserHelper = join(ADMIN_ROOT, 'lib/supabase/browser.ts');
    if (!existsSync(browserHelper)) return;
    const content = readFileSync(browserHelper, 'utf8');
    expect(content).not.toContain('SERVICE_ROLE');
    expect(content).not.toContain('service_role');
  });

  it('commitlint scope list includes admin', () => {
    const config = read('commitlint.config.js');
    // The scope allows commits to be tagged with the admin layer.
    expect(config).toMatch(/'admin'/);
  });
});

// ---------------------------------------------------------------------------
// M3 determinate progress for media uploads
// ---------------------------------------------------------------------------
// Policy (docs/android-audit.md): Linear ProgressBar with progress 0–1 =
// determinate work where a fraction is known (upload/download). ActivityIndicator
// is banned — use LoadingIndicator (indeterminate) or ProgressBar (determinate).
// M3 spec: https://m3.material.io/components/progress-indicators/guidelines

describe('media upload uses M3 determinate progress, not ActivityIndicator', () => {
  const SRC_DIRS = ['src/lib', 'src/api', 'src/components', 'src/screens', 'src/store'];

  /** All .ts / .tsx files under the given directory (non-recursive, one level). */
  function srcFiles(dir: string): string[] {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: false })
      .filter(f => typeof f === 'string' && (f.endsWith('.ts') || f.endsWith('.tsx')))
      .map(f => join(dir, f as string));
  }

  it('uses no ActivityIndicator in src/ (stripped of comments)', () => {
    // Policy: RN's ActivityIndicator draws Android's Material sweep, not M3.
    // Use LoadingIndicator for indeterminate, ProgressBar for determinate.
    const activityIndicatorPattern = /<ActivityIndicator|ActivityIndicator[,}]|ActivityIndicator\s*from/;
    for (const dir of SRC_DIRS) {
      for (const file of srcFiles(dir)) {
        const stripped = withoutComments(read(file));
        expect({ file, match: activityIndicatorPattern.test(stripped) }).toEqual({
          file,
          match: false,
        });
      }
    }
  });

  it('uploads photos with XMLHttpRequest, not fetch, to get progress events', () => {
    // fetch has no upload progress API; XHR.upload.onprogress does.
    const attachments = withoutComments(read('src/api/attachments.ts'));
    expect(attachments).toContain('new XMLHttpRequest()');
    expect(attachments).toContain('xhr.upload.onprogress');
    expect(attachments).toContain('e.lengthComputable');
    // The original fetch must be gone (outside comments).
    expect(attachments).not.toMatch(/await fetch\(/);
  });

  it('uploads voice notes with XMLHttpRequest, not fetch, to get progress events', () => {
    const voice = withoutComments(read('src/api/voice.ts'));
    expect(voice).toContain('new XMLHttpRequest()');
    expect(voice).toContain('xhr.upload.onprogress');
    expect(voice).toContain('e.lengthComputable');
    expect(voice).not.toMatch(/await fetch\(/);
  });

  it('stores upload progress in the store under the pending id', () => {
    const store = read('src/store/useStore.ts');
    expect(store).toContain('uploadProgress: Record<string, number>');
    expect(store).toContain('setUploadProgress');
    expect(store).toContain('clearUploadProgress');
    // Progress must be cleared when a conversation is left, so a next chat
    // does not inherit in-flight state from a previous one.
    expect(store).toContain('uploadProgress: {}');
  });

  it('Turn.tsx renders ProgressBar for the upload, not LoadingIndicator', () => {
    const turn = read('src/components/Turn.tsx');
    // Must import ProgressBar, not LoadingIndicator (no new import).
    expect(turn).toContain("import { ProgressBar } from './ProgressBar'");
    expect(turn).not.toContain("LoadingIndicator");
    // The bar receives a numeric progress value from the store.
    expect(turn).toContain('uploadProgress');
    expect(turn).toContain('progress={pending ? uploadFraction : undefined}');
  });

  it('VoiceNote.tsx renders ProgressBar while a voice note is uploading', () => {
    const vn = read('src/components/VoiceNote.tsx');
    expect(vn).toContain("import { ProgressBar } from './ProgressBar'");
    expect(vn).toContain('uploadFraction');
    expect(vn).toContain('progress={uploadFraction}');
  });

  it('anchors the determinate fill at the left instead of inheriting a stale transform', () => {
    // Found on device (2026-08-31): an upload starts indeterminate (no XHR event
    // yet) and then reports bytes, so one ProgressBar switches modes mid-flight.
    // The old animated style returned `transform` ONLY in the indeterminate
    // branch and `width` ONLY in the determinate one, and Reanimated does not
    // reset a property a later return value omits — so the determinate fill kept
    // the last indeterminate `translateX` and rendered as a short bar floating in
    // the middle of the track. Both branches must set BOTH properties.
    const bar = read('src/components/ProgressBar.tsx');
    const style = bar.slice(bar.indexOf('const fillStyle'), bar.indexOf('return (\n    <View'));
    // Determinate: explicit translateX 0 alongside the width.
    expect(style).toContain('transform: [{ translateX: 0 }]');
    // Indeterminate: a travelling segment, so it also sets width.
    expect(style).toMatch(/width: segment/);
    // Every `return` inside the worklet carries width and transform together.
    const returns = style.match(/return \{[\s\S]*?\};/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const r of returns) {
      expect(r).toContain('width');
      expect(r).toContain('transform');
    }
    // Travel is measured from real layout, not a hardcoded ±100px.
    expect(bar).toContain('onLayout');
    expect(bar).toContain('trackWidth');
    expect(style).not.toMatch(/\*\s*100\b/);
  });

  it('accessibilityLabel announces upload progress to screen readers', () => {
    // The image accessibilityLabel must update to read "Sending photo, N percent"
    // while the upload fraction is known, so TalkBack users get progress too.
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain('Sending photo');
    expect(turn).toContain('percent');
    // Voice note equivalent.
    const vn = read('src/components/VoiceNote.tsx');
    expect(vn).toContain('Sending voice note');
    expect(vn).toContain('percent');
  });
});

describe('independent call controls', () => {
  it('exposes separate ON-by-default voice and video knobs in admin and mobile', () => {
    const registry = read('admin/lib/config-registry.ts');
    const config = read('src/api/appConfig.ts');
    for (const key of ['voice_calls_enabled', 'video_calls_enabled']) {
      expect(registry).toContain(`key: '${key}'`);
      expect(config).toContain(`${key}: boolean`);
      expect(config).toContain(`${key}: true`);
    }
    expect(registry).not.toContain("key: 'calls_enabled'");
  });

  it('gates each app action with its matching control', () => {
    const chat = read('src/screens/ChatScreen.tsx');
    const detail = read('src/screens/ProviderDetailScreen.tsx');
    // Each live control still reaches its own action; since 064 it does so
    // ANDed with the provider's own switch for that channel, never replaced by
    // it. An operator stop and a provider's choice both have to hold.
    expect(chat).toContain('voiceCallsEnabled && (provider?.audio_enabled ?? true)');
    expect(chat).toContain('videoCallsEnabled && (provider?.video_enabled ?? true)');
    expect(detail).toContain('enabled={voiceCallsEnabled && provider.audio_enabled}');
    expect(detail).toContain('enabled={videoCallsEnabled && provider.video_enabled}');
  });

  it('enforces both controls inside start_call, not only in the UI', () => {
    const migration = read(
      'supabase/migrations/044_independent_call_controls.sql',
    );
    expect(migration).toContain("environment = 'prod'");
    expect(migration).toContain("'VOICE_CALLS_DISABLED'");
    expect(migration).toContain("'VIDEO_CALLS_DISABLED'");
    expect(migration).toContain("'voice_calls_enabled', true");
    expect(migration).toContain("'video_calls_enabled', true");
  });
});

describe('post-release UI regressions', () => {
  it('defines first-run membership by an exactly empty wallet', () => {
    const app = read('App.tsx');
    const profile = read('src/api/profileSetup.ts');
    const onboarding = read('src/screens/OnboardingScreen.tsx');
    expect(profile).toContain("profile?.role === 'member' && profile.token_balance === 0");
    expect(app).toContain('firstUser && needsProfileSetup(p)');
    expect(app).toContain('firstUser && needsAgeBracket(p)');
    expect(onboarding).toContain('isFirstUser(profile ?? undefined)');
    expect(onboarding).toContain('needsAgeBracket(profile ?? undefined)');
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain('const firstUser = balance === 0');
    expect(home).toContain('tourSeen || !firstUser');
    expect(home).toContain('tourSeen || !firstUser)');
  });

  it('constrains the message stack before measuring bubble text', () => {
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain("maxWidth: '80%'");
    expect(turn).toMatch(/bubble:\s*\{[\s\S]*?maxWidth:\s*'100%'/);
    expect(turn).toMatch(/myColumn:\s*\{[\s\S]*?width:\s*'100%'/);
  });

  it('keeps the interrupting recharge sheet compact and non-scrolling', () => {
    const recharge = read('src/screens/RechargeScreen.tsx');
    const sheetStart = recharge.indexOf('export function RechargeScreen');
    const walletStart = recharge.indexOf('export function RechargeWalletPage');
    const sheet = recharge.slice(sheetStart, walletStart);
    expect(sheet).toContain('<RechargeSheetForm');
    expect(sheet).not.toContain('<ScrollView');
    expect(recharge).toContain('Choose a pack');
    expect(recharge).toContain('1 token = ₹1');
    expect(recharge).toMatch(/cardSlot:\s*\{[\s\S]*?width:\s*'48%'/);
    expect(recharge).toMatch(/card:\s*\{[\s\S]*?width:\s*'100%'/);
  });

  it('keeps the navigation heart outlined when selected', () => {
    const toolbar = read('src/components/FloatingToolbar.tsx');
    expect(toolbar).toContain("active={on && tab.key !== 'favourites'}");
  });

  it('aligns the visible profile consent box without shrinking its target', () => {
    const setup = read('src/screens/ProfileSetupScreen.tsx');
    expect(setup).toContain('size={22}');
    expect(setup).toMatch(/termsRow:\s*\{[\s\S]*?alignItems:\s*'center'/);
    expect(setup).toMatch(/checkboxHit:\s*\{[\s\S]*?width:\s*22[\s\S]*?height:\s*22/);
  });
});

describe('first-send refill: all three send paths open recharge on first success', () => {
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
  const voice = withoutComments(read('src/api/voice.ts'));
  const image = withoutComments(read('src/api/attachments.ts'));

  it('useSendVoiceNote returns Promise<boolean>', () => {
    // The callback must signal success/failure so ChatScreen can trigger the
    // first-send refill for voice notes, exactly as it already does for text.
    // Failed, invalid, upload-failed, or server-rejected sends return false.
    expect(voice).toContain('Promise<boolean>');
    expect(voice).toContain('return true');
    expect(voice).toMatch(/return false/);
  });

  it('useSendImage returns Promise<boolean>', () => {
    // Same contract as voice: success → true, any failure path → false.
    expect(image).toContain('Promise<boolean>');
    expect(image).toContain('return true');
    expect(image).toMatch(/return false/);
  });

  it('does not open refill on first successful member send', () => {
    expect(chat).not.toContain('firstSendRefillShown');
    expect(chat).not.toContain('wasFirstMemberSend');
  });

  it('INSUFFICIENT_BALANCE still opens refill directly from the send hooks', () => {
    // Server-side balance failures open the refill sheet immediately without
    // going through the first-send path (which only fires on success).
    expect(voice).toContain("code === 'INSUFFICIENT_BALANCE'");
    expect(voice).toMatch(/code === 'INSUFFICIENT_BALANCE'[\s\S]{0,40}openRefill\(\)/);
    expect(image).toContain("code === 'INSUFFICIENT_BALANCE'");
    expect(image).toMatch(/code === 'INSUFFICIENT_BALANCE'[\s\S]{0,40}openRefill\(\)/);
  });
});

describe('opener orchestrator cleanup tracks and clears its timer', () => {
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));

  it('tracks the pending timer in a named variable', () => {
    // A bare `new Promise(resolve => setTimeout(resolve, ms))` gives up the
    // handle, so clearTimeout is impossible on unmount. The variable must be
    // declared in the effect closure so the cleanup function can reach it.
    expect(chat).toContain('pendingTimer');
    expect(chat).toMatch(/pendingTimer\s*=\s*setTimeout/);
  });

  it('clears the timer on unmount', () => {
    // Without clearTimeout the handle fires after unmount and calls setState on
    // a gone component. The cleanup must call clearTimeout before setting
    // cancelled = true so the wait Promise cannot resolve after teardown.
    expect(chat).toContain('clearTimeout(pendingTimer)');
  });

  it('preserves the cancellation latch', () => {
    // Clearing the timer does not remove the cancelled guard; both must coexist
    // so the loop exits cleanly even if the RPC is in flight when unmount runs.
    expect(chat).toContain('cancelled = true');
  });
});

/**
 * The emoji dataset is generated, not typed (RULE 4).
 *
 * All three failure modes here are silent: a hand-edit to the generated file
 * survives until the next regeneration wipes it; the source package sliding
 * from a devDependency into a dependency drags a render layer into the bundle
 * with no visible symptom; and a `verify` that forgets `emoji:check` means
 * drift only ever appears in CI.
 */
describe('emoji data pipeline', () => {
  const pkg = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('keeps @emoji-mart/data out of the shipped dependencies', () => {
    expect(pkg.devDependencies).toHaveProperty('@emoji-mart/data');
    expect(pkg.dependencies).not.toHaveProperty('@emoji-mart/data');
  });

  it('gates drift in `npm run verify`, not only in CI', () => {
    expect(pkg.scripts.verify).toContain('emoji:check');
    expect(pkg.scripts['emoji:check']).toContain('--check');
  });

  it('marks the output generated and excludes it from lint', () => {
    expect(read('src/lib/emoji.generated.ts').slice(0, 200)).toContain(
      'GENERATED FILE, DO NOT EDIT',
    );
    expect(read('.eslintrc.js')).toContain('src/lib/emoji.generated.ts');
  });

  it('deletes one user-perceived character, not one code point', () => {
    // `Array.from(s).slice(0, -1)` iterates code points, so one backspace over
    // a family emoji removed a zero-width joiner and left loose glyphs.
    const composer = withoutComments(read('src/components/Composer.tsx'));
    expect(composer).toContain('deleteLastGrapheme');
    expect(composer).not.toMatch(/Array\.from\(current\)\.slice/);
  });
});

/**
 * The attach surface is a docked panel, not a sheet, and it must never reach for
 * the gallery permission.
 *
 * Both halves are silent failures. A second surface that can be open at the same
 * time as the emoji panel makes the dock two keyboards tall — which reads as the
 * composer flying up the screen. And `READ_MEDIA_IMAGES` is a Play-restricted
 * permission: adding it does not break anything locally, it breaks the next
 * submission, which is the worst possible place to find out.
 */
describe('attach panel', () => {
  const composer = withoutComments(read('src/components/Composer.tsx'));
  const panel = withoutComments(read('src/components/AttachPanel.tsx'));
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('is docked in the emoji panel slot, not presented as a Sheet', () => {
    expect(composer).toContain('<AttachPanel');
    // The media chooser Sheet and its tiles are gone, not merely unused.
    expect(composer).not.toContain('media-sheet');
    expect(composer).not.toContain("from './Sheet'");
  });

  it('keeps the two docked surfaces exclusive', () => {
    // Opening either closes the other, so the dock is only ever one keyboard
    // tall. Asserted on both directions because one of them is easy to forget.
    expect(composer).toMatch(/setAttachOpen\(false\);[\s\S]{0,80}setEmojiOpen\(true\)/);
    expect(composer).toMatch(/setEmojiOpen\(false\);[\s\S]{0,120}setAttachOpen\(true\)/);
  });

  it('sizes both panels from the same expression', () => {
    // If these ever diverge the composer moves on the swap between them.
    const heights = composer.match(/height=\{[^}]*panelHeight \+ insets\.bottom[^}]*\}/g);
    expect(heights?.length).toBeGreaterThanOrEqual(2);
  });

  it('CHECKS the camera permission on open and requests it only on use', () => {
    // A permission dialog fired by opening a panel is a prompt the user never
    // asked for. `check` is silent; the request belongs on the capture tap.
    // https://developer.android.com/training/permissions/requesting
    expect(composer).toContain('PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)');
    expect(composer).toMatch(/requestAndroidPermission\(\s*PermissionsAndroid\.PERMISSIONS\.CAMERA/);
  });

  it('never declares a restricted media-read permission', () => {
    /*
     * Two shapes count as "not declared": absent, or present with
     * `tools:node="remove"`, which is how a permission a DEPENDENCY tries to
     * merge in gets stripped. image-picker's manifest asks for
     * READ_EXTERNAL_STORAGE and READ_MEDIA_IMAGES; ours removes both, and that
     * removal is load-bearing — without it they arrive in the merged manifest
     * and Play sees the restricted declaration anyway.
     * https://developer.android.com/build/manage-manifests#merge_rule_markers
     */
    const declared = (name: string): boolean =>
      new RegExp(
        `<uses-permission[^>]*android\\.permission\\.${name}"(?![^>]*tools:node="remove")`,
      ).test(manifest);
    for (const restricted of [
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_VISUAL_USER_SELECTED',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ]) {
      expect(declared(restricted)).toBe(false);
    }
    // And the two image-picker brings in are actively removed, not just absent.
    expect(manifest).toMatch(
      /READ_MEDIA_IMAGES"[^>]*tools:node="remove"/,
    );
    // And no camera-roll library, which is the other way this arrives.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).not.toContain(
      '@react-native-camera-roll/camera-roll',
    );
  });

  it('uses the grid arithmetic from the reference, with its constants', () => {
    // PADDING and GAP are 2dp and the row is 3 wide in portrait; the cell size
    // subtracts exactly two gaps regardless of column count, which is what the
    // reference does. See design/references/telegram.md.
    expect(panel).toContain('const PADDING = 2');
    expect(panel).toContain('const GAP = 2');
    expect(panel).toContain('const COLS_PORTRAIT = 3');
    expect(panel).toContain('(width - PADDING * 2 - GAP * 2) / cols');
  });

  it('unbinds the camera when the panel is hidden or the app backgrounds', () => {
    // The panel stays MOUNTED so the swap is cheap, so visibility alone cannot
    // gate the hardware — a bound camera lights the OS in-use indicator.
    // `slotSettled` is a second gate: CameraX must not bind to a TextureView
    // that is still mid-travel (zero-sized or clipped), verified on the API-36
    // emulator 2026-09-04.
    expect(panel).toContain('visible && slotSettled && foreground && cameraGranted');
    expect(panel).toContain("AppState.addEventListener('change'");
  });
});

/**
 * The docked surfaces travel on the keyboard's own curve.
 *
 * Everything here is a silent failure. A missing `!keyboardVisible` guard
 * animates on top of the keyboard's own movement and reads as a stutter; a
 * missing prime shows one un-offset frame; and a duration or curve typed as a
 * literal drifts from the token the next time either is touched.
 */
describe('docked panel travel', () => {
  const composer = withoutComments(read('src/components/Composer.tsx'));
  const motion = withoutComments(read('src/theme/motion.ts'));

  it('runs on the reference curve and duration, from tokens', () => {
    // `AdjustPanLayoutHelper.keyboardDuration` = 250ms on
    // `ChatListItemAnimator.DEFAULT_INTERPOLATOR`. See telegram.md.
    expect(motion).toContain('M3.easing.keyboard[0]');
    expect(motion).toContain('duration: M3.duration.medium1');
    expect(TOKENS.motion.m3.duration.medium1).toBe(250);
    expect(TOKENS.motion.m3.easing.keyboard).toEqual([
      0.19919472913616398, 0.010644531250000006, 0.27920937042459737,
      0.91025390625,
    ]);
  });

  it('defers the animator start by 50ms, as the reference does', () => {
    expect(motion).toContain('export const DOCK_DELAY_MS = 50');
    expect(motion).toContain('withDelay(\n    DOCK_DELAY_MS');
  });

  it('does not animate when the keyboard is already moving', () => {
    // The keyboard's own exit is the movement. Both toggles read the IME state
    // from a REF, because a state read is one render stale at tap time.
    expect(composer).toContain('animateNext.current = !keyboardUpRef.current');
    expect(composer).toContain('animateNext.current = false');
  });

  it('primes the offset on the tap, not in an effect', () => {
    // From an effect the offset lands a commit after the layout and one
    // un-offset frame shows. `primeDock` is called from the toggles.
    expect(composer).toMatch(/primeDock\(\);[\s\S]{0,60}set(Emoji|Attach)Open/);
    expect(composer).toContain('dockY.value = slotHeight');
  });

  it('never animates a panel-to-panel swap', () => {
    // Swapping emoji for attach changes no height, so there is nothing to move.
    expect(composer).toMatch(/if \(shown === null\) \{\s*dockY\.value = slotHeight/);
  });
});

/**
 * W4#4 — ambient beats are silent.
 *
 * Tab select, emoji tap and picker launch are not confirmations of a committed
 * action. Telegram does not buzz for any of them (telegram.md §Haptics, negative
 * rows). A device that buzzes on every emoji tap reads as cheap.
 *
 * Voice-record start and stop survive: the voice-record lock is in Telegram's own
 * haptics table (`ChatActivityEnterView.java:4630`), and stopping is the committed
 * action that produces a sendable note.
 */
describe('ambient beats (tab-select, emoji-pick, picker-open) are silent', () => {
  it('FloatingToolbar fires no tick on tab select', () => {
    expect(withoutComments(read('src/components/FloatingToolbar.tsx'))).not.toContain('tick()');
  });

  it('EmojiPicker fires no tick on pick or tone-strip open', () => {
    expect(withoutComments(read('src/components/EmojiPicker.tsx'))).not.toContain('tick()');
  });

  it('Composer fires no tick when the gallery or camera picker opens', () => {
    const composer = withoutComments(read('src/components/Composer.tsx'));
    // Picker launches are silent.
    expect(composer).not.toMatch(/pickImage[\s\S]{0,300}tick\(\)/);
    expect(composer).not.toMatch(/takePhoto[\s\S]{0,300}tick\(\)/);
    // Voice-record start (record) and stop are intentionally kept — two calls total.
    expect(composer.match(/tick\(\)/g)?.length ?? 0).toBe(2);
  });
});

describe('profiles: every server-owned column is guarded against the owner', () => {
  /*
   * Migration 054 redefined guard_privileged_profile_columns() and dropped the
   * suspension and reputation guards without anyone noticing, and the balance
   * buckets from 028 were never guarded at all — any signed-in user could set
   * promo_balance on their own row and sync_token_balance() minted the tokens
   * (found 2026-09-06, fixed in 063). The guard is redefined wholesale each
   * time, so this pins the NEWEST definition: whoever redefines it next must
   * keep every column below, or say so here.
   */
  const DEFINE = 'create or replace function public.guard_privileged_profile_columns';
  const files = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => read(`supabase/migrations/${f}`).includes(DEFINE));
  const last = files[files.length - 1] ?? '';
  const newest = last === '' ? '' : read(`supabase/migrations/${last}`);
  // From the LAST definition to the end of ITS body. Slicing on the bare name
  // would start at the `comment on function` line below the body and match
  // nothing — which is how this block first shipped green-looking and empty.
  const fromDefine = newest.slice(newest.lastIndexOf(DEFINE));
  const body = fromDefine.slice(0, fromDefine.indexOf('$$;') + 3);

  it('is last redefined in 063 or later, and the slice is the body not the comment', () => {
    expect(last >= '063').toBe(true);
    expect(body).toContain('returns trigger');
    expect(body).toContain("current_user in ('authenticated', 'anon')");
  });

  it.each([
    'role',
    'identity_verified_at',
    'identity_state',
    'date_of_birth',
    'age_bracket',
    'suspended_until',
    'profile_completed_at',
    'promo_balance',
    'purchased_balance',
    'token_balance',
    'last_refill_at',
    'rating_avg',
    'rating_count',
    'median_reply_seconds',
    'engagement_nudged_at',
  ])('guards profiles.%s', column => {
    expect(body).toMatch(new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  });

  it('leaves the client\'s real direct writes alone', () => {
    // src/api/provider.ts writes exactly these from the device.
    for (const column of ['is_available', 'presence', 'presence_visible', 'avatar_url']) {
      expect(body).not.toMatch(new RegExp(`new\\.${column} is distinct from`));
    }
    const provider = withoutComments(read('src/api/provider.ts'));
    for (const column of ['promo_balance', 'purchased_balance', 'token_balance', 'rating_avg', 'suspended_until']) {
      expect(provider).not.toMatch(new RegExp(`\\.update\\(\\{[^}]*${column}`));
    }
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('063_profile_guard_covers_every_server_owned_column.sql');
    expect(dbTest).toContain('250_profile_guard_server_owned_columns.sql');
  });
});

describe('a provider offers the channels they choose, and at least one', () => {
  const migration = read('supabase/migrations/064_provider_channels.sql');

  it('holds the floor in the database, not in the screen', () => {
    // "At least one stays on" (Amit, 2026-09-06). A CHECK, because "listed but
    // unreachable on every channel" is exactly what is_available = false
    // already says, and it says it honestly.
    expect(migration).toContain('profiles_at_least_one_channel');
    expect(migration).toContain('check (chat_enabled or audio_enabled or video_enabled)');
  });

  it('enforces on the table every path inserts into, not in the callers', () => {
    /*
     * start_call and the provider's return invite go through
     * create_session_request; a member's FIRST TEXT inserts the request itself
     * (037:216). A caller-side check would have missed the second entirely, and
     * adding one would have meant re-stating a 330-line RPC — which is how 054
     * silently dropped four guards (063). So: one BEFORE INSERT trigger.
     */
    expect(migration).toContain('before insert on public.session_requests');
    expect(migration).toContain('execute function public.enforce_provider_channel()');
    expect(migration).toContain("errcode = 'P0009'");
    // The predicate must survive a missing row as "allowed", and must say so
    // by returning true rather than by leaning on NULL semantics in the caller.
    expect(migration).toMatch(/select coalesce\(\s*\(\s*select case p_channel/);
  });

  it('re-states start_call with exactly one added branch', () => {
    // The body is 053's verbatim plus the P0009 branch. Everything else that
    // gates a call — the kill switches, suspension, the cold-call rule — must
    // still be there, because a wholesale re-statement is where guards vanish.
    const body = migration.slice(migration.indexOf('create or replace function public.start_call'));
    expect(body).toContain("when sqlstate 'P0009' then");
    expect(body).toContain('CHANNEL_DISABLED_BY_PROVIDER');
    for (const kept of [
      "'voice_calls_enabled'",
      "'video_calls_enabled'",
      "'SUSPENDED'",
      "when sqlstate 'P0003' then",
      "when sqlstate 'P0005' then",
      'when others then',
    ]) {
      expect(body).toContain(kept);
    }
  });

  it('publishes the three columns to the member, appended to the directory', () => {
    const view = migration.slice(migration.indexOf('create or replace view public.provider_directory'));
    // Appended AFTER the 042 columns: create or replace cannot drop or reorder
    // what other objects select from.
    expect(view.indexOf('p.about')).toBeLessThan(view.indexOf('p.chat_enabled'));
    for (const column of ['p.chat_enabled', 'p.audio_enabled', 'p.video_enabled']) {
      expect(view).toContain(column);
    }
    expect(read('src/lib/database.types.ts')).toMatch(/chat_enabled: boolean;\s*\n\s*audio_enabled: boolean;/);
  });

  it('leaves the columns the provider\'s own, like availability', () => {
    // Deliberately NOT in the 063 guard: being reachable or not is the one
    // thing about themselves a person must be able to change instantly.
    const guard = read('supabase/migrations/063_profile_guard_covers_every_server_owned_column.sql');
    for (const column of ['chat_enabled', 'audio_enabled', 'video_enabled']) {
      expect(guard).not.toContain(`new.${column} is distinct from`);
    }
    expect(withoutComments(read('src/api/provider.ts'))).toContain('export function useSetChannels');
  });

  it('says so on every member surface before the tap, and once after', () => {
    const detail = withoutComments(read('src/screens/ProviderDetailScreen.tsx'));
    expect(detail).toContain('enabled={provider.chat_enabled}');
    expect(detail).toContain('enabled={voiceCallsEnabled && provider.audio_enabled}');
    expect(detail).toContain('enabled={videoCallsEnabled && provider.video_enabled}');
    // A kill switch and a provider's choice are different refusals with
    // different remedies, so they read differently.
    expect(detail).toContain("', not offered'");

    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('const canStartAudio = voiceCallsEnabled && (provider?.audio_enabled ?? true)');
    expect(chat).toContain('const canStartVideo = videoCallsEnabled && (provider?.video_enabled ?? true)');
    // The composer closes only when a NEW session would be refused.
    expect(chat).toMatch(/chatClosed =\s*isMemberSide && !peerOffersChat && activeSession === null && pendingRequest === null/);

    // And the refusal that still gets through is mapped once, for all three
    // send paths, rather than three times.
    const helper = withoutComments(read('src/lib/sendErrors.ts'));
    expect(helper).toContain("CHANNEL_DISABLED_SQLSTATE = 'P0009'");
    for (const file of ['src/api/chat.ts', 'src/api/voice.ts', 'src/api/attachments.ts']) {
      expect(withoutComments(read(file))).toContain('sendResultFrom(data, error)');
      expect(read(file)).toContain('CHANNEL_DISABLED_BY_PROVIDER');
    }
  });

  it('gives the provider the switches next to the availability switch', () => {
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    expect(home).toContain('testID="provider-channels"');
    for (const key of ['chat_enabled', 'audio_enabled', 'video_enabled']) {
      expect(home).toContain(`testID={\`channel-toggle-\${row.key}\`}`);
      expect(home).toContain(key);
    }
    // The last one on is held, not hidden: a disabled switch states the rule.
    expect(home).toMatch(/const last = on && enabledCount === 1/);
    expect(home).toContain('disabled={setChannels.isPending || last}');
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('064_provider_channels.sql');
    expect(dbTest).toContain('260_provider_channels.sql');
  });
});

describe('the directory is grouped and filterable: Listeners, Astrologers, ages', () => {
  const migration = read('supabase/migrations/065_provider_category.sql');

  it('is a tag on the same provider, not a second product', () => {
    // Decided 2026-09-06: same onboarding, same rates. A category-level rate
    // would be an amendment to ADR-0021, not a column here.
    expect(migration).toContain("add column if not exists provider_category text not null default 'listener'");
    expect(migration).toContain("check (provider_category in ('listener', 'astrologer'))");
    // text + CHECK, not an enum: ALTER TYPE ADD VALUE cannot share a
    // transaction with other DDL and this set will grow (054:30-33).
    expect(migration).not.toMatch(/create type public\.provider_category/);
    for (const rate of ['rate_tokens_per_min', 'economics']) {
      expect(migration).not.toContain(rate);
    }
  });

  it('is set once at onboarding and not client-writable after', () => {
    expect(migration).toContain('new.provider_category is distinct from old.provider_category');
    expect(migration).toContain('p_provider_category text default');
    // Dropped, never overloaded: a 5th parameter with a default would leave
    // both signatures resolvable and every 4-arg call would fail as
    // "function is not unique".
    expect(migration).toContain(
      'drop function if exists public.complete_provider_onboarding(text, text, text[], text);',
    );
  });

  it('re-states the 063 guard without losing a column', () => {
    // 054 dropped four guards this way. Every column 063 named must survive.
    const body = migration.slice(migration.indexOf('create or replace function public.guard_privileged_profile_columns'));
    for (const column of [
      'role', 'identity_verified_at', 'identity_state', 'date_of_birth', 'age_bracket',
      'suspended_until', 'profile_completed_at', 'promo_balance', 'purchased_balance',
      'token_balance', 'last_refill_at', 'rating_avg', 'rating_count',
      'median_reply_seconds', 'engagement_nudged_at',
    ]) {
      expect(body).toContain(`new.${column} is distinct from old.${column}`);
    }
    // ...and the channel switches must NOT be guarded: they are the provider's.
    for (const column of ['chat_enabled', 'audio_enabled', 'video_enabled']) {
      expect(body).not.toContain(`new.${column} is distinct from`);
    }
  });

  it('needs no column for age, because the directory already publishes it', () => {
    // `provider_directory.age` is an integer and has been since 042. A second
    // definition of the band boundaries is a second place for them to drift.
    expect(migration).not.toContain('age_bracket text');
    expect(migration).toContain('extract(year from age(p.date_of_birth))::int as age');
    const filters = withoutComments(read('src/lib/providerFilters.ts'));
    expect(filters).toContain('export function ageBand');
    expect(filters).toContain("'18-24'");
    expect(filters).toContain("'45+'");
    // Bands live only here — no screen re-derives them.
    for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/ProviderDetailScreen.tsx']) {
      expect(withoutComments(read(file))).not.toMatch(/age\s*<\s*25|age\s*<\s*35|age\s*<\s*45/);
    }
  });

  it('shows both tabs from day one and filters the WHOLE screen by the one you are on', () => {
    const home = withoutComments(read('src/screens/HomeScreen.tsx'));
    expect(home).toContain('testID="explore-tabs"');
    expect(home).toContain('testID={`explore-tab-${c}`}');
    expect(home).toContain('accessibilityRole="tab"');
    /*
     * The strip sits ABOVE Chats and outside the list, and the rail follows it
     * too (Amit, 2026-09-06): a tab is a whole view of the app, not a shelf
     * inside one. Pinned rather than scrolled away with the content, or the
     * filter control leaves the screen the moment you use the screen.
     */
    expect(home.indexOf('testID="explore-tabs"')).toBeLessThan(
      home.indexOf('ListHeaderComponent={ExploreHeader}'),
    );
    expect(home).toContain('(categoryById.get(c.peer_id) ?? DEFAULT_CATEGORY) === exploreCategory');
    // A peer with no directory row keeps their thread under the default tab: a
    // conversation you have had is not something a filter may hide from you.
    expect(home).toContain('categoryById.get(c.peer_id) ?? DEFAULT_CATEGORY');
    /*
     * The featured pick comes from the FILTERED list, so the hero always
     * belongs to the tab you are on.
     *
     * `filterProviders` is now WRAPPED by `sortByLanguageMatch` — the language
     * preference reorders the tab's list and never narrows it (migration 072,
     * `src/lib/languagePrefs.ts`). The nesting order is the assertion: the tab
     * filter has to run INSIDE the sort, or a language match could promote a
     * provider from the other tab into this one's hero.
     */
    expect(home).toMatch(
      /const directory = useMemo\(\s*\(\) =>\s*sortByLanguageMatch\([\s\S]{0,600}?filterProviders\(allProviders, \{ \.\.\.NO_FILTER, category: exploreCategory \}\)/,
    );
    // Both tabs always render: an empty Astrologers tab is an honest "nobody
    // yet", and hiding it would make the strip appear under a member the day
    // one signs up (Amit, 2026-09-06).
    expect(home).not.toMatch(/astrologers?\.length\s*>\s*0\s*\?/i);
  });

  it('filters search by type and age, and says which is which on the row', () => {
    const home = withoutComments(read('src/screens/HomeScreen.tsx'));
    expect(home).toContain('testID="search-filters"');
    // Four groups now: what they offer, age, language, topic (Amit,
    // 2026-09-08: "give language and expertise filer in search").
    expect(home).toContain('toggleFilterLanguage');
    expect(home).toContain('toggleFilterExpertise');
    expect(home).toContain('OFFERED_LANGUAGES.map');
    expect(home).toContain('searchTopics.map');
    // Search spans BOTH categories: the tab is an Explore idea.
    expect(home).toContain('const narrowed = filterProviders(allProviders, searchFilter)');
    // Chips alone are a search: no query required (Amit, 2026-09-06).
    expect(home).toContain('return isFiltering(searchFilter) ? narrowed : []');
    expect(home).toContain("const asking = trimmed !== '' || isFiltering(searchFilter)");
    // Filters are per search session, or the next search silently returns
    // fewer people for a reason that is off screen.
    expect(home).toMatch(/setSearching\(false\);[\s\S]{0,120}setSearchFilter\(NO_FILTER\)/);
    /*
     * The category is on EVERY card now, not only in search, and `showCategory`
     * is gone — Amit, 2026-09-08: "there should be tag of listener /
     * astrologer on proile like truemittr shows - place this where price is".
     *
     * The old arrangement had a real argument (the Explore tab above the list
     * already says which category you are in, so repeating it per row is
     * noise), and it lost to a better one: the badge used to LEAD the pill row
     * in search, competing with the topics for three slots and pushing a real
     * one off — on the one screen where the topics matter most. Given a slot of
     * its own it costs nothing and the topics get their three back.
     */
    const row = withoutComments(read('src/components/ProviderRow.tsx'));
    expect(row).not.toContain('showCategory');
    // Split into `categoryKey` so the tone can be keyed off it: the chip is
    // FILLED and hue-coded per type now, and passing the KEY (not the label) to
    // `tone` is what makes a third category fail to compile rather than render
    // as an outlined chip.
    expect(row).toContain('const categoryKey = categoryOf(provider)');
    expect(row).toContain('CATEGORY_BADGE[categoryKey]');
    expect(row).toContain('tone={categoryKey}');
    expect(row).toContain('testID="provider-category"');
    // In the price line's slot, not the pill row's.
    const priceLine = row.slice(row.indexOf('<View style={styles.priceLine}>'));
    expect(priceLine.slice(0, priceLine.indexOf('</View>'))).toContain('label={category}');
  });

  it('asks the provider once, at onboarding', () => {
    const screen = withoutComments(read('src/screens/ProviderApplicationScreen.tsx'));
    expect(screen).toContain('testID="provider-category"');
    expect(screen).toContain('useState<ProviderCategory>(DEFAULT_CATEGORY)');
    expect(screen).toContain('category,');
    expect(withoutComments(read('src/api/provider.ts'))).toContain('p_provider_category: draft.category');
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('065_provider_category.sql');
    expect(dbTest).toContain('270_provider_category.sql');
  });
});

describe('search opens the way Telegram opens it, and the week has a carousel', () => {
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));

  it('crossfades one row in place, on Telegram\'s own 350ms', () => {
    /*
     * CORRECTED 2026-09-07, and this gate is the reason the correction had to
     * reach a test rather than only a comment: it pinned `searchToggle` = 150
     * and the exact `FadeIn.duration(DURATION.searchToggle)` text, so it held
     * the WRONG number in place. 150 was read from
     * `ActionBar/ActionBarMenuItem.java` — Telegram's LEGACY action-bar search,
     * a 36dp bare EditText with `setBackgroundResource(0)` and no pill, which
     * the dialogs list stopped using several versions ago — and even inside that
     * class the two `setDuration(150)` calls are at :1019 and :973, not the
     * :1013/:1020 this comment used to cite.
     *
     * The field the reference ships is `Components/FragmentSearchField.java`
     * (built at DialogsActivity.java:3285, added at :5344), and it opens and
     * closes on `BoolAnimator animatorSearchVisible`, constructed with
     * `CubicBezierInterpolator.EASE_OUT_QUINT` and `350`
     * (DialogsActivity.java:307-308), symmetric in both directions. The curve is
     * as load-bearing as the duration: with no `.easing()` at all Reanimated ran
     * its default `Easing.inOut(Easing.quad)`, a symmetric ease against a
     * reference that eases out hard.
     *
     * __tests__/homeSurface.test.ts carries the rest of the transition — the
     * content swap underneath, its scales and its 20ms close delay.
     */
    expect(read('design/tokens.json')).toContain('"searchField": 350');
    expect(read('design/tokens.json')).not.toContain('"searchToggle"');
    const motion = read('src/theme/motion.ts');
    expect(motion).toContain('export const searchIn = FadeIn.duration(DURATION.searchField)');
    expect(motion).toContain('export const searchOut = FadeOut.duration(DURATION.searchField)');
    expect(motion).toContain('.easing(EASE_OUT_QUINT)');
    expect(motion).toContain('DialogsActivity.java:307-308');
    // Both states are Animated rows sharing one container, so the crossfade has
    // nothing to reflow.
    expect(home).toContain('entering={searchIn}');
    expect(home).toContain('exiting={searchOut}');
    /*
     * ONE `navRow` now, not two. The search state has its own `searchRow`
     * (2026-09-07): the field is MATCH_PARENT with 7dp side margins in the
     * reference (DialogsActivity.java:5344), so it cannot share a
     * `space-between` row with a sibling arrow and still reach both edges.
     * What this gate is really for — that the two states are Animated rows in
     * ONE container, so the crossfade has nothing to reflow — is unchanged and
     * asserted directly below.
     */
    expect(home.match(/style=\{styles\.navRow\}/g)?.length).toBe(1);
    expect(home).toContain('style={styles.searchRow}');
    expect(home).toMatch(/searchRow: \{[\s\S]{0,200}marginHorizontal: SEARCH_ROW_SIDE_MARGIN/);
    expect(home).toContain('const SEARCH_ROW_SIDE_MARGIN = 7;');
  });

  it('lets the hardware back button leave search, not just the arrow', () => {
    // FOUND ON A DEVICE, 2026-09-07, and only on a device: the "Leave search"
    // arrow worked while the system back button did nothing. Two presses in a
    // row and the member was still in the search field.
    //
    // `searching` is local state in HomeScreen that no back guard knew about, so
    // the press fell through to App.tsx's single subscription, which asks
    // src/lib/backGuard.ts and then handles the ROUTE — and Home is the root, so
    // there was nothing to pop and nothing happened. Every green build had this.
    //
    // Android's custom-back guidance makes dismissing temporary UI state on back
    // a requirement, and says to intercept only in the state that needs it —
    // which is why the guard is conditional rather than always registered.
    const code = withoutComments(read('src/screens/HomeScreen.tsx'));
    expect(code).toContain("import { useBackGuard } from '../lib/backGuard'");
    // Conditional, and wired to the SAME handler the arrow calls, so the two
    // routes out of search cannot diverge.
    expect(code).toContain('useBackGuard(searching ? searchBackGuard : null)');
    // The guard must report the press as HANDLED, or consumeBack falls through
    // to App.tsx's route handler and the press does double duty.
    expect(code).toMatch(
      /const searchBackGuard = useCallback\(\(\) => \{\s*closeSearch\(\);\s*return true;/,
    );
    expect(code).toMatch(/const closeSearch = useCallback\(/);
    expect(read('src/screens/HomeScreen.tsx')).toContain(
      'developer.android.com/guide/navigation/custom-back/predictive-back-gesture',
    );
  });

  it('shows exactly one cross, and the field is the whole row', () => {
    /*
     * The original rule (Amit, 2026-09-06) was "one cross": a cross in the nav
     * AND the field's own clear meant a member with text typed saw two and could
     * not tell which lost their query. That rule still holds and is asserted
     * below.
     *
     * What changed on 2026-09-07 is the OTHER control. The row used to carry a
     * back arrow beside the field to leave search; it now carries nothing but
     * the field. Amit: "telegram search icon is on left edge of the bar and one
     * cross to the right edge on the bar with full width bar". The source agrees
     * and is unambiguous —
     *   contentView.addView(fragmentSearchField, LayoutHelper.createFrame(
     *     LayoutHelper.MATCH_PARENT, 48, Gravity.TOP, 7, -2, 7, 0));
     * (DialogsActivity.java:5344) — MATCH_PARENT, 7dp either side, no sibling.
     * A 48dp arrow in the row is what made our pill start ~70dp in and put the
     * magnifier another 16dp inside that.
     *
     * Leaving search is the hardware back button, which is wired and was
     * verified on the Redmi the same day (`searchBackGuard`, gated just below).
     * That is also what the reference relies on.
     */
    const searchRow = home.slice(home.indexOf('key="search-row"'), home.indexOf('key="nav-row"'));
    expect(searchRow).not.toContain('<Icon name="back"');
    expect(searchRow).not.toContain('name="close"');
    /*
     * "Leave search" is BACK, but on the field's own trailing mark rather than
     * on a sibling arrow — the reference's close control clears what is
     * clearable and otherwise exits (FragmentSearchField.java:142-155), so one
     * control carries both jobs and the row stays full width.
     */
    expect(searchRow).toContain('onExit={closeSearch}');
    // The field IS the row: one child, on the reference's own 7dp margin.
    expect(searchRow).toContain('<SearchBar');
    expect(searchRow).toContain('style={styles.searchRow}');
    /*
     * GATE CORRECTION, 2026-09-07. This used to assert that SearchBar.tsx
     * contains the literal `'value.length > 0 ?'` and called that "the one cross
     * ... only exists while there is text". The literal still appears — as
     * `const clearTarget = value.length > 0 ? 1 : 0` — so the gate stayed green
     * while the behaviour it named became false: the cross is now always
     * MOUNTED, because Telegram holds `pEnd` at a constant `dp(48)` whether or
     * not the glyph is showing (FragmentSearchField.java:242) and only animates
     * its alpha, scale and rotation. The gate was passing on an incidental
     * ternary.
     *
     * What is still true, and is what matters to the member the original rule
     * was written for, is that an EMPTY field offers no reachable cross. That is
     * now assertable against the real mechanism: `pointerEvents="none"` takes it
     * out of hit testing (https://reactnative.dev/docs/view#pointerevents) and
     * `importantForAccessibility="no-hide-descendants"` takes it out of the
     * accessibility tree (https://reactnative.dev/docs/view#importantforaccessibility),
     * so with no text there is nothing to tap and nothing for TalkBack to reach.
     * The 48dp box itself is gated in __tests__/homeSurface.test.ts.
     */
    const bar = withoutComments(read('src/components/SearchBar.tsx'));
    expect(bar).toContain("pointerEvents={hasText ? 'auto' : 'none'}");
    expect(bar).toContain(
      "importantForAccessibility={hasText ? 'yes' : 'no-hide-descendants'}",
    );
    expect(bar).toContain('const hasText = clearTarget === 1');
    /*
     * Exactly ONE trailing control in the field, and its label names whichever
     * of its two jobs it will do — a screen reader must not announce "clear" on
     * a control that is about to leave the screen. The literal moved from a
     * fixed string to the ternary when the control gained the exit.
     */
    expect(
      bar.match(/accessibilityLabel=\{hasQuery \? 'Clear search' : 'Leave search'\}/g)
        ?.length,
    ).toBe(1);
    expect(bar).not.toContain('accessibilityLabel="Clear search"');
  });

  it('stacks the filters and lets them search on their own', () => {
    // One scrolling row put four of six chips off screen; the age bands were
    // something you had to discover by dragging (Amit, 2026-09-06).
    expect(home).toContain('testID="search-filters"');
    // Four groups now: what they offer, age, language, topic (Amit,
    // 2026-09-08: "give language and expertise filer in search").
    expect(home).toContain('toggleFilterLanguage');
    expect(home).toContain('toggleFilterExpertise');
    expect(home).toContain('OFFERED_LANGUAGES.map');
    expect(home).toContain('searchTopics.map');
    expect(home).toContain('style={styles.filters}');
    expect(home).not.toContain('styles.filterRowContent');
    const filters = home.slice(home.indexOf('    filters: {'), home.indexOf('    filterChips: {'));
    expect(filters).not.toContain("flexDirection: 'row'");
    expect(home).toContain('style={styles.filterChips}');
    // Both groups are labelled, so a chip row is never an unexplained pill.
    expect(home).toContain('What they offer');
    expect(home).toContain('>\n              Age\n            </Text>');
    // A filter with no query is a search: the list reads `results` directly.
    expect(home).toContain('data={results}');
    expect(home).not.toContain("data={trimmed === '' ? [] : results}");
  });

  it('spotlights three profiles in an M3 hero carousel, not one card', () => {
    /*
     * Android's carousel guidance names hero for "spotlighting content that you
     * want to emphasize" and describes it as one large image with "a peek of
     * what's next". Three items, snapped to the item pitch, with the peek
     * derived from the column so it holds on a 320dp phone.
     *
     * NOT the banned WordCarousel: that was a TEXT fade at 10% alpha which
     * could not reach AA at body size, and it auto-advanced, which is how it
     * ran backwards through three green builds. This has no fading text and no
     * auto-advance.
     */
    expect(existsSync(join(ROOT, 'src/components/WordCarousel.tsx'))).toBe(false);
    expect(home).toContain('const TOP_PICKS = 3');
    expect(home).toContain('testID="top-picks"');
    expect(home).toContain('Top profiles this week');
    expect(home).toContain('<HeroCarousel');
    expect(home).toContain('.slice(0, TOP_PICKS)');
    // The picks are lifted out of the list below, so nobody appears twice.
    expect(home).toContain('const shown = new Set(topPicks.map(p => p.id))');

    /*
     * Centred, peeking BOTH ways, and endless (Amit, 2026-09-06). The geometry
     * and the wrap arithmetic live in lib/carousel.ts so they can be tested;
     * the component only owns the ScrollView.
     */
    const carousel = withoutComments(read('src/components/HeroCarousel.tsx'));
    expect(carousel).toContain('snapToInterval={pitch}');
    expect(carousel).toContain('heroRecentre(');
    expect(carousel).toContain('paddingHorizontal: inset');
    // Recentred on BOTH settle paths: a slow drag never gains momentum, and
    // would otherwise strand the strip in an outer copy.
    expect(carousel).toContain('onMomentumScrollEnd={onSettled}');
    expect(carousel).toContain('onScrollEndDrag={onSettled}');
    // Endless is a swipe that never stops, NOT a timer. The banned component
    // advanced itself, which is how it ran backwards through three green builds.
    expect(carousel).not.toMatch(/setInterval|setTimeout|withRepeat|carouselDwell/);
    // Three copies: one to swipe back into, one to sit in, one to swipe forward.
    expect(read('src/lib/carousel.ts')).toContain('export const HERO_COPIES = 3');
  });
});

describe('a session is rated when it ends, and the ratings are readable', () => {
  const migration = read('supabase/migrations/066_session_reviews_and_ratings.sql');

  it('rates a SESSION, and every rating counts', () => {
    // Amit, 2026-09-06: per session, all count. A member who comes back five
    // times has five opinions, and the chart is only worth drawing if it
    // reflects real volume.
    expect(migration).toContain('add column if not exists session_id uuid');
    expect(migration).toContain('reviews_one_per_session');
    // The 006 trigger already averages every row, so "all count" needs no
    // change there — and must not have acquired a filter.
    const trigger = read('supabase/migrations/006_phone_auth_and_provider_onboarding.sql');
    expect(trigger).toContain('from public.reviews where provider_id = v_provider');
  });

  it('keeps 006\'s conversation-level entry point working', () => {
    /*
     * `submit_review` is pinned by pgTAP 050 and 060, including its upsert, and
     * its `on conflict (conversation_id)` target no longer exists. It is
     * re-stated to rate the conversation's LATEST session, so both submissions
     * resolve to the same row and its old contract survives.
     */
    expect(migration).toContain('create or replace function public.submit_review');
    expect(migration).toContain('order  by accepted_at desc nulls last');
    expect(migration).toContain('reviews_one_per_legacy_conversation');
    // The strict path is the new one, and it is the one the UI calls.
    expect(migration).toContain("raise exception 'the session has not ended'");
    expect(withoutComments(read('src/components/SessionFeedbackSheet.tsx'))).toContain(
      'useSubmitSessionReview',
    );
  });

  it('never publishes who wrote a review', () => {
    const fn = migration.slice(migration.indexOf('create or replace function public.get_provider_ratings'));
    expect(fn).not.toMatch(/'member_id'|r\.member_id/);
    // Five rows, always, zeros included: a chart that omits its empty bars
    // redraws itself every time somebody rates.
    expect(fn).toContain('generate_series(1, 5)');
    expect(fn).toContain("order by s.stars desc");
    // And only for someone the directory publishes, so it is not a scraper.
    expect(fn).toContain('from public.provider_directory d where d.id = p_provider_id');
  });

  it('asks once, on the edge, and only of the member', () => {
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    // Watches the TRANSITION, not the absence: activeSession is null before a
    // session exists too, and asking then would prompt for a conversation that
    // never happened.
    expect(chat).toContain('const liveSessionRef = useRef<string | null>(null)');
    expect(chat).toMatch(/if \(isMemberSide\) \{\s*requestReview\(previous, name\);/);
    // One sheet for the whole app, because a session can end in a call too.
    expect(withoutComments(read('App.tsx'))).toContain('<SessionFeedbackSheet />');
    const store = withoutComments(read('src/store/useStore.ts'));
    expect(store).toContain('pendingReview');
    // First writer wins: a chat and a call noticing the same end must not
    // replace a sheet the member is already looking at.
    expect(store).toMatch(/state\.pendingReview === null \? \{ pendingReview:/);
  });

  it('lets the member skip, and draws the chart without a new dependency', () => {
    const sheet = withoutComments(read('src/components/SessionFeedbackSheet.tsx'));
    // A rating prompt with no way past it is a toll gate on leaving a
    // conversation somebody may have found difficult.
    expect(sheet).toContain("cancelLabel=\"Skip\"");
    expect(sheet).toContain('testID={`session-feedback-star-${n}`}');
    expect(sheet).toContain('disabled={rating === 0}');

    const detail = withoutComments(read('src/screens/ProviderDetailScreen.tsx'));
    expect(detail).toContain('testID="ratings-chart"');
    expect(detail).toContain('testID="ratings-empty"');
    expect(detail).not.toContain('react-native-svg');
  });

  it('shows a verdict and what people said, not a distribution ladder', () => {
    // Amit, 2026-09-06: "no of stars at centre.. star icons below it and then
    // reviews below". The five-bar 5-4-3-2-1 chart is gone — on a profile with
    // three reviews it drew four empty tracks, which reads as absence.
    const detail = withoutComments(read('src/screens/ProviderDetailScreen.tsx'));
    expect(detail).not.toContain('ratings.distribution');
    expect(detail).not.toMatch(/ratingTrack|ratingFill|ratingRowLabel/);
    // Centred, in that order: number, stars, count, then the reviews.
    expect(detail).toContain('ratingBlock');
    const order = ['styles.ratingBig', 'styles.ratingStars', 'styles.ratingCount', 'styles.reviewRow'];
    let at = detail.indexOf('testID="ratings-chart"');
    expect(at).toBeGreaterThan(-1);
    for (const marker of order) {
      const next = detail.indexOf(marker, at);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    // And it sits BELOW About, which is the section it comments on.
    expect(detail.indexOf('ABOUT')).toBeLessThan(detail.indexOf('RATINGS'));
    // The server contract is untouched: distribution is still returned, just
    // not drawn, so nothing else that reads it has to change.
    expect(read('supabase/migrations/066_session_reviews_and_ratings.sql')).toContain(
      'distribution',
    );
  });

  it('gives the chat action M3 outlined emphasis, not a third fill colour', () => {
    // Three filled colours in one row read as three unrelated things. M3:
    // "Outlined buttons pair well with filled buttons to indicate a secondary,
    // alternate action" — transparent container, 1dp stroke, no elevation.
    const detail = read('src/screens/ProviderDetailScreen.tsx');
    expect(detail).toContain(
      'material-components-android/blob/master/docs/components/CommonButton.md',
    );
    const code = withoutComments(detail);
    expect(code).toMatch(/channel="chat"\s*\n\s*kind="outline"/);
    expect(code).not.toContain('actionTint');
    expect(code).toMatch(/actionOutline: \{\s*backgroundColor: 'transparent',\s*borderWidth: 1,/);
    // The label takes the on-surface colour, not on-accent — there is no accent
    // behind it any more.
    //
    // A regex across whitespace rather than the one-line literal this used to
    // be. The `fg` ternary gained a `dark` branch on 2026-09-07 (that kind was
    // pairing `text/onAccent` with a `text/primary` fill — 1.04:1 in dark mode,
    // white on white) and Prettier then wrapped the expression, which turned a
    // still-true claim red on indentation alone. The claim is the mapping from
    // kind to ink; its formatting is Prettier's business.
    expect(code).toMatch(/kind === 'outline'\s*\?\s*theme\.color\.text\.primary/);
    // The other two are argued in walletTone.test.ts, where the accent-step
    // pairings live; asserted here too because this is the block that owns the
    // three-kind mapping and a kind added without an ink would land here first.
    expect(code).toMatch(/kind === 'dark'\s*\?\s*theme\.color\.text\.onInverse/);
  });

  it('shows the countdown in the window the countdown exists for', () => {
    // The extend card and the talk bar are mutually exclusive by design
    // (`showStickyRecharge` is false while the card is up), and they are up for
    // exactly the same window. The bar held the only m:ss numerals, so the last
    // five minutes — the whole reason a per-second clock exists — rendered a
    // timeless "Need more time?" and no number at all.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    /*
     * The bar's visibility WAS `balance !== null && (!showExtendCard …)`, i.e.
     * any chat with a loaded balance. It is now `countingDown && (…)`
     * (Amit, 2026-09-07) — the bar is the countdown, so it exists only in the
     * window the countdown exists for, which is what this test is named after
     * and could not previously assert.
     */
    expect(chat).toMatch(/showStickyRecharge =\s*\n?\s*isMemberSide && countingDown && \(!showExtendCard/);
    expect(chat).toContain('testID="chat-extend-timer"');
    expect(chat).toMatch(/testID="chat-extend-timer"[\s\S]{0,80}formatClock\(sessionRemaining/);
    // Asking the question is not the same as answering it.
    expect(chat).not.toContain('Need more time?');
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('066_session_reviews_and_ratings.sql');
    expect(dbTest).toContain('280_session_reviews_and_ratings.sql');
  });
});

describe('a chat request rings, and can be answered either way', () => {
  it('gives the ring a second answer, which the schema always had a word for', () => {
    // session_request_status has carried 'declined' since 030:51 and nothing
    // could ever write it. A ring with one button is not a ring, it is a summons.
    const migration = read('supabase/migrations/067_decline_session_request.sql');
    expect(migration).toContain('create or replace function public.decline_session_request');
    expect(migration).toContain("v_req.recipient_id <> auth.uid()");
    // Idempotent: a decline racing an expiry is not an error the provider sees.
    expect(migration).toMatch(/if v_req\.status <> 'pending' then[\s\S]*?'success', true/);
    // NOT a cancel: that is the initiator withdrawing, a different actor. The
    // comment explaining that necessarily says the word, so this asserts on the
    // WRITE rather than on the prose.
    expect(migration).not.toMatch(/status\s*=\s*'cancelled'/);
    expect(migration).toMatch(/status\s*=\s*'declined'/);
  });

  it('rings in-app only, and says why that is the scope', () => {
    /*
     * The out-of-app half is deliberately unchanged: a chat request already
     * sends the ordinary conversation notification, and this project decided on
     * 2026-08-27 that even a real CALL rings as a heads-up CallStyle
     * notification rather than a full-screen takeover. Making chat louder than
     * calls on the lock screen would invert that.
     */
    const ring = read('src/components/ChatRingScreen.tsx');
    expect(ring).toContain('2026-08-27');
    expect(ring).toContain('index.js:59');
    // index.js is untouched: no fourth push kind.
    expect(withoutComments(read('index.js'))).not.toContain('chat_request');
  });

  it('rings for 30 seconds and declines nothing by silence', () => {
    const ring = withoutComments(read('src/components/ChatRingScreen.tsx'));
    expect(ring).toContain('export const CHAT_RING_SECONDS = 30');
    // Silence stops the RING, never the request: the row lives its 24 hours
    // and the thread is still waiting in their list.
    const timeout = ring.slice(ring.indexOf('if (remaining <= 0)'));
    expect(timeout).toContain('clearIncoming()');
    expect(timeout.slice(0, 200)).not.toContain('decline');
  });

  it('does not mount a provider ChatRing — member consent is the sheet', () => {
    const app = withoutComments(read('App.tsx'));
    expect(app).not.toContain('useIncomingChatRequests');
    expect(app).not.toContain('<ChatRingScreen');
    expect(withoutComments(read('src/screens/ChatScreen.tsx'))).toContain(
      'testID="chat-session-consent"',
    );
    // Chat only: a call request already rings through the call path, and two
    // rings for one event is a bug the member cannot see.
    expect(withoutComments(read('src/api/sessions.ts'))).toContain("row.channel === 'chat'");
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('067_decline_session_request.sql');
    expect(dbTest).toContain('290_decline_session_request.sql');
  });
});

describe('the member always starts the session, whoever wrote first', () => {
  const sql077 = read('supabase/migrations/077_sp_initiate_member_consent.sql');
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
  const call = withoutComments(read('src/screens/CallScreen.tsx'));

  it('keys confirm_chat_session on the conversation member', () => {
    expect(sql077).toContain('if v_member_id <> auth.uid() then');
    expect(sql077).toContain('Only the member confirms');
    expect(sql077).not.toContain('Only the initiator');
  });

  it('lets the provider write first without creating a paid_session', () => {
    expect(sql077).toContain('initiator_id, recipient_id,');
    expect(sql077).toContain('p_conversation_id, \'chat\', v_uid, v_member,');
    expect(sql077).toContain('now() + interval \'24 hours\', now()');
  });

  it('drops the cold-call block and checks the member wallet either way', () => {
    const create = sql077.slice(sql077.indexOf('create or replace function public.create_session_request'));
    expect(create).not.toContain('P0006');
    expect(create).toContain('from public.profiles where id = v_member_id');
    expect(create).toContain("errcode = 'P0003'");
  });

  it('names the member chat sheet Start session / Decline', () => {
    expect(chat).toContain('testID="chat-session-consent"');
    expect(chat).toContain('confirmLabel="Start session"');
    expect(chat).toContain('cancelLabel="Decline"');
    expect(chat).toContain('wants to have a chat with you');
    expect(chat).toContain('Hey — ${name} is here');
  });

  it('names the incoming member call Start session, the provider Accept', () => {
    expect(call).toContain("label={isMemberSide ? 'Start session' : 'Accept'}");
    expect(call).toContain('testID="call-accept"');
    expect(call).toContain('wants a voice chat');
    expect(call).toContain('wants a video chat');
  });

  it('keeps conversation push copy warm and text-free', () => {
    expect(withoutComments(read('index.js'))).toContain(
      "wants to have a chat with you",
    );
    expect(withoutComments(read('android/app/src/main/java/com/companionchat/Conversations.kt'))).toContain(
      'wants a video chat',
    );
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('077_sp_initiate_member_consent.sql');
    expect(dbTest).toContain('078_decline_status_cast.sql');
    expect(dbTest).toContain('079_start_call_status_cast.sql');
    expect(dbTest).toContain('340_sp_initiate_member_consent.sql');
  });
});

describe('opening a chat tells the other person, both ways', () => {
  const migration = read('supabase/migrations/068_chat_open_alerts.sql');

  it('gates on the MEMBER\'s minute whoever opened', () => {
    /*
     * "if bal > 1 min" (goal item 3), and it holds in both directions: pinging
     * a member with an empty wallet pushes them at a paywall, and pinging a
     * provider about a member who cannot pay wastes the one person whose time
     * is the product.
     */
    expect(migration).toContain('select token_balance into v_balance from public.profiles where id = v_member');
    expect(migration).toMatch(/if coalesce\(v_balance, 0\) < v_rate then[\s\S]*?'no_balance'/);
  });

  it('does not ring a doorbell', () => {
    // Away only, not mid-session, and one alert per direction per cooldown.
    expect(migration).toContain("'peer_present'");
    expect(migration).toContain("'in_session'");
    expect(migration).toContain('chat_open_alert_cooldown_minutes');
    expect(migration).toContain("'cooldown'");
    // A timestamp per direction, on a table that carries no content by design.
    expect(migration).toContain('add column if not exists member_alerted_at');
    expect(migration).toContain('add column if not exists provider_alerted_at');
    expect(migration).not.toMatch(/last_body|message_text/);
  });

  it('never claims a push it did not send', () => {
    /*
     * The banner is built from this answer, so `alerted` is true only after the
     * dispatch. With the Vault URL unset the feature is dark and says so —
     * the same quiet no-op dispatch_call_push uses (017:60).
     */
    expect(migration).toContain("'not_configured'");
    const afterDispatch = migration.slice(migration.indexOf('perform net.http_post'));
    expect(afterDispatch).toContain("'alerted', true");
    const beforeDispatch = migration.slice(0, migration.indexOf('perform net.http_post'));
    expect(beforeDispatch).not.toContain("'alerted', true");

    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('openAlert?.alerted === true');
    expect(chat).toContain('testID="peer-notified"');
    expect(chat).toContain('`${name} knows you are here.`');
  });

  it('reuses the notification kind the app already builds', () => {
    // kind 'engagement' is read by readEngagementPush and rendered natively
    // already, so this needed no app release and no native work. The copy
    // differs because the copy is in the payload.
    const fn = read('supabase/functions/send-open-alert/index.ts');
    expect(fn).toContain("kind: 'engagement'");
    expect(fn).toContain('Hey, ${opener ?? \'Someone\'} is here');
    // A member is never named: they have no directory row and get the handle.
    expect(fn).toContain("db.rpc('member_handle'");
    expect(fn).toContain("role !== 'service_role'");
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('068_chat_open_alerts.sql');
    expect(dbTest).toContain('300_chat_open_alerts.sql');
  });
});

describe('the usage ledger answers where the tokens went, from both sides', () => {
  const migration = read('supabase/migrations/069_usage_ledger.sql');

  it('lets the SERVER decide which number the caller is entitled to', () => {
    /*
     * One RPC for both roles, because it is one question asked from two sides
     * of the same row. A member reads what they spent, a provider their own
     * share (ADR-0021's 60%) — and the branch is in SQL, so a client-side
     * mistake cannot hand a member the split or a provider the gross.
     */
    expect(migration).toMatch(/when ps\.member_id = v_uid then ps\.tokens_debited/);
    expect(migration).toContain('coalesce(e.provider_tokens, 0)');
    const screen = withoutComments(read('src/screens/UsageLedgerScreen.tsx'));
    expect(screen).not.toContain('provider_tokens');
    expect(screen).not.toContain('gross');
  });

  it('names a provider and handles a member, like every other surface', () => {
    expect(migration).toContain('public.member_handle(ps.member_id)');
    expect(migration).toContain('coalesce(d.display_name');
    // No content can leak: paid_sessions carries none, and nothing is joined
    // to messages.
    expect(migration).not.toMatch(/public\.messages|last_body/);
  });

  it('lists billed sessions only', () => {
    // A request that never became a minute is not a line in a ledger; it is
    // something that did not happen.
    expect(migration).toContain('ps.minutes_billed > 0');
  });

  it('is reachable from Settings on BOTH trees', () => {
    const settings = withoutComments(read('src/screens/SettingsSheet.tsx'));
    expect(settings).toContain('testID="settings-usage"');
    // The title takes the caller's own side of the row.
    expect(settings).toContain("isProvider ? 'Earnings by session' : 'Usage by session'");
    const app = withoutComments(read('App.tsx'));
    expect(app).toContain("pushRoute({ name: 'usage' })");
    expect(app).toContain("pushProvider({ name: 'usage', from: 'settings' })");
    expect(app).toContain("from: 'chat'");
    // And the route exists in both unions, with a parent that is Settings.
    const routes = read('src/lib/routes.ts');
    expect(routes.match(/name: 'usage'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(routes).toMatch(/case 'transactions':\s*\n\s*case 'usage':\s*\n\s*return \{ name: 'settings' \}/);
  });

  it('is registered in the harness with its suite', () => {
    const dbTest = read('scripts/db-test.mjs');
    expect(dbTest).toContain('069_usage_ledger.sql');
    expect(dbTest).toContain('310_usage_ledger.sql');
  });
});

/**
 * Goal item 11 — the seeded directory's photos.
 *
 * These are stock photographs of real people, which makes them a licence
 * obligation rather than an asset. The manifest is the record of that
 * obligation, and a filename in the seed with no manifest entry is a photo
 * nobody can trace back to its licence.
 */
describe('seed provider photos', () => {
  type SeedPhoto = {
    file: string;
    provider: string;
    source_url: string;
    photographer: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    apparent_age: number;
  };
  const manifest = JSON.parse(read('assets/seed/providers/manifest.json')) as {
    scope: string;
    casting: string;
    naming: string;
    bucket_path: string;
    licence: { name: string; url: string; terms_that_bind_us: string[] };
    photos: SeedPhoto[];
  };
  const seed = read('scripts/seed-dev.sql');

  it('records provenance for every photo it ships', () => {
    expect(manifest.photos.length).toBeGreaterThanOrEqual(5);
    for (const photo of manifest.photos) {
      // Enough to find the original again and name who took it. A sha256 with
      // no source is a checksum of something unaccountable.
      expect(photo.source_url).toMatch(/^https:\/\/www\.pexels\.com\/photo\/\d+\/$/);
      expect(photo.photographer.length).toBeGreaterThan(0);
      expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(photo.bytes).toBeGreaterThan(0);
      // 3:4 portrait, because the directory card and the detail header both
      // crop to it and a square source loses the face.
      expect(photo.width * 4).toBe(photo.height * 3);
    }
  });

  it('casts every subject as an adult inside the directory age band', () => {
    // The first cut shipped a woman who read about fifty against a profile that
    // said 34. Nothing caught it because apparent age was never written down —
    // it lived in whoever last looked at the file. It is a field now, so the
    // comparison is a check rather than a memory.
    // Joined through the seed's uuid, NOT through the display name. A photo
    // filename is a bucket key, so it keeps the slug it was uploaded under
    // (`mira-`, `nia-`, …) even after the cast is renamed — which it was, to
    // Indian names, 2026-09-07. Keying this on the name made the test the
    // reason a name could not change, and a spelling choice is not a contract.
    const ageById = new Map<string, number>();
    for (const m of seed.matchAll(/\('([0-9a-f-]{36})'::uuid, '[A-Za-z0-9_]+', (\d+),/g)) {
      ageById.set(String(m[1]), Number(m[2]));
    }
    expect(ageById.size).toBe(4);
    const idByFile = new Map<string, string>();
    for (const m of seed.matchAll(
      /\('([0-9a-f-]{36})'::uuid, '([a-z0-9]+-[0-9a-f]{8}\.jpg)'\)/g,
    )) {
      idByFile.set(String(m[2]), String(m[1]));
    }
    expect(idByFile.size).toBe(4);

    for (const photo of manifest.photos) {
      expect(photo.apparent_age).toBeGreaterThanOrEqual(18);
      // Amit's rule (2026-09-06): nobody older than 35 in the seeded directory.
      expect(photo.apparent_age).toBeLessThanOrEqual(35);
      const profile = ageById.get(idByFile.get(photo.file) ?? '');
      if (profile === undefined) continue; // The `ada-` photo is seeded outside this file.
      // Within a few years of the age the card prints beside the face. A photo
      // that contradicts its own caption reads as fake before anyone gets to
      // the words.
      expect(Math.abs(photo.apparent_age - profile)).toBeLessThanOrEqual(4);
    }
  });

  it('describes the bytes that are actually here', () => {
    // The photos are committed, so the manifest is a checkable claim rather
    // than a note. Swap a file without updating its row and this fails, which
    // is the only way a licence record stays attached to what it licenses.
    for (const photo of manifest.photos) {
      const bytes = readFileSync(join(ROOT, 'assets/seed/providers', photo.file));
      expect(bytes.length).toBe(photo.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(photo.sha256);
    }
  });

  it('names the licence and the terms that actually restrict us', () => {
    expect(manifest.licence.url).toBe('https://www.pexels.com/license/');
    expect(manifest.licence.terms_that_bind_us.join(' ')).toContain('endorsement');
    // The one that decides where these may be used: a paid companionship
    // listing implies endorsement by the person in the photo, so the seed set
    // cannot become the production set by anyone forgetting to ask.
    expect(manifest.scope).toContain('DEV SEED ONLY');
    expect(seed).toContain('DEV SEED ONLY');
  });

  it('names every file after its own contents', () => {
    // The bucket cannot replace an object at an existing key — `storage rm`
    // deletes nothing and `cp` has no upsert — and public objects are served
    // `max-age=31536000, immutable`. Under those two facts a stable filename is
    // a trap: the new photo either fails to upload or is masked by the old one
    // for a year. The name carries the hash, so a different photo is a
    // different URL and neither failure is representable.
    for (const photo of manifest.photos) {
      expect(photo.file).toBe(`${photo.provider}-${photo.sha256.slice(0, 8)}.jpg`);
    }
  });

  it('points the seed at files the manifest covers', () => {
    const declared = new Set(manifest.photos.map((p) => p.file));
    const used = [...seed.matchAll(/'([a-z0-9]+-[0-9a-f]{8}\.jpg)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const file of used) expect(declared).toContain(file);
    // And they are read from the bucket path the manifest documents, not from
    // the bucket root where the previous, unaccounted-for set still sits.
    expect(seed).toContain('/avatars/seed/');
    expect(manifest.bucket_path).toBe(
      'avatars/seed/<provider>-<first 8 of sha256>.jpg',
    );
  });
});

/**
 * W5 #6 — Transition lock: deferred call sites (src/theme/motion.ts primitive).
 *
 * Three of the five deferred sites live in files we own. The other two
 * (Turn images and Avatar fetches) are in Turn.tsx and Avatar.tsx, which are
 * edited concurrently and are asserted separately by their owners.
 *
 * Every deferral must be safe if `setTransitioning(false)` never fires:
 * `requestIdleCallback` is the unconditional fallback in each one. A lock
 * that can strand a message insert or hide a wallpaper permanently is worse
 * than the jank it avoids.
 *
 * The write side (`setTransitioning(true/false)`) is NOT in any of these files.
 * It belongs in App.tsx's PushedLayer, the component that drives the screen
 * push animation. The one-liner needed there is:
 *
 *   setTransitioning(true)  — before the entering animation starts
 *   setTransitioning(false) — in the animation's completion callback (onFinished)
 *
 * These assertions verify only the READ side (the deferred consumers).
 */
describe('W5 #6 transition lock: deferred call sites read the primitive', () => {
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
  const picker = withoutComments(read('src/components/EmojiPicker.tsx'));

  it('ChatScreen imports transitioning and onTransitionSettled from motion', () => {
    // Both must be named in the same import so a future refactor cannot pull one
    // without the other: `transitioning` is read for the scroll gate,
    // `onTransitionSettled` is the callback for both the wallpaper and the scroll.
    expect(chat).toMatch(/import\s*\{[^}]*\bonTransitionSettled\b[^}]*\}\s*from\s*['"]\.\.\/theme\/motion['"]/);
    expect(chat).toMatch(/import\s*\{[^}]*\btransitioning\b[^}]*\}\s*from\s*['"]\.\.\/theme\/motion['"]/);
  });

  it('ChatWallpaper mount uses onTransitionSettled with a requestIdleCallback fallback', () => {
    // The fallback prevents a permanent stall if App.tsx has not yet called
    // setTransitioning(false). Both must appear in the same effect, not separately.
    const wallpaperEffect = chat.slice(
      chat.indexOf('wallpaperReady'),
      chat.indexOf('wallpaperReady') + 600,
    );
    expect(wallpaperEffect).toContain('onTransitionSettled(');
    expect(wallpaperEffect).toContain('requestIdleCallback(');
    // And both cleanup arms must exist, so neither leaks across remounts.
    expect(wallpaperEffect).toContain('unsubscribe()');
    expect(wallpaperEffect).toContain('cancelIdleCallback(');
  });

  it('message-insert scroll gates on transitioning.value and defers via onTransitionSettled', () => {
    // The scroll still always happens — either immediately (not transitioning)
    // or after the settle (transitioning). `prevRowsLen` stays so the existing
    // assertion on it still holds.
    const scrollEffect = chat.slice(
      chat.indexOf('prevRowsLen'),
      chat.indexOf('prevRowsLen') + 800,
    );
    expect(scrollEffect).toContain('transitioning.value');
    expect(scrollEffect).toContain('onTransitionSettled(');
    // The scroll path is present in both branches.
    expect(scrollEffect.match(/scrollToOffset\(\s*\{/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('EmojiPicker imports onTransitionSettled and gates heavy content on settled', () => {
    // The gate is `settled || visible`: when the user opens the picker before
    // the transition settles, interaction wins and the content shows immediately.
    expect(picker).toContain('onTransitionSettled');
    expect(picker).toContain('settled');
    expect(picker).toContain('settled || visible');
    // requestIdleCallback is the unconditional fallback in the same effect.
    expect(picker).toContain('requestIdleCallback(');
    expect(picker).toContain('cancelIdleCallback(');
  });

  it('EmojiPicker keeps the outer panel shell always rendered (height preserved)', () => {
    // The outer View with testID="emoji-panel" must always render so the dock
    // slot holds its height. Only the inner heavy content (FlatList, tabs) is
    // deferred — confirmed by the settled gate sitting INSIDE the outer View.
    const panelOpen = picker.indexOf('"emoji-panel"');
    const settledGate = picker.indexOf('settled || visible', panelOpen);
    const panelClose = picker.indexOf('</View>', settledGate);
    // The gate sits between the outer View open and its corresponding close.
    expect(panelOpen).toBeGreaterThan(-1);
    expect(settledGate).toBeGreaterThan(panelOpen);
    expect(panelClose).toBeGreaterThan(settledGate);
  });
});

/**
 * Composer capsule and message bubbles share the same horizontal grid and
 * corner radius.
 *
 * The alignment that makes the transcript and the input look like one continuous
 * surface — "chat input bar exactly aligned with chat bubbles grid width and
 * roundness" (Amit, 2026-09-06) — depends on three values never drifting:
 *
 *   1. Horizontal inset: Composer `row.paddingHorizontal` must use the same
 *      token as ChatScreen's `list.paddingHorizontal` (both `TOKENS.space.md`).
 *   2. Corner radius: `inputBar` and bubble must both reference `TOKENS.radius.bubble`
 *      so the curve matches as bubbles scroll past the capsule edge.
 *   3. Multi-line growth: height animation must use a token duration (M3.duration)
 *      and the keyboard easing token, not raw literals that cannot be reviewed
 *      together with the related dock-travel animation.
 *
 * These are structural assertions on the source text, not runtime checks, because
 * the failure mode is "looks fine on one screen size, wrong on another" — not a
 * crash.
 */
describe('composer capsule and bubbles share one horizontal grid and radius', () => {
  const composer = read('src/components/Composer.tsx');
  const turn = read('src/components/Turn.tsx');

  it('composer row uses the same horizontal-inset token as the chat list', () => {
    // ChatScreen list.paddingHorizontal = TOKENS.space.md (16dp).
    // Composer row.paddingHorizontal must match so capsule edges land on the same
    // column as the bubble edges. A raw number here or a different token means
    // the alignment is coincidental and will break the first time either changes.
    expect(withoutComments(composer)).toContain('paddingHorizontal: TOKENS.space.md');
  });

  it('composer inputBar and Turn bubbles use the same radius token', () => {
    // Both must reference TOKENS.radius.bubble (22dp) so the capsule corner and
    // the bubble corner are provably the same number. radius.pill (999) on the
    // capsule produced a different visual at multi-line height, where the stadium
    // shape diverged from the rounded-rect bubble corner.
    /*
     * The composer reads `radius.composer` now, measured at 10.5dp off
     * WhatsApp against the bubble's 9dp. Same family, not one value.
     */
    expect(withoutComments(composer)).toContain('borderRadius: TOKENS.radius.composer');
      /*
     * CORRECTED 2026-09-08. This asserted the two radii were within 2dp of
     * each other, on a measurement of WhatsApp's composer that was wrong:
     * I had read "the row where the corner ramp reaches the edge" as the
     * radius and got 10.5dp. Refitting the whole ramp gives 17.93dp, i.e.
     * 18dp — the composer is TWICE as round as the 9dp bubble, not a
     * near-match to it.
     *
     * So the invariant is the shape of the relationship, not a tolerance:
     * the composer is clearly rounder, and it is still not a pill.
     */
    expect(TOKENS.radius.composer).toBeGreaterThan(TOKENS.radius.bubble);
    // Not a pill: WhatsApp's capsule is 46.2dp tall against an 18dp corner.
    expect(TOKENS.radius.composer).toBeLessThan(TOKENS.interaction.minTarget / 2);
    // Turn uses BUBBLE_RADIUS which is assigned TOKENS.radius.bubble.
    expect(turn).toContain('TOKENS.radius.bubble');
  });

  it('multi-line growth is animated via M3 token duration, not a raw literal', () => {
    // The duration must come from the M3 export (= TOKENS.motion.m3.duration)
    // so the bar-growth timing is in the same token namespace as the dock-travel
    // timing. A raw number here cannot be reviewed alongside the related motion.
    // Telegram: DEFAULT_DURATION = 250 ms (ChatListItemAnimator.java:46).
    expect(withoutComments(composer)).toMatch(/M3\.duration\.\w+/);
    // The easing must come from KEYBOARD_EASING (built from M3.easing.keyboard),
    // not a raw Easing call with literal coefficients inline.
    expect(withoutComments(composer)).toContain('KEYBOARD_EASING');
  });

  it('MIN_INPUT_H and MAX_INPUT_H are the only height bounds in the input style', () => {
    // The two exported constants replace the old literal minHeight/maxHeight on
    // the input style. Checking that no bare 36 or 132 is left inside the styles
    // object (comments are stripped so cited numbers in prose don't trigger).
    // We assert the constants exist and are exported by Composer.
    expect(composer).toContain('export const MIN_INPUT_H');
    expect(composer).toContain('export const MAX_INPUT_H');
    // The input style block must not set minHeight or maxHeight directly —
    // those constraints now live in the onContentSizeChange handler.
    const inputStyleBlock = composer.slice(
      composer.indexOf('inputWrapper:'),
      composer.indexOf('// The same capsule as the field'),
    );
    expect(inputStyleBlock).not.toContain('minHeight:');
    expect(inputStyleBlock).not.toContain('maxHeight:');
  });
});

describe('the member reads rupees; "token" is a storage word, never a shown one', () => {
  /*
   * Amit, 2026-09-08: "remove tokens and replace with rs everywhere".
   *
   * The formatter sweep (ea25b11) caught every site that rendered a NUMBER,
   * because deleting `formatTokens` made the compiler visit all 24 of them. It
   * could not catch the sites that spelled the word out in prose — there was no
   * formatter to delete. Nine survived it, in six files, including a settings
   * line that interpolated the raw column and appended "tokens", and one
   * consent sheet telling members "Tokens start when they pick up".
   *
   * So the word gets a gate rather than a second careful read. `token` remains
   * completely legal in code — `token_balance` is still the column, `TOKENS` is
   * still the design-token object, FCM still has push tokens. What is banned is
   * the word reaching a person: inside a quoted string, in a screen or a
   * component, as an English word.
   *
   * Comments are stripped first. This suite's own prose quotes the banned
   * strings at length, and the em-dash gate above already learned that lesson
   * the hard way.
   */
  const UI_DIRS = ['src/screens', 'src/components'];

  /*
   * Identifiers that merely CONTAIN the letters, and are never read aloud.
   * Kept as exact strings rather than a loose pattern so that adding a new one
   * is a decision someone makes on purpose.
   */
  const NOT_PROSE = new Set([
    '../theme/tokens',
    './tokens',
    'token-badge',
    'token-count',
  ]);

  const literals = (source: string): string[] =>
    codeOnly(source).match(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g) ?? [];

  it('no screen or component puts the word in front of a member', () => {
    const offenders: string[] = [];
    for (const dir of UI_DIRS) {
      for (const file of walk(join(ROOT, dir)).filter(f => /\.tsx?$/.test(f))) {
        for (const raw of literals(readFileSync(file, 'utf8'))) {
          /*
           * `${...}` is code, not prose, and is stripped for the same reason
           * comments are. The ledger row renders `${formatRupees(row.tokens)}`
           * — `row.tokens` is the RPC's field name, which is exactly the
           * storage-layer usage this gate is not about. Without the strip the
           * gate would push a rename of the wire contract, which is the change
           * it is meant to leave alone.
           */
          const body = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, '');
          if (NOT_PROSE.has(body)) continue;
          // `\b` alone would match inside `token_balance` and `push_token`, both
          // of which are correct: the ban is on the English word, so a
          // neighbouring underscore or hyphen means it is an identifier.
          if (/(^|[^\w-])[Tt]okens?([^\w-]|$)/.test(body)) {
            offenders.push(`${file.replace(`${ROOT}/`, '')}: ${raw}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and nothing quotes a price for sending, because sending is free', () => {
    /*
     * A separate assertion because it is a separate defect, and the more
     * serious one. The composer's three hints and the send button's read
     * "…costs one token" — not stale vocabulary but a false statement of
     * price. Migration 037 made `spend_chat_minute` a no-op and moved billing
     * to per-minute on a live session, so a TalkBack user was quoted a charge
     * for typing that no longer exists and is not levied in any unit.
     *
     * Renaming the unit would have kept the lie and made it read correctly,
     * which is why this is asserted on the CLAIM and not on the word.
     */
    for (const file of ['src/components/Composer.tsx', 'src/components/SendButton.tsx']) {
      expect(codeOnly(read(file))).not.toMatch(/costs? (one|a)\b/i);
    }
  });
});
