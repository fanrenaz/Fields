import { z } from "zod";

export const messageImageMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const messageImageMetadataSchema = z.strictObject({
  attachment_id: z.string().min(1).max(128),
  kind: z.literal("image"),
  name: z.string().trim().min(1).max(255),
  mime_type: messageImageMimeTypeSchema,
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
});

export function messageImageAttachmentsSchemaFor<
  T extends z.ZodType<{ attachment_id: string; size_bytes: number }>,
>(schema: T) {
  return z.array(schema).max(4).superRefine((attachments, context) => {
    if (attachments.reduce((sum, attachment) => sum + attachment.size_bytes, 0) > 100 * 1024 * 1024) {
      context.addIssue({ code: "custom", message: "Image attachments exceed 100 MiB." });
    }
    const ids = new Set<string>();
    for (const [index, attachment] of attachments.entries()) {
      if (ids.has(attachment.attachment_id)) {
        context.addIssue({
          code: "custom",
          path: [index, "attachment_id"],
          message: "Image attachment ids must be unique.",
        });
      }
      ids.add(attachment.attachment_id);
    }
  });
}
