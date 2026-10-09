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

// GET /api/queues/refunds — list pending refund reviews
export async function GET() {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('refund_reviews')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST /api/queues/refunds — resolve a refund review
export async function POST(request: NextRequest) {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;
  const actor = (gate as { email: string }).email;

  let body: { reviewId?: string; status?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { reviewId, status, note } = body;
  if (!reviewId || !status) {
    return NextResponse.json({ error: 'reviewId and status required' }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_resolve_refund_review', {
    p_review_id: reviewId,
    p_status: status,
    p_actor: actor,
    p_note: note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
