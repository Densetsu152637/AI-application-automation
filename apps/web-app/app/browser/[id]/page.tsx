import BrowserView from './view';
export default async function BrowserPage({ params }: { params: Promise<{ id: string }> }) {
  return <BrowserView sourceId={(await params).id} />;
}
