import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { ProviderActions } from './ProviderActions';
import type {
  ContactStrike,
  PayoutBatch,
  ProviderDetail,
  ProviderNav,
  ProviderPhoto,
  ProviderProfile,
} from '../model';

export const dynamic = 'force-dynamic';

interface Earning {
  status: string;
  provider_tokens: number;
}

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const svc = createServiceClient();

  const { data: profile } = await svc
    .from('profiles')
    .select('*')
    .eq('id', id)
    .eq('role', 'provider')
    .single<ProviderProfile>();

  if (!profile) notFound();

  const [photos, earnings, batches, strikes, panRow, payoutAccount, order] = await Promise.all([
    svc.from('provider_photos').select('*').eq('provider_id', id).order('is_primary', { ascending: false }).returns<ProviderPhoto[]>(),
    svc.from('provider_earnings_ledger').select('status, provider_tokens').eq('provider_id', id).returns<Earning[]>(),
    svc.schema('admin').from('payout_history').select('*').eq('provider_id', id).order('created_at', { ascending: false }).limit(10).returns<PayoutBatch[]>(),
    svc.from('contact_guard_strikes').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20).returns<ContactStrike[]>(),
    svc.from('provider_tax_profile').select('status, updated_at').eq('provider_id', id).maybeSingle(),
    svc.from('provider_payout_accounts').select('verification_status, is_default').eq('provider_id', id).eq('is_default', true).maybeSingle(),
    // Same ordering as the list, so prev/next walk the list the admin came from.
    svc.schema('admin').from('providers_list').select('id').order('created_at', { ascending: false }).returns<{ id: string }[]>(),
  ]);

  const allEarnings = earnings.data ?? [];
  const pendingTokens = allEarnings.filter(e => ['pending', 'cleared'].includes(e.status)).reduce((s, e) => s + e.provider_tokens, 0);
  const paidTokens = allEarnings.filter(e => e.status === 'paid').reduce((s, e) => s + e.provider_tokens, 0);

  let nav: ProviderNav | null = null;
  const ids = order.data?.map(r => r.id) ?? [];
  const at = ids.indexOf(id);
  if (at >= 0) {
    nav = { position: at + 1, total: ids.length, prevId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null };
  }

  const data: ProviderDetail = {
    profile,
    photos: photos.data ?? [],
    batches: batches.data ?? [],
    strikes: strikes.data ?? [],
    panStatus: panRow.data?.status ?? null,
    payoutAccountStatus: payoutAccount.data?.verification_status ?? null,
    pendingTokens,
    paidTokens,
    now: new Date().toISOString(),
  };

  return <ProviderActions data={data} nav={nav} />;
}
