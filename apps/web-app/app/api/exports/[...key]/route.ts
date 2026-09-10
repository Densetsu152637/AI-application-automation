import { NextResponse } from 'next/server';
import { ArtifactStorageError } from '@aaa/adapters/artifacts';
import { requireSession } from '../../../../lib/auth.ts';
import { exportContentDisposition, exportStorageRoot, readExportArtifact } from '../../../../lib/exports.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof ArtifactStorageError) {
    const status = error.code === 'ARTIFACT_MISSING' ? 404 : error.code === 'ARTIFACT_EXPIRED' ? 410 : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
  return NextResponse.json({ error: 'EXPORT_UNAVAILABLE' }, { status: 404 });
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  try {
    const { key } = await context.params;
    const artifact = readExportArtifact(exportStorageRoot(), key.join('/'));
    if (new URL(request.url).searchParams.get('metadata') === '1') {
      return NextResponse.json(artifact.metadata, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return new NextResponse(new Uint8Array(artifact.bytes), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': artifact.metadata.mediaType,
        'Content-Length': String(artifact.metadata.sizeBytes),
        'Content-Security-Policy': "default-src 'none'",
        'Content-Disposition': exportContentDisposition(artifact.metadata.fileName),
        'X-Content-SHA256': artifact.metadata.sha256,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
