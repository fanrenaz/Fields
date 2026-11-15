import assert from "node:assert/strict";
import test from "node:test";

import { webPushPayload } from "../../../../src/infrastructure/eventing/web-push-delivery-runner.js";

test("Web Push payload matches the Service Worker navigation shape without message content", () => {
  const home = webPushPayload({ activity_id: "activity_home", kind: "agent.terminal", locale: "en", status: "completed", target_kind: "home", target_id: "thread / one", target_message_id: null });
  assert.equal(home.url, "/app/home/thread%20%2F%20one");
  assert.deepEqual(home.target, { kind: "home", thread_id: "thread / one" });
  assert.equal("body" in home, false);
  assert.equal("preview" in home, false);

  const room = webPushPayload({ activity_id: "activity_room", kind: "room.message", locale: "zh-CN", status: null, target_kind: "room", target_id: "room/one", target_message_id: "message_one" });
  assert.equal(room.url, "/app/rooms/room%2Fone");
  assert.deepEqual(room.target, { kind: "room", room_id: "room/one", message_id: "message_one" });
  assert.equal(room.title, "房间有新动态");
  assert.equal("body" in room, false);
});
