ALTER TABLE "room_messages"
ADD COLUMN "image_attachments_json" jsonb NOT NULL DEFAULT '[]'::jsonb;
