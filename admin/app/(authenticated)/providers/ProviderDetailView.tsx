'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Bank,
  Broadcast,
  Cake,
  CalendarBlank,
  CaretDown,
  Hourglass,
  IdentificationCard,
  Prohibit,
  SealCheck,
  Star,
  Tag,
  Translate,
  Wallet,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { useShellCrumbs, HeaderActions } from '@/components/layout/shell-context';
import { Badge, StatusBadge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, Property, PropertyGroup } from '@/components/ui/property';
import { StatusIcon } from '@/components/ui/status-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { rupeesFromTokens } from '@/lib/money';
import { PhotoRemoveButton } from './[id]/PhotoActions';
import {
  STATUS_META,
  fmtDate,
  fmtDateTime,
  providerStatus,
  shortId,
  type ProviderAction,
  type ProviderDetail,
  type ProviderNav,
} from './model';

interface ActionItem {
  action: ProviderAction;
  label: string;
  danger?: boolean;
}

/** The admin actions available for this provider's current state (unchanged rules). */
function actionsFor(p: ProviderDetail['profile'], now: Date): ActionItem[] {
  const banned = p.suspended_until?.startsWith('2999') ?? false;
  const suspended = !banned && !!p.suspended_until && new Date(p.suspended_until) > now;
  const items: ActionItem[] = [];
  items.push(suspended || banned ? { action: 'lift', label: 'Lift suspension' } : { action: 'suspend', label: 'Suspend' });
  items.push(p.delisted_at ? { action: 'relist', label: 'Relist' } : { action: 'delist', label: 'Delist' });
  if (!banned) items.push({ action: 'ban', label: 'Ban', danger: true });
  return items;
}

const PAYOUT_TONE: Record<string, Tone> = {
  completed: 'success',
  paid: 'success',
  success: 'success',
  failed: 'danger',
  error: 'danger',
  pending: 'warning',
  processing: 'info',
  initiated: 'info',
};

interface ActivityItem {
  id: string;
  at: string;
  kind: 'event' | 'card';
  actor: string;
  node: React.ReactNode;
}

