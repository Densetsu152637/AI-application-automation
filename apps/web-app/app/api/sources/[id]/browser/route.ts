import { z } from 'zod';
import { appDb } from '../../../../../lib/server.ts';
import { apiError, apiOk, requireMutationOrigin } from '../../../../../lib/api.ts';
import { browserSessionStatus, closeSession, openUserSession, withUserPage, type BrowserSource } from '../../../../../lib/browser-sessions.ts';
import { validateResolvedEgressUrl } from '@aaa/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open') }), z.object({ action: z.literal('finish') }),
  z.object({ action: z.literal('navigate'), url: z.url().max(4000) }),
  z.object({ action: z.literal('click'), x: z.number().min(0).max(1279), y: z.number().min(0).max(799) }),
  z.object({ action: z.literal('type'), text: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlOrMeta+A', 'Space']) }),
  z.object({ action: z.literal('scroll'), delta: z.number().min(-1600).max(1600) }),
  z.object({ action: z.literal('back') }),
]);
function sourceById(id: string): BrowserSource | undefined {
  const db = appDb();
  try { return db.prepare('SELECT id,start_url,allowed_origins_json FROM source_configurations WHERE id=?').get(id) as BrowserSource | undefined; }
  finally { db.close(); }
}
function browserError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BROWSER_SESSION_BUSY') return apiError(code, 409);
  if (code === 'BROWSER_SESSION_NOT_OPEN') return apiError(code, 404);
  if (code === 'SOURCE_URL_BLOCKED') return apiError(code, 422);
  if (code === 'BROWSER_SHUTTING_DOWN') return apiError(code, 503);
  return apiError('BROWSER_ACTION_FAILED', 503, undefined, { message: 'The browser could not complete this action. Check the source URL and browser installation, then retry.' });
}
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!sourceById(id)) return apiError('NOT_FOUND', 404);
  if (new URL(request.url).searchParams.get('frame') !== '1') return apiOk(browserSessionStatus(id));
  try {
    return await withUserPage(id, async page => {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 75, timeout: 5000 });
      return apiOk({ image: screenshot.toString('base64'), url: page.url(), width: 1280, height: 800 });
    }, false);
  } catch (error) { return browserError(error); }
}
export async function POST(request: Request, context: Context) {
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403);
  const { id } = await context.params;
  const source = sourceById(id);
  if (!source) return apiError('NOT_FOUND', 404);
  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError('INVALID_REQUEST', 422);
  const action = input.data;
  try {
    if (action.action === 'open') await openUserSession(source);
    else if (action.action === 'finish') await closeSession(id);
    else await withUserPage(id, async page => {
      switch (action.action) {
        case 'navigate': {
          const url = new URL(action.url);
          if (url.username || url.password || !(await validateResolvedEgressUrl(url.href, JSON.parse(source.allowed_origins_json))).allowed) throw new Error('SOURCE_URL_BLOCKED');
          await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 }); break;
        }
        case 'click': await page.mouse.click(action.x, action.y); break;
        case 'type': await page.keyboard.insertText(action.text); break;
        case 'key': await page.keyboard.press(action.key); break;
        case 'scroll': await page.mouse.wheel(0, action.delta); break;
        case 'back': await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }); break;
      }
    });
    return apiOk(browserSessionStatus(id));
  } catch (error) { return browserError(error); }
}
