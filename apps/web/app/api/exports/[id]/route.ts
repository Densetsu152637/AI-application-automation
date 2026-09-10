import { apiError, apiOk, requestId } from '../../../../lib/api.ts';
import { exportError, exportKey } from './lifecycle.ts';
import { exportStorageRoot, readExportArtifact } from '../../../../lib/exports.ts';
import { requireSession } from '../../../../lib/auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  try {
    const key = exportKey((await context.params).id);
    return apiOk(readExportArtifact(exportStorageRoot(), key).metadata, 200, rid);
  } catch (error) { return exportError(error, rid); }
}