function buildActivity(d: ProviderDetail): ActivityItem[] {
  const name = d.profile.display_name ?? 'Provider';
  const items: ActivityItem[] = [
    { id: 'joined', at: d.profile.created_at, kind: 'event', actor: name, node: 'joined Pappal' },
  ];
  if (d.profile.identity_verified_at) {
    items.push({ id: 'identity', at: d.profile.identity_verified_at, kind: 'event', actor: 'System', node: 'verified the identity' });
  }
  for (const ph of d.photos) {
    items.push({ id: `photo-${ph.id}`, at: ph.created_at, kind: 'event', actor: name, node: ph.is_primary ? 'added a primary photo' : 'added a photo' });
  }
  for (const s of d.strikes) {
    items.push({
      id: `strike-${s.id}`,
      at: s.created_at,
      kind: 'event',
      actor: 'Contact guard',
      node: <>recorded a strike <span className="text-tertiary">(expires {fmtDate(s.expires_at)})</span></>,
    });
    if (s.voided_at) {
      items.push({ id: `void-${s.id}`, at: s.voided_at, kind: 'event', actor: 'Admin', node: 'voided a strike' });
    }
  }
  for (const b of d.batches) {
    items.push({
      id: `batch-${b.id}`,
      at: b.created_at,
      kind: 'card',
      actor: b.initiated_by ?? 'System',
      node: (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base text-body">
          <span>Payout batch</span>
          <StatusBadge status={b.status} tone={PAYOUT_TONE[b.status.toLowerCase()]} />
          <span className="font-medium text-primary tabular-nums">₹{(b.total_paise / 100).toLocaleString('en-IN')}</span>
          <span className="text-sm text-tertiary tabular-nums">{b.total_tokens.toLocaleString('en-IN')} tokens</span>
        </div>
      ),
    });
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// A button that looks like a Property row (Property itself is a plain div).
const PICKER =
  '-mx-2 flex h-7 w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 text-left text-sm text-body transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover';

interface Props {
  data: ProviderDetail;
  nav: ProviderNav | null;
  /** Called when an admin action is chosen. The container opens the confirm dialog and does the POST. */
  onAction?: (a: ProviderAction) => void;
}

/** Linear issue-detail: title, bio, photos and activity on the left; properties on the right. */
export function ProviderDetailView({ data, nav, onAction }: Props) {
  const { profile: p } = data;
  const now = React.useMemo(() => new Date(data.now), [data.now]);
  const name = p.display_name ?? 'Unknown provider';
  useShellCrumbs([{ label: 'Providers', href: '/providers' }, { label: p.display_name ?? shortId(p.id) }]);

  const status = providerStatus({ ...p, identity_verified: !!p.identity_verified_at }, now);
  const meta = STATUS_META[status];
  const banned = p.suspended_until?.startsWith('2999') ?? false;
  const suspended = !banned && !!p.suspended_until && new Date(p.suspended_until) > now;
  const actions = actionsFor(p, now);
  const activeStrikes = data.strikes.filter((s) => !s.voided_at && new Date(s.expires_at) > now).length;
  const activity = React.useMemo(() => buildActivity(data), [data]);
  const languages = p.languages ?? [];

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        {nav && (
          <>
            <span className="mr-1 text-xs text-tertiary tabular-nums">{nav.position} / {nav.total}</span>
            {nav.prevId ? (
              <Button asChild variant="ghost" size="icon-xs">
                <Link href={`/providers/${nav.prevId}`} aria-label="Previous provider"><ArrowUp /></Link>
              </Button>
            ) : (
              <Button variant="ghost" size="icon-xs" disabled aria-label="Previous provider"><ArrowUp /></Button>
            )}
            {nav.nextId ? (
              <Button asChild variant="ghost" size="icon-xs">
                <Link href={`/providers/${nav.nextId}`} aria-label="Next provider"><ArrowDown /></Link>
              </Button>
            ) : (
              <Button variant="ghost" size="icon-xs" disabled aria-label="Next provider"><ArrowDown /></Button>
            )}
          </>
        )}
        <span className="ml-1 hidden items-center gap-1.5 md:flex">
          {actions.map((a) => (
            <Button key={a.action} size="sm" variant={a.danger ? 'danger' : 'secondary'} onClick={() => onAction?.(a.action)}>
              {a.label}
            </Button>
          ))}
        </span>
      </HeaderActions>

      <div className="mx-auto grid max-w-[1040px] gap-10 px-(--page-pad) py-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-primary">{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-secondary">
            <code className="rounded-xs border border-hairline bg-raised px-1.5 py-0.5 font-mono text-xs break-all text-primary">{p.id}</code>
            <span>{p.provider_category ?? 'No category'}</span>
          </p>

          <div className="mt-4 space-y-3 text-base leading-[26px]">
            {p.headline && <p className="text-body">{p.headline}</p>}
            {p.about && <p className="whitespace-pre-line text-secondary">{p.about}</p>}
            {!p.headline && !p.about && <p className="text-tertiary">No bio yet.</p>}
          </div>

          <h2 className="mt-10 mb-4 text-md font-semibold tracking-[-0.01em] text-primary">
            Photos <span className="font-normal text-tertiary tabular-nums">{data.photos.length}</span>
          </h2>
          {data.photos.length === 0 ? (
            <p className="text-sm text-tertiary">No photos.</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {data.photos.map((ph) => (
                <li key={ph.id} className="flex w-24 flex-col gap-1.5">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ph.url} alt={`${name}${ph.is_primary ? ', primary photo' : ''}`} className="size-24 rounded-md border border-hairline bg-raised object-cover" />
                    {ph.is_primary && (
                      <Badge variant="secondary" className="absolute bottom-1 left-1 h-4 px-1.5 text-2xs">Primary</Badge>
                    )}
                  </div>
                  <PhotoRemoveButton photoId={ph.id} providerId={p.id} />
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-10 mb-4 text-md font-semibold tracking-[-0.01em] text-primary">Activity</h2>
          <ol className="flex flex-col gap-3.5">
            {activity.map((item) =>
              item.kind === 'event' ? (
                <li key={item.id} className="flex items-center gap-2.5 text-sm text-secondary">
                  <Avatar name={item.actor} size={18} />
                  <span className="min-w-0">
                    <span className="text-body">{item.actor}</span> {item.node} <span className="text-tertiary">· {fmtDateTime(item.at)}</span>
                  </span>
                </li>
              ) : (
                <li key={item.id} className="rounded-lg border border-hairline bg-raised px-4 py-3.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Avatar name={item.actor} size={20} />
                    <span className="font-medium text-primary">{item.actor}</span>
                    <span className="text-tertiary">· {fmtDateTime(item.at)}</span>
                  </div>
                  {item.node}
                </li>
              )
            )}
          </ol>
        </article>

        <aside className="flex flex-col gap-6">
          <PropertyGroup title="Properties">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={PICKER} aria-label={`Status: ${meta.label}. Change status`}>
                  <span className="flex size-4 items-center justify-center"><StatusIcon state={meta.state} tone={meta.tone} /></span>
                  <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                  <CaretDown size={10} aria-hidden="true" className="text-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuLabel>Change status</DropdownMenuLabel>
                {actions.map((a, i) => (
                  <React.Fragment key={a.action}>
                    {a.danger && i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem variant={a.danger ? 'destructive' : 'default'} onSelect={() => onAction?.(a.action)}>
                      {a.label}…
                    </DropdownMenuItem>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {banned && <Property icon={<Prohibit size={16} className="text-danger" />}>Banned</Property>}
            {suspended && <Property icon={<Warning size={16} className="text-warning" />}>Suspended until {fmtDate(p.suspended_until)}</Property>}
            {p.delisted_at && <Property icon={<Prohibit size={16} />} hint={fmtDate(p.delisted_at)}>Delisted</Property>}
            <Property icon={<Tag size={16} />}>{p.provider_category ?? <span className="text-tertiary">No category</span>}</Property>
            <Property icon={<Star size={16} />}>
              {p.rating_avg != null ? `${Number(p.rating_avg).toFixed(1)} (${p.rating_count} reviews)` : <span className="text-tertiary">No ratings</span>}
            </Property>
            <Property icon={<Broadcast size={16} />}>
              {p.presence_online ? 'Online now' : p.is_available ? 'Available' : 'Not available'}
            </Property>
            <Property icon={<SealCheck size={16} className={p.identity_verified_at ? 'text-success' : undefined} />} hint={p.identity_verified_at ? fmtDate(p.identity_verified_at) : undefined}>
              {p.identity_verified_at ? 'Identity verified' : <span className="text-warning">Not verified</span>}
            </Property>
            <Property icon={<Warning size={16} className={activeStrikes > 0 ? 'text-danger' : undefined} />}>
              {activeStrikes > 0 ? `${activeStrikes} active strike${activeStrikes === 1 ? '' : 's'}` : 'No active strikes'}
            </Property>
          </PropertyGroup>

          <PropertyGroup title="Payouts">
            {/* Status only: the full PAN and account number are never shown. */}
            <Property icon={<IdentificationCard size={16} />} hint="PAN">{data.panStatus ?? 'Not provided'}</Property>
            <Property icon={<Bank size={16} />} hint="Account">{data.payoutAccountStatus ?? 'Not provided'}</Property>
            <Property icon={<Hourglass size={16} />} hint="Pending"><span className="tabular-nums">{rupeesFromTokens(data.pendingTokens)}</span></Property>
            <Property icon={<Wallet size={16} />} hint="Paid"><span className="tabular-nums">{rupeesFromTokens(data.paidTokens)}</span></Property>
          </PropertyGroup>

          <PropertyGroup title="Languages">
            {languages.length === 0 ? (
              <Property icon={<Translate size={16} />}><span className="text-tertiary">None listed</span></Property>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {languages.map((l) => (
                  <Badge key={l} className="h-6 px-2.5 text-sm">{l}</Badge>
                ))}
              </div>
            )}
          </PropertyGroup>

          <PropertyGroup title="Profile">
            <Property icon={<Cake size={16} />} hint="Born">{fmtDate(p.date_of_birth)}</Property>
            <Property icon={<CalendarBlank size={16} />} hint="Joined">{fmtDate(p.created_at)}</Property>
          </PropertyGroup>

          {/* Phones: header buttons are hidden below md, so the picker above is the entry point. */}
          <div className="md:hidden">
            <PropertyGroup title="Actions">
              {actions.map((a) => (
                <Button key={a.action} size="sm" variant={a.danger ? 'danger' : 'secondary'} className="mb-1.5 w-full" onClick={() => onAction?.(a.action)}>
                  {a.label}
                </Button>
              ))}
            </PropertyGroup>
          </div>
        </aside>
      </div>
    </div>
  );
}
