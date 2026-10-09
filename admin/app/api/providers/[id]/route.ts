import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { founderAllowlistRow } from '@/lib/auth/founder';

async function requireFounder(): Promise<{ email: string } | NextResponse> {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await founderAllowlistRow(user);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return { email: allowed.email };
}

// GET /api/providers/[id] — provider detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const svc = createServiceClient();

  const [profile, photos, earnings, batches, strikes] = await Promise.all([
    svc.from('profiles').select('*').eq('id', id).single(),
    svc.from('provider_photos').select('*').eq('provider_id', id).order('is_primary', { ascending: false }),
    svc.from('provider_earnings_ledger').select('status, tokens_earned').eq('provider_id', id),
    svc.schema('admin').from('payout_history').select('*').eq('provider_id', id).order('created_at', { ascending: false }).limit(10),
    svc.from('contact_guard_strikes').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
  ]);

  if (profile.error || !profile.data) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  // Mask PAN and payout account: fetch status only (never expose full PAN or account number)
  const { data: panRow } = await svc
    .from('provider_tax_profile')
    .select('status, updated_at')
    .eq('provider_id', id)
    .maybeSingle();

  const { data: payoutAccount } = await svc
    .from('provider_payout_accounts')
    .select('verification_status, updated_at, is_default')
    .eq('provider_id', id)
    .eq('is_default', true)
    .maybeSingle();

  return NextResponse.json({
    profile: profile.data,
    photos: photos.data ?? [],
    earnings: earnings.data ?? [],
    recentBatches: batches.data ?? [],
    strikes: strikes.data ?? [],
    panStatus: panRow?.status ?? null,
    payoutAccountStatus: payoutAccount?.verification_status ?? null,
  });
}

// POST /api/providers/[id] — provider actions
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;
  const actor = (gate as { email: string }).email;

  const { id } = await params;
  let body: { action?: string; days?: number; reason?: string; photoId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, days, reason = '', photoId } = body;
  const svc = createServiceClient();

  switch (action) {
    case 'suspend': {
      if (!days || days <= 0) {
        return NextResponse.json({ error: 'days must be > 0' }, { status: 400 });
      }
      const { data, error } = await svc.rpc('admin_suspend_provider', {
        p_provider_id: id, p_days: days, p_reason: reason, p_actor: actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    case 'lift': {
      const { data, error } = await svc.rpc('admin_lift_suspension', {
        p_provider_id: id, p_reason: reason, p_actor: actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    case 'ban': {
      const { data, error } = await svc.rpc('admin_ban_provider', {
        p_provider_id: id, p_reason: reason, p_actor: actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    case 'delist': {
      const { data, error } = await svc.rpc('admin_delist_provider', {
        p_provider_id: id, p_reason: reason, p_actor: actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    case 'relist': {
      const { data, error } = await svc.rpc('admin_relist_provider', {
        p_provider_id: id, p_reason: reason, p_actor: actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    case 'remove_photo': {
      if (!photoId) return NextResponse.json({ error: 'photoId required' }, { status: 400 });
      const { data, error } = await svc.rpc('admin_remove_provider_photo', {
        p_photo_id: photoId, p_actor: actor, p_reason: reason,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action ?? ''}` }, { status: 400 });
  }
}
