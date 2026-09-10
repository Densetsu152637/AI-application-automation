import { NextResponse } from 'next/server';
import { ArtifactStorageError, readArtifact } from '@aaa/adapters/artifacts';
import { requireSession } from '../../../../../lib/auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const artifact = readArtifact(process.env.OUTPUT_ROOT ?? process.env.ARTIFACT_ROOT ?? '/output', `artifacts/${id}`);
    return new NextResponse(new Uint8Array(artifact.bytes), { status: 200, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/octet-stream', 'Content-Length': String(artifact.sizeBytes), 'Content-Security-Policy': "default-src 'none'", 'X-Content-SHA256': artifact.sha256 } });
  } catch (error) {
    const status = error instanceof ArtifactStorageError && error.code === 'ARTIFACT_INTEGRITY_ERROR' ? 500 : 404;
    return NextResponse.json({ error: status === 500 ? 'ARTIFACT_INTEGRITY_ERROR' : 'ARTIFACT_MISSING' }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
