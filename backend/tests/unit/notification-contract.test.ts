import assert from "node:assert/strict";
import test from "node:test";

import { pushSubscriptionListResultSchema, pushSubscriptionSchema } from "@fields/contracts/public/notification";
import { homeThreadSummarySchema } from "@fields/contracts/public/home";
import { roomSummarySchema } from "@fields/contracts/public/room";

test("public push subscription results cannot expose endpoint or encryption keys", () => {
  const persisted = { subscription_id: "push_one", endpoint: "https://push.example/secret", keys: { p256dh: "secret", auth: "secret" }, expiration_time_ms: null, created_at_ms: 1, updated_at_ms: 2 };
  const item = pushSubscriptionSchema.parse(persisted);
  assert.deepEqual(item, { subscription_id: "push_one", expiration_time_ms: null, created_at_ms: 1, updated_at_ms: 2 });
  assert.deepEqual(pushSubscriptionListResultSchema.parse({ items: [persisted] }), { items: [item] });
});

test("Home and Room summaries expose nullable opaque read-through cursors", () => {
  const home = homeThreadSummarySchema.parse({ thread_id: "thread_one", title: "One", preview: null, created_at_ms: 1, updated_at_ms: 2, status: "idle", unread_count: 3, read_through: "NDI" });
  assert.equal(home.read_through, "NDI");
  assert.equal(home.unread_count, 3);

  const room = roomSummarySchema.parse({ room_id: "room_one", name: "Room", subtitle: null, status: "active", updated_at_ms: 2, unread_count: 1, read_through: null });
  assert.equal(room.read_through, null);
  assert.equal(room.unread_count, 1);
});
