'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { ConfigIndexView } from '@/components/config/ConfigIndexView';
import { ConfigIndexSkeleton } from '@/components/config/ConfigSkeletons';
import { indexFixture, indexFixtureEdge } from './fixtures';

export function ConfigIndexPreview({ state }: { state: string }) {
  if (state === 'loading') return <ConfigIndexSkeleton />;
  const domains = state === 'empty' ? [] : state === 'edge' ? indexFixtureEdge() : indexFixture();
  return (
    <div className="mx-auto max-w-[1040px]">
      <PageHeader
        title="App config"
        description="All runtime configuration domains. Changes take effect immediately on publish."
        breadcrumbs={[{ label: 'App config' }]}
      />
      <ConfigIndexView domains={domains} />
    </div>
  );
}
