import { ModerationPreview } from './Preview';

export default async function ModerationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; open?: string }>;
}) {
  const { state = 'populated', open } = await searchParams;
  return <ModerationPreview state={state} open={open === '1'} />;
}
