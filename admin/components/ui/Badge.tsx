type BadgeStatus =
  | 'active'
  | 'draft'
  | 'superseded'
  | 'scheduled'
  | 'error'
  | 'draft_created'
  | 'promoted_prod'
  | 'published_staging'
  | 'scheduled_publish'
  | 'rollback'
  | 'activation_cron';

interface BadgeProps {
  status: BadgeStatus | string;
  label?: string;
}

export function Badge({ status, label }: BadgeProps) {
  const cls = `badge badge--${status}`;
  return <span className={cls}>{label ?? status}</span>;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  draft: 'Draft',
  superseded: 'Superseded',
  scheduled: 'Scheduled',
  error: 'Error',
  draft_created: 'Draft created',
  promoted_prod: 'Published',
  published_staging: 'Staged',
  scheduled_publish: 'Scheduled',
  rollback: 'Rolled back',
  activation_cron: 'Auto-activated',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge status={status} label={STATUS_LABELS[status] ?? status} />;
}

interface RuntimeBadgeProps {
  status: 'live' | 'partial' | 'seeded';
}

const RUNTIME_LABELS: Record<RuntimeBadgeProps['status'], string> = {
  live: 'Live',
  partial: 'Partial',
  seeded: 'Seeded',
};

export function RuntimeBadge({ status }: RuntimeBadgeProps) {
  return <span className={`runtime-badge runtime-badge--${status}`}>{RUNTIME_LABELS[status]}</span>;
}
