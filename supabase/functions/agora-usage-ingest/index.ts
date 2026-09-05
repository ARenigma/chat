/**
 * agora-usage-ingest — pull Agora Console project-day usage into
 * media_vendor_usage_daily, then refresh per-call product_estimate COGS.
 *
 * Console REST is reference (not always identical to the invoice). Prefer
 * invoice_csv upserts when finance exports land. Channel name = call_id.
 *
 * Auth: service role Bearer only (cron / founder tooling).
 *
 * Secrets:
 *   AGORA_CUSTOMER_ID / AGORA_CUSTOMER_SECRET — Console REST basic auth
 *   AGORA_PROJECT_ID — Console project id (not App ID)
 *   Optional body: { from_date, to_date } ISO dates; default yesterday UTC.
 *
 * Docs:
 *   https://docs.agora.io/en/video-calling/channel-management-api/agora-console-rest-api
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface UsageDay {
  /** Console returns ISO string; older docs showed unix seconds. */
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
    // "2026-09-04T00:00:00.000Z" or "2026-09-04"
    return day.date.slice(0, 10);
  }
  // Seconds (< 1e12) or milliseconds.
  const ms = day.date < 1e12 ? day.date * 1000 : day.date;
  return utcDateString(new Date(ms));
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
  const customerId = Deno.env.get('AGORA_CUSTOMER_ID');
  const customerSecret = Deno.env.get('AGORA_CUSTOMER_SECRET');
  const projectId = Deno.env.get('AGORA_PROJECT_ID');

  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  let role = '';
  try {
    role = JSON.parse(atob(jwt.split('.')[1] ?? '')).role ?? '';
  } catch {
    role = '';
  }
  // Same gate as send-push: platform verify_jwt proves the signature; we only
  // require the service_role claim so cron/founder tooling can use the legacy
  // JWT or a rotated secret without exact string equality on the env value.
  if (role !== 'service_role') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

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
  try {
    const body = (await request.json()) as {
      from_date?: string;
      to_date?: string;
    };
    if (typeof body.from_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from_date)) {
      fromDate = body.from_date;
    }
    if (typeof body.to_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to_date)) {
      toDate = body.to_date;
    }
  } catch {
    // empty body → yesterday
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

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

  const { data: refreshed, error: refreshErr } = await admin.rpc(
    'refresh_media_channel_usage_estimates',
    { p_since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  );
  if (refreshErr) {
    console.error(`channel estimate refresh failed: ${refreshErr.message}`);
  }

  return Response.json({
    ok: true,
    from_date: fromDate,
    to_date: toDate,
    days_upserted: upserted.length,
    channel_estimates_refreshed: refreshed ?? null,
  });
}