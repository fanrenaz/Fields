CREATE TABLE "room_side_chats" (
  "company_id" varchar(128) NOT NULL,
  "human_member_id" varchar(128) NOT NULL,
  "room_id" varchar(128) NOT NULL,
  "thread_id" varchar(255),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "room_side_chats_pk" PRIMARY KEY ("company_id","human_member_id","room_id"),
  CONSTRAINT "room_side_chats_human_fk" FOREIGN KEY ("company_id","human_member_id")
    REFERENCES "public"."actors"("company_id","id") ON DELETE cascade,
  CONSTRAINT "room_side_chats_room_fk" FOREIGN KEY ("room_id")
    REFERENCES "rooms"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX "room_side_chats_operator_thread_unique"
  ON "room_side_chats" USING btree ("company_id","human_member_id","thread_id");
