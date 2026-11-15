import assert from "node:assert/strict";
import test from "node:test";
import { pcClientCommand } from "../dist/index.js";

test("browser protocol remains strict while terminal behavior moves to the native runner", () => {
  assert.deepEqual(pcClientCommand.parse({ type: "button.a" }), { type: "button.a" });
  assert.deepEqual(pcClientCommand.parse({ type: "button.b" }), { type: "button.b" });
  assert.deepEqual(pcClientCommand.parse({ type: "answer" }), { type: "answer" });
  assert.deepEqual(pcClientCommand.parse({ type: "playback.complete", stream_id: 7, status: "played" }), {
    type: "playback.complete", stream_id: 7, status: "played",
  });
  assert.throws(() => pcClientCommand.parse({ type: "playback.complete", stream_id: 0, status: "played" }));
});
