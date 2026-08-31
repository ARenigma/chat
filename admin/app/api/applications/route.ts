import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/applications
// Body: { action: 'claim' | 'admit' | 'needinfo' | 'decline', userId: string, note?: string, fields?: string[] }
export async function POST(request: NextRequest) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: allowed } = await svc
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { action?: string; userId?: string; note?: string; fields?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, userId, note = null, fields } = body;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  switch (action) {
    case 'claim': {
      const { error } = await svc.rpc('claim_provider_application_review', {
        p_user_id: userId,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    case 'admit': {
      const { error } = await svc.rpc('approve_provider_application', {
        p_user_id: userId,
        p_note: note,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    case 'needinfo': {
      if (!fields || fields.length === 0) {
        return NextResponse.json({ error: 'fields is required for needinfo' }, { status: 400 });
      }
      const { error } = await svc.rpc('request_application_info', {
        p_user_id: userId,
        p_missing: fields,
        p_note: note,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    case 'decline': {
      const { error } = await svc.rpc('reject_provider_application', {
        p_user_id: userId,
        p_note: note,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action "${action ?? ''}". Expected: claim | admit | needinfo | decline` },
        { status: 400 },
      );
  }
}
