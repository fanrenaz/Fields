#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const frameOutput = fs.createWriteStream(null, { fd: 3, autoClose: false });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendFrame() {
  // 2 x 1 RGB565LE: red, green.
  const frame = Buffer.alloc(24);
  frame.write("S3FR", 0, "ascii");
  frame[4] = 1;
  frame[5] = 1;
  frame.writeUInt16LE(20, 6);
  frame.writeUInt32LE(7, 8);
  frame.writeUInt16LE(2, 12);
  frame.writeUInt16LE(1, 14);
  frame.writeUInt32LE(4, 16);
  frame.writeUInt16LE(0xf800, 20);
  frame.writeUInt16LE(0x07e0, 22);
  frameOutput.write(frame);
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "shutdown") process.exit(0);
  if (command.type !== "activate") return;
  send({
    type: "snapshot",
    controller_state: "connecting",
    terminal_state: "offline",
    terminal_id: "pc-simulator-unpaired",
    pairing: { state: "unpaired", code: null, expires_at_ms: null },
    call: null,
  });
  sendFrame();
});
