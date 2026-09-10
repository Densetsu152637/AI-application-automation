import { z } from 'zod';
export const uuidSchema = z.uuid();
export const revisionSchema = z.number().int().positive();
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceSchema = z.strictObject({ id: uuidSchema, revision: revisionSchema });
export type Reference = z.infer<typeof referenceSchema>;
export const referenceJsonSchema = z.toJSONSchema(referenceSchema);

export const criterionSchema = z.strictObject({
  field: z.enum(['title', 'arrangement', 'category', 'location', 'salary', 'keywords']),
  value: z.string().trim().min(1).max(500),
  strength: z.enum(['required', 'preferred']),
});
export const searchSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(false),
  criteria: z.array(criterionSchema).min(1).max(50),
});
export type SearchInput = z.infer<typeof searchSchema>;
export const sourceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), startUrl: z.url(), allowedOrigins: z.array(z.url()).min(1).max(20),
  enabled: z.boolean().default(false), supportStatus: z.enum(['unverified', 'fixture_verified', 'user_verified', 'known_restriction']).default('unverified'), supportNote: z.string().max(500).nullable().default(null),
}).superRefine((value, ctx) => { const urls = [value.startUrl, ...value.allowedOrigins].map(item => new URL(item)); if (urls.some(url => !['http:', 'https:'].includes(url.protocol))) ctx.addIssue({ code: 'custom', path: ['startUrl'], message: 'only HTTP(S) origins are supported' }); const start = urls[0]; if (start && !value.allowedOrigins.some(origin => new URL(origin).origin === start.origin)) ctx.addIssue({ code: 'custom', path: ['allowedOrigins'], message: 'startUrl origin must be allowed' }); });
export const settingsPatchSchema = z.strictObject({
  llm: z.strictObject({
    baseUrl: z.url().optional(), modelId: z.string().trim().min(1).max(200).optional(),
    timeoutSeconds: z.number().int().min(10).max(600).optional(),
    contextTokens: z.number().int().min(4096).max(32768).optional(),
    outputTokens: z.number().int().min(256).max(16384).optional(),
  }).optional(),
  timezone: z.string().min(1).max(100).optional(),
  timezoneConfirmed: z.boolean().optional(),
});
export const factValueSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), value: z.string().max(10000) }),
  z.strictObject({ type: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({ type: z.literal('date'), value: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/), precision: z.enum(['year', 'month', 'day']) }),
  z.strictObject({ type: z.literal('text_list'), value: z.array(z.string().max(500)).max(200) }),
  z.strictObject({ type: z.literal('number'), value: z.number().finite(), unit: z.string().max(50) }),
]);
export const factSchema = z.strictObject({ key: z.string().trim().min(1).max(200), value: factValueSchema, sensitive: z.boolean().default(false), provenance: z.array(referenceSchema).max(100).default([]) });
export const profilePatchSchema = z.strictObject({ narrativeInstructions: z.string().max(10000).nullable().optional(), defaultResumeRef: referenceSchema.nullable().optional(), alternativeResumeRefs: z.array(referenceSchema).max(10).optional() });
export const applicationAnswerSchema = z.strictObject({ fieldKey: z.string().trim().min(1).max(200), value: z.union([z.string().max(10000), z.boolean(), z.array(z.string().max(1000)), z.null()]), sourceFactRefs: z.array(referenceSchema).max(20) });
export const applicationCreateSchema = z.strictObject({ listingId: uuidSchema });
export const applicationAnswersPatchSchema = z.strictObject({ answers: z.array(applicationAnswerSchema).max(500) });
export const profileQuestionSchema = z.strictObject({ question: z.string().trim().min(1).max(2000) });
export type ProfileQuestionInput = z.infer<typeof profileQuestionSchema>;

export const apiSchemaVersion = 1 as const;
export const requestIdSchema = z.uuid();
export const errorDetailSchema = z.strictObject({
  code: z.string().min(1), message: z.string().min(1), retryable: z.boolean(),
  entityId: z.uuid().nullable(), details: z.array(z.strictObject({ field: z.string().nullable(), reason: z.string() })),
});
export const apiSuccessSchema = <T extends z.ZodType>(data: T) => z.strictObject({ schemaVersion: z.literal(apiSchemaVersion), data, requestId: requestIdSchema });
export const apiErrorSchema = z.strictObject({ schemaVersion: z.literal(apiSchemaVersion), error: errorDetailSchema, requestId: requestIdSchema });
export type ApiErrorDetail = z.infer<typeof errorDetailSchema>;
export * from './browser.ts';
