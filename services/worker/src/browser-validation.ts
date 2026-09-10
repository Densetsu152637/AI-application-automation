import { validateBrowserAction, type BrowserActionValidationContext } from '@aaa/contracts';

/** Single worker-side gate for any future browser dispatch; callers must check before invoking Playwright. */
export function validateWorkerBrowserAction(input: unknown, context: BrowserActionValidationContext) {
  return validateBrowserAction(input, context);
}
