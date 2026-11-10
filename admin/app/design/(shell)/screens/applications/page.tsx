import { ApplicationsPreview } from './Preview';

export default async function ApplicationsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; open?: string }>;
}) {
  const { state = 'populated', open } = await searchParams;
  return <ApplicationsPreview state={state} open={open === '1'} />;
}
