import { z } from 'zod';
export const uuidSchema = z.uuid();
export const revisionSchema = z.number().int().positive();
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceSchema = z.strictObject({ id: uuidSchema, revision: revisionSchema });
export type Reference = z.infer<typeof referenceSchema>;
export const referenceJsonSchema = z.toJSONSchema(referenceSchema);
