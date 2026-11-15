import assert from "node:assert/strict";
import test from "node:test";

import { notificationMarkReadInput } from "../../../mobile/mobile-pure-adapters";

test("notification read adapter preserves the authoritative opaque cursor", () => {
  assert.deepEqual(notificationMarkReadInput({ kind: "home", id: "thread-1", through: "opaque/a+b==" }), {
    target: { kind: "home", thread_id: "thread-1" },
    through: "opaque/a+b==",
  });
  assert.deepEqual(notificationMarkReadInput({ kind: "room", id: "room-1", through: "opaque-room" }), {
    target: { kind: "room", room_id: "room-1" },
    through: "opaque-room",
  });
});
