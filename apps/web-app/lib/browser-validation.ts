import { validateBrowserAction, type BrowserActionValidationContext } from '@aaa/contracts';

/** Single backend gate for any future browser dispatch; callers must check before invoking Playwright. */
export function validateWorkerBrowserAction(input: unknown, context: BrowserActionValidationContext) {
  return validateBrowserAction(input, context);
}
