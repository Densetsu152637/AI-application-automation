import { apiError, requestId } from '../../../../../lib/api.ts';
import { requireSession } from '../../../../../lib/auth.ts';
import { exportError, exportKey, downloadResponse } from '../lifecycle.ts';
import { exportStorageRoot, readExportArtifact } from '../../../../../lib/exports.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  try {
    const key = exportKey((await context.params).id);
    return downloadResponse(readExportArtifact(exportStorageRoot(), key), rid);
  } catch (error) { return exportError(error, rid); }
}
