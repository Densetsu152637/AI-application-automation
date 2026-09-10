import { apiError, requestId } from '../../../../../lib/api.ts';
import { requireSession } from '../../../../../lib/auth.ts';
import { exportError, exportKey, enqueueExportRetry, ifMatch } from '../lifecycle.ts';
import { exportStorageRoot, readExportArtifact } from '../../../../../lib/exports.ts';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  try {
    const key = exportKey((await context.params).id);
    readExportArtifact(exportStorageRoot(), key);
    return enqueueExportRetry(request, key, ifMatch(request));
  } catch (error) { return exportError(error, rid); }
}
