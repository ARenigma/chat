import { NextResponse } from 'next/server';
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

// GET /api/providers — list all providers via admin.providers_list
export async function GET() {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) return gate;

  const svc = createServiceClient();
  const { data, error } = await svc
    .schema('admin')
    .from('providers_list')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ providers: data ?? [] });
}
