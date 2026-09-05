/**
 * agora-usage-ingest — finance control for media COGS (never pays providers).
 *
 * Modes (POST JSON):
 *   {} | { from_date, to_date }
 *     1. Console /dev/v3/usage → media_vendor_usage_daily (agora_console_api)
 *     2. refresh_media_channel_usage_estimates from paid_sessions
 *     3. Analytics call/lists per call_id (cname) → agora_analytics rows
 *     4. check_media_cogs_variance → media_cogs_recon_alerts
 *
 *   { mode: "invoice", rows: [ { project_id, usage_date, …, cost_paise? } ] }
 *     → import_media_invoice_days (invoice_csv money truth)
 *
 * Auth: service_role Bearer (cron / founder tooling).
 *
 * Docs:
 *   Console usage — https://docs.agora.io/en/video-calling/channel-management-api/agora-console-rest-api
 *   Analytics lists — https://docs.agora.io/en/agora-analytics/reference/agora-analytics-rest-api
 *   Console usage may differ from invoices — prefer invoice_csv for cash COGS.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface UsageDay {
  date: number | string;
  usage: {
    durationAudioAll?: number;
    durationVideoHd?: number;
    durationVideoHdp?: number;
    durationVideo1080P?: number;
    durationVideo2K?: number;
    durationVideo4K?: number;
  };
}

interface AnalyticsCall {
  call_id?: string;
  cname?: string;
  created_ts?: number;
  destroyed_ts?: number;
  finished?: boolean;
  call_acu?: number;
  call_pcu?: number;
}

function basicAuth(id: string, secret: string): string {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDateString(d);
}

function usageDateOf(day: UsageDay): string {
  if (typeof day.date === 'string') {
    return day.date.slice(0, 10);
  }
  const ms = day.date < 1e12 ? day.date * 1000 : day.date;
  return utcDateString(new Date(ms));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serviceRoleOk(request: Request): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const role = JSON.parse(atob(jwt.split('.')[1] ?? '')).role ?? '';
    return role === 'service_role';
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  try {
    return await handle(request);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
});

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }
  if (!serviceRoleOk(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (body.mode === 'invoice') {
    return handleInvoice(admin, body);
  }

  return handleConsoleAndAnalytics(admin, body);
}

async function handleInvoice(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'rows array required' }, { status: 400 });
  }

  const { data, error } = await admin.rpc('import_media_invoice_days', {
    p_rows: rows,
  });
  if (error) {
    console.error(`invoice import failed: ${error.message}`);
    return Response.json({ error: 'invoice import failed', detail: error.message }, { status: 500 });
  }

  const { data: alerts, error: alertErr } = await admin.rpc('check_media_cogs_variance', {});
  if (alertErr) {
    console.error(`variance check after invoice failed: ${alertErr.message}`);
  }

  return Response.json({
    ok: true,
    mode: 'invoice',
    days_upserted: data ?? 0,
    alerts_touched: alerts ?? null,
  });
}

async function handleConsoleAndAnalytics(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const customerId = Deno.env.get('AGORA_CUSTOMER_ID');
  const customerSecret = Deno.env.get('AGORA_CUSTOMER_SECRET');
  const projectId = Deno.env.get('AGORA_PROJECT_ID');
  const appId = Deno.env.get('AGORA_APP_ID');

  if (!customerId || !customerSecret || !projectId) {
    return Response.json(
      {
        error: 'agora console credentials missing',
        hint: 'Set AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AGORA_PROJECT_ID',
      },
      { status: 503 },
    );
  }

  let fromDate = yesterdayUtc();
  let toDate = fromDate;
  if (typeof body.from_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from_date)) {
    fromDate = body.from_date;
  }
  if (typeof body.to_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to_date)) {
    toDate = body.to_date;
  }

  const url =
    `https://api.agora.io/dev/v3/usage?project_id=${encodeURIComponent(projectId)}` +
    `&from_date=${fromDate}&to_date=${toDate}&business=default`;

  const agoraRes = await fetch(url, {
    headers: {
      Authorization: basicAuth(customerId, customerSecret),
      'Content-Type': 'application/json',
    },
  });

  if (!agoraRes.ok) {
    const text = await agoraRes.text();
    console.error(`agora usage fetch failed: ${agoraRes.status} ${text}`);
    return Response.json(
      { error: 'agora usage fetch failed', status: agoraRes.status },
      { status: 502 },
    );
  }

  const payload = (await agoraRes.json()) as { usages?: UsageDay[] };
  const usages = Array.isArray(payload.usages) ? payload.usages : [];

  const upserted: string[] = [];
  for (const day of usages) {
    const usageDate = usageDateOf(day);
    const u = day.usage ?? {};
    const { data, error } = await admin.rpc('upsert_media_vendor_usage_daily', {
      p_backend: 'agora',
      p_project_id: projectId,
      p_usage_date: usageDate,
      p_duration_audio_seconds: u.durationAudioAll ?? 0,
      p_duration_video_hd_seconds: u.durationVideoHd ?? 0,
      p_duration_video_hdp_seconds: u.durationVideoHdp ?? 0,
      p_duration_video_1080p_seconds: u.durationVideo1080P ?? 0,
      p_duration_video_2k_seconds: u.durationVideo2K ?? 0,
      p_duration_video_4k_seconds: u.durationVideo4K ?? 0,
      p_source: 'agora_console_api',
      p_raw: day,
    });
    if (error) {
      console.error(`upsert failed for ${usageDate}: ${error.message}`);
      return Response.json({ error: 'upsert failed', detail: error.message }, { status: 500 });
    }
    upserted.push(String(data));
  }

  const sinceIso = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
  const { data: refreshed, error: refreshErr } = await admin.rpc(
    'refresh_media_channel_usage_estimates',
    { p_since: sinceIso },
  );
  if (refreshErr) {
    console.error(`channel estimate refresh failed: ${refreshErr.message}`);
  }

  let analyticsUpserted = 0;
  let analyticsSkipped = 0;
  let analyticsError: string | null = null;

  if (appId) {
    const analytics = await ingestAnalyticsForWindow(admin, {
      customerId,
      customerSecret,
      appId,
      fromDate,
      toDate,
    });
    analyticsUpserted = analytics.upserted;
    analyticsSkipped = analytics.skipped;
    analyticsError = analytics.error;
  } else {
    analyticsError = 'AGORA_APP_ID missing; skipped Analytics per-call ingest';
    console.warn(analyticsError);
  }

  const { data: alerts, error: alertErr } = await admin.rpc('check_media_cogs_variance', {
    p_since: fromDate,
  });
  if (alertErr) {
    console.error(`variance check failed: ${alertErr.message}`);
  }

  return Response.json({
    ok: true,
    from_date: fromDate,
    to_date: toDate,
    days_upserted: upserted.length,
    channel_estimates_refreshed: refreshed ?? null,
    analytics_channels_upserted: analyticsUpserted,
    analytics_skipped: analyticsSkipped,
    analytics_error: analyticsError,
    alerts_touched: alerts ?? null,
  });
}

/**
 * Per-call Analytics pull (cname = call_id). Rate-limited to ~1 req/s for
 * Standard Analytics plans. Gaps vs product_estimate become recon alerts.
 */
