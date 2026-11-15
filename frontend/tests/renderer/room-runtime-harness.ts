import { createActor } from "xstate";

import { roomMachine } from "../../features/room/room-machine";
import type { RoomMachineServices } from "../../data/room/room-machine-services";

const post = async <T>(path: string, body: object): Promise<T> => request<T>(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const services: RoomMachineServices = {
  listRooms: () => request("/api/rooms"),
  subscribeMessageEvents({ roomId }) {
    void post("/api/data/messages/subscribe", { room_id: roomId });
    return { unsubscribe: () => void post("/api/data/messages/unsubscribe", { room_id: roomId }) };
  },
  getAgentExecution: ({ roomId, executionId }) => post("/api/data/agent-execution", { room_id: roomId, execution_id: executionId }),
  watchAgentActivity() {
    return { unsubscribe: () => undefined };
  },
  readThread: ({ roomId, threadId }) => post("/api/data/thread", { room_id: roomId, thread_id: threadId }),
  listMembers: ({ roomId }) => post("/api/data/members", { room_id: roomId }),
  addMember: ({ roomId, actorId }) => post("/api/data/members/add", { room_id: roomId, actor_id: actorId }),
  removeMember: ({ roomId, actorId }) => post("/api/data/members/remove", { room_id: roomId, actor_id: actorId }),
  listMessages: ({ roomId }) => post("/api/data/messages", { room_id: roomId }),
  sendMessage: (input) => post("/api/data/messages/send", input),
  respondToInteraction: (input) => post("/api/data/interactions/respond", input),
};

const actor = createActor(roomMachine, { input: { services } }).start();
const rootElement = document.querySelector<HTMLElement>("#root");
if (!rootElement) throw new Error("Missing browser smoke root.");
const root: HTMLElement = rootElement;

function render(): void {
  const context = actor.getSnapshot().context;
  root.dataset.activeRoom = context.activeRoomId ?? "";
  root.dataset.phase = context.activeRoomId ? "selected" : "idle";
  root.dataset.dataReady = String(context.activeRoomId !== null);
  root.innerHTML = `
    <button id="room-a">Room A</button>
    <button id="room-b">Room B</button>
    <button id="retry">Retry messages</button>
    <output id="phase">${context.activeRoomId ? "selected" : "idle"}</output>
  `;
  document.querySelector("#room-a")?.addEventListener("click", () => actor.send({ type: "ROOM_SELECTED", roomId: "room-a" }));
  document.querySelector("#room-b")?.addEventListener("click", () => actor.send({ type: "ROOM_SELECTED", roomId: "room-b" }));
  document.querySelector("#retry")?.addEventListener("click", () => actor.send({ type: "ROOMS_REFRESH_REQUESTED" }));
}

actor.subscribe(render);
render();

Object.assign(window, {
  roomRuntimeSmoke: {
    snapshot: () => ({ ...root.dataset }),
    select: (roomId: string) => actor.send({ type: "ROOM_SELECTED", roomId }),
    retry: () => actor.send({ type: "ROOMS_REFRESH_REQUESTED" }),
    stop: () => actor.stop(),
  },
});

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return response.json() as Promise<T>;
}
