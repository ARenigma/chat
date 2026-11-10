import { ConfigIndexPreview } from './ConfigIndexPreview';

/** /design/screens/config?state=populated|edge|empty|loading */
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  return <ConfigIndexPreview state={state ?? 'populated'} />;
}
