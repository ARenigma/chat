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

// GET /api/queues/contact-guard — list the contact_guard_review_queue
export async function GET() {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('contact_guard_review_queue')
    .select('*')
    .order('review_requested_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST /api/queues/contact-guard — resolve a review item
export async function POST(request: NextRequest) {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;
  const actor = (gate as { email: string }).email;

  let body: { userId?: string; action?: string; days?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { userId, action, days, note } = body;
  if (!userId || !action) {
    return NextResponse.json({ error: 'userId and action required' }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('contact_guard_resolve_review', {
    p_user_id: userId,
    p_action: action,
    p_days: days ?? null,
    p_actor: actor,
    p_note: note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
