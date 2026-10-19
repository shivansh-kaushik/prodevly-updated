import { z } from 'zod';
import { MEDIA_PURPOSES } from '@/lib/media/rules';

/**
 * The text fields of an upload (the file itself is checked from its bytes, not here).
 * `for` names the purpose: website content is public, the money purposes are private.
 */
export const uploadFieldsSchema = z.object({
  for: z.enum(MEDIA_PURPOSES, { error: 'Say what the file is for' }),
  alt: z
    .string()
    .trim()
    .max(300, { error: 'Keep the description to 300 characters' })
    .optional()
    .transform((v) => v || undefined),
  /** Optional. When sent it must agree with `for` (content is public, money files are private). */
  visibility: z.enum(['public', 'private']).optional(),
});

export type UploadFields = z.infer<typeof uploadFieldsSchema>;

export const mediaListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});
