import { ConfigDomainPreview } from './ConfigDomainPreview';

/** /design/screens/config/domain?domain=economics|recharge|payouts|unknown&state=clean|dirty|invalid|saved|error|publish|loading */
export default async function Page({ searchParams }: { searchParams: Promise<{ domain?: string; state?: string }> }) {
  const { domain, state } = await searchParams;
  return <ConfigDomainPreview domain={domain ?? 'economics'} state={state ?? 'clean'} />;
}
