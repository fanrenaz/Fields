import assert from "node:assert/strict";
import test from "node:test";

import { desktopNotificationEventSchema, desktopNotificationEventsInputSchema } from "../dist/public/desktop-notification.js";

test("Desktop notification contracts are strict and provider-neutral", () => {
  assert.equal(desktopNotificationEventsInputSchema.safeParse({}).success, true);
  assert.equal(desktopNotificationEventsInputSchema.safeParse({ room_id: "room_1" }).success, false);
  assert.equal(desktopNotificationEventSchema.safeParse({ schema_version: 1, event_id: "event_1", occurred_at_ms: 1, type: "room.message", room_id: "room_1", room_name: "Product", message_id: "message_1", sender_name: "Alice", preview: "Hello" }).success, true);
  assert.equal(desktopNotificationEventSchema.safeParse({ schema_version: 1, event_id: "event_2", occurred_at_ms: 2, type: "agent.terminal", status: "completed", target: { kind: "home", thread_id: "thread_1", title: "Home" }, preview: "Done" }).success, true);
  assert.equal(desktopNotificationEventSchema.safeParse({ schema_version: 1, event_id: "event_3", occurred_at_ms: 3, type: "agent.terminal", status: "completed", target: { kind: "home", thread_id: "thread_1", title: "Home" }, preview: null, provider: "codex" }).success, false);
});
