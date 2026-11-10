import {
  ArrowUp,
  ArrowDown,
  Timer as CycleIcon,
  DotsThree,
  Link as LinkIcon,
  Star,
  UserCircle,
  Gauge,
} from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, Property, PropertyGroup } from '@/components/ui/property';
import { StatusIcon } from '@/components/ui/status-icon';
import { Kbd } from '@/components/ui/kbd';
import { HeaderActions } from '@/components/layout/shell-context';
import { APPLICATION } from '../../fixtures';

/** Linear issue-detail pattern: title + description + activity on the left, properties on the right. */
export default function DesignDetailPage() {
  const a = APPLICATION;
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        <span className="mr-1 text-xs text-tertiary tabular-nums">1 / 37</span>
        <Button variant="ghost" size="icon-xs" aria-label="Previous"><ArrowUp /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Next"><ArrowDown /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Copy link"><LinkIcon /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="More"><DotsThree weight="bold" /></Button>
      </HeaderActions>

      <div className="mx-auto grid max-w-[1040px] gap-10 px-(--page-pad) py-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-primary">{a.title}</h1>
          <p className="mt-3 text-base leading-[26px] text-body">
            {a.summary}{' '}
            <code className="rounded-xs border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[12px] text-primary">{a.code}</code>{' '}
            before the profile is listed.
          </p>

          <h2 className="mt-10 mb-4 text-md font-semibold tracking-[-0.01em] text-primary">Activity</h2>
          <ol className="flex flex-col gap-3.5">
            {a.activity.map((item) =>
              item.kind === 'event' ? (
                <li key={item.id} className="flex items-center gap-2.5 text-sm text-secondary">
                  <Avatar name={item.actor} size={18} />
                  <span>
                    <span className="text-body">{item.actor}</span> {item.text} <span className="text-tertiary">· {item.at}</span>
                  </span>
                </li>
              ) : (
                <li key={item.id} className="rounded-lg border border-hairline bg-raised">
                  <div className="px-4 py-3.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Avatar name={item.actor} size={20} />
                      <span className="font-medium text-primary">{item.actor}</span>
                      <span className="text-tertiary">· {item.at}</span>
                    </div>
                    <p className="mt-2 text-base text-body">{item.text}</p>
                  </div>
                  {item.reply && (
                    <div className="border-t border-hairline px-4 py-3.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Avatar name={item.reply.actor} size={20} />
                        <span className="font-medium text-primary">{item.reply.actor}</span>
                        <span className="text-tertiary">· {item.reply.at}</span>
                      </div>
                      <p className="mt-2 text-base text-body">{item.reply.text}</p>
                    </div>
                  )}
                </li>
              )
            )}
          </ol>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-hairline bg-raised px-3.5 py-2.5 text-sm text-tertiary">
            Leave a comment…
            <span className="ml-auto flex gap-1"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          </div>
        </article>

        <aside className="flex flex-col gap-6">
          <PropertyGroup title="Properties">
            <Property icon={<StatusIcon state="progress" tone="warning" />}>Under review</Property>
            <Property icon={<Gauge size={16} />}>{a.priority}</Property>
            <Property icon={<Avatar name={a.assignee} size={16} />}>{a.assignee}</Property>
            <Property icon={<CycleIcon size={16} />}>{a.cycle}</Property>
            <Property icon={<UserCircle size={16} />} hint={a.submitted}>Submitted</Property>
          </PropertyGroup>
          <PropertyGroup title="Labels">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {a.labels.map((l) => (
                <Badge key={l.name} dot={l.tone} className="h-6 px-2.5 text-sm">{l.name}</Badge>
              ))}
            </div>
          </PropertyGroup>
          <PropertyGroup title="Reviews">
            <Property icon={<Star size={16} />}>Identity check</Property>
          </PropertyGroup>
        </aside>
      </div>
    </div>
  );
}