async function ingestAnalyticsForWindow(
  admin: SupabaseClient,
  opts: {
    customerId: string;
    customerSecret: string;
    appId: string;
    fromDate: string;
    toDate: string;
  },
): Promise<{ upserted: number; skipped: number; error: string | null }> {
  const { data: calls, error } = await admin.rpc('list_agora_calls_for_analytics_ingest', {
    p_from: opts.fromDate,
    p_to: opts.toDate,
  });

  if (error) {
    return { upserted: 0, skipped: 0, error: error.message };
  }

  const rows = (calls ?? []) as Array<{
    call_id: string;
    started_at: string;
    ended_at: string;
  }>;

  let upserted = 0;
  let skipped = 0;

  for (const call of rows) {
    const started = Math.floor(new Date(call.started_at).getTime() / 1000) - 120;
    const ended = Math.floor(new Date(call.ended_at).getTime() / 1000) + 120;
    const result = await fetchAndUpsertAnalyticsCall(admin, {
      ...opts,
      callId: call.call_id,
      startTs: started,
      endTs: ended,
    });
    if (result === 'ok') upserted += 1;
    else if (result === 'skip') skipped += 1;
    else return { upserted, skipped, error: result };
    await sleep(1100);
  }

  return { upserted, skipped, error: null };
}

async function fetchAndUpsertAnalyticsCall(
  admin: SupabaseClient,
  opts: {
    customerId: string;
    customerSecret: string;
    appId: string;
    callId: string;
    startTs: number;
    endTs: number;
  },
): Promise<'ok' | 'skip' | string> {
  if (opts.endTs <= opts.startTs) {
    return 'skip';
  }

  const url =
    `https://api.agora.io/beta/analytics/call/lists` +
    `?appid=${encodeURIComponent(opts.appId)}` +
    `&start_ts=${opts.startTs}&end_ts=${opts.endTs}` +
    `&cname=${encodeURIComponent(opts.callId)}` +
    `&page_no=1&page_size=20`;

  const res = await fetch(url, {
    headers: {
      Authorization: basicAuth(opts.customerId, opts.customerSecret),
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    return `analytics unauthorized (${res.status}) — check Analytics plan / keys`;
  }
  if (res.status === 429) {
    await sleep(2000);
    return 'skip';
  }
  if (!res.ok) {
    const text = await res.text();
    console.warn(`analytics ${opts.callId}: ${res.status} ${text}`);
    return 'skip';
  }

  const json = (await res.json()) as {
    code?: number;
    call_lists?: AnalyticsCall[];
  };
  if (typeof json.code === 'number' && json.code !== 0) {
    console.warn(`analytics ${opts.callId}: code ${json.code}`);
    return 'skip';
  }

  const lists = Array.isArray(json.call_lists) ? json.call_lists : [];
  const match =
    lists.find(c => c.cname === opts.callId && c.finished !== false) ?? lists[0];
  if (!match?.created_ts || !match?.destroyed_ts) {
    return 'skip';
  }

  const duration = Math.max(0, match.destroyed_ts - match.created_ts);
  const { error } = await admin.rpc('upsert_media_channel_usage_analytics', {
    p_call_id: opts.callId,
    p_duration_seconds: duration,
    p_participant_acu: match.call_acu ?? 2,
    p_raw: match,
  });
  if (error) {
    return error.message;
  }
  return 'ok';
}
