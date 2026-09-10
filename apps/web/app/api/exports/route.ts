import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth.ts';
import { exportStorageRoot, listExportMetadata } from '../../../lib/exports.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  return NextResponse.json(listExportMetadata(exportStorageRoot()), { headers: { 'Cache-Control': 'private, no-store' } });
}
