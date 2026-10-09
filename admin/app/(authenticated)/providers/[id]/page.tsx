import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ProviderActions } from './ProviderActions';
import { PhotoRemoveButton } from './PhotoActions';

export const dynamic = 'force-dynamic';

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

interface Profile {
  id: string;
  display_name: string | null;
  role: string;
  provider_category: string | null;
  is_available: boolean;
  presence_online: boolean;
  identity_verified_at: string | null;
  suspended_until: string | null;
  delisted_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  languages: string[] | null;
  headline: string | null;
  about: string | null;
  date_of_birth: string | null;
  created_at: string;
}

interface Photo {
  id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
}

interface Earning {
  status: string;
  provider_tokens: number;
}

interface Batch {
  id: string;
  status: string;
  total_tokens: number;
  total_paise: number;
  initiated_by: string | null;
  created_at: string;
  completed_at: string | null;
}

interface Strike {
  id: string;
  created_at: string;
  expires_at: string;
  voided_at: string | null;
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
    .single<Profile>();

  if (!profile) notFound();

  const [photos, earnings, batches, strikes, panRow, payoutAccount] = await Promise.all([
    svc.from('provider_photos').select('*').eq('provider_id', id).order('is_primary', { ascending: false }).returns<Photo[]>(),
    svc.from('provider_earnings_ledger').select('status, provider_tokens').eq('provider_id', id).returns<Earning[]>(),
    svc.schema('admin').from('payout_history').select('*').eq('provider_id', id).order('created_at', { ascending: false }).limit(10).returns<Batch[]>(),
    svc.from('contact_guard_strikes').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20).returns<Strike[]>(),
    svc.from('provider_tax_profile').select('status, updated_at').eq('provider_id', id).maybeSingle(),
    svc.from('provider_payout_accounts').select('verification_status, is_default').eq('provider_id', id).eq('is_default', true).maybeSingle(),
  ]);

  const allEarnings = earnings.data ?? [];
  const pendingTokens = allEarnings.filter(e => ['pending', 'cleared'].includes(e.status)).reduce((s, e) => s + e.provider_tokens, 0);
  const paidTokens = allEarnings.filter(e => e.status === 'paid').reduce((s, e) => s + e.provider_tokens, 0);

  const isBanned = profile.suspended_until?.startsWith('2999') ?? false;
  const isSuspended = !isBanned && !!profile.suspended_until && new Date(profile.suspended_until) > new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={profile.display_name ?? 'Unknown provider'}
        subtitle={`${profile.provider_category ?? 'No category'} · joined ${fmtDate(profile.created_at)}`}
        breadcrumbs={[{ label: 'Providers', href: '/providers' }, { label: profile.display_name ?? id.slice(0, 8) }]}
      />

      {/* Actions */}
      <Card>
        <CardContent className="px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {isBanned && <Badge variant="destructive">Banned</Badge>}
            {isSuspended && <Badge variant="destructive">Suspended until {fmtDate(profile.suspended_until)}</Badge>}
            {profile.delisted_at && <Badge variant="secondary">Delisted</Badge>}
            {!profile.identity_verified_at && <Badge variant="outline">Unverified</Badge>}
          </div>
          <ProviderActions
            providerId={profile.id}
            suspendedUntil={profile.suspended_until}
            delistedAt={profile.delisted_at}
          />
        </CardContent>
      </Card>

      {/* Profile fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Profile</p>
            <dl className="text-sm space-y-1.5">
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">ID</dt><dd className="font-mono text-xs break-all">{profile.id}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Name</dt><dd>{profile.display_name ?? '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Category</dt><dd>{profile.provider_category ?? '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Languages</dt><dd>{(profile.languages ?? []).join(', ') || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">DOB</dt><dd>{fmtDate(profile.date_of_birth)}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Headline</dt><dd className="line-clamp-2">{profile.headline ?? '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Rating</dt>
                <dd>{profile.rating_avg != null ? `${Number(profile.rating_avg).toFixed(1)} (${profile.rating_count} reviews)` : '—'}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Identity</dt>
                <dd>{profile.identity_verified_at ? `✓ ${fmt(profile.identity_verified_at)}` : '✗ not verified'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Verification & Earnings</p>
            <dl className="text-sm space-y-1.5">
              {/* Never show full PAN or account number — status only */}
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">PAN status</dt>
                <dd>{panRow.data?.status ?? 'not provided'}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Payout acct</dt>
                <dd>{payoutAccount.data?.verification_status ?? 'not provided'}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Pending ₹</dt>
                <dd>₹{pendingTokens.toLocaleString('en-IN')}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Paid ₹</dt>
                <dd>₹{paidTokens.toLocaleString('en-IN')}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Available</dt>
                <dd>{profile.is_available ? 'Yes' : 'No'}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Online</dt>
                <dd>{profile.presence_online ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Photos */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Photos ({(photos.data ?? []).length})
        </p>
        {(photos.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {(photos.data ?? []).map(ph => (
              <div key={ph.id} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.url} alt="" className="w-24 h-24 object-cover rounded-lg border" />
                <span className="text-xs text-muted-foreground text-center">
                  {ph.is_primary ? 'Primary' : ''}
                </span>
                <PhotoRemoveButton photoId={ph.id} providerId={profile.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Contact-guard strikes */}
      {(strikes.data ?? []).length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Contact-guard strikes (recent 20)
          </p>
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Voided</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(strikes.data ?? []).map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-muted-foreground text-sm">{fmt(s.created_at)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtDate(s.expires_at)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{s.voided_at ? fmtDate(s.voided_at) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Payout history */}
      {(batches.data ?? []).length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recent payouts
          </p>
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Initiated by</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(batches.data ?? []).map(b => (
                    <TableRow key={b.id}>
                      <TableCell><Badge variant="outline">{b.status}</Badge></TableCell>
                      <TableCell className="text-sm">{b.total_tokens.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-sm">₹{(b.total_paise / 100).toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.initiated_by ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(b.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
