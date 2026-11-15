import type { ComposerReferenceOption } from "../../../shared/types/composer";
import type { ProfileMember } from "../../../shared/types/member";
import type { RoomMessageReplyTo, TimelineMessage } from "../../../shared/types/timeline";
import type { RoomMachineServices } from "../../../data/room/room-machine-services";
import type { RoomWorkspace } from "../../../features/room/room-machine";

export type { RoomFixtureAgentTurn, RoomWorkspace } from "../../../features/room/room-machine";

export type RoomLeftMode = "context" | "resources" | "memories";
export type RoomOverlay = "search" | null;

export type RoomRecord = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
};

export type RoomPanelItem = {
  id: string;
  title: string;
  description: string;
  meta: string;
  target?: ComposerReferenceOption["target"];
};

const now = Date.UTC(2026, 5, 8, 9, 30);
const prototypeLoadedAt = Date.now();

export const defaultRoomWorkspaces: RoomWorkspace[] = [
  {
    room: {
      id: "room-current",
      title: "Current Room",
      subtitle: "Room workspace",
      status: "Runtime active",
    },
    members: [
      member("member-you", "You", "YU", "Room owner", "Current user", false, "Online"),
      member("agent-planner", "Planner", "PL", "Planning actor", "Scopes work before delegation", true, "Ready"),
      member("agent-builder", "Builder", "BU", "Sandbox actor", "Runs implementation in Room Sandbox", true, "Streaming"),
    ],
    messages: [
      systemMessage("system-joined", now - 1000 * 60 * 22, "Planner and Builder joined the room."),
      message({
        id: "msg-user-brief",
        occurred_at: now - 1000 * 60 * 18,
        sender: "you",
        text: "我们先把 Room 前端工作台打通，左侧看上下文，中间保持协作画布。",
        thread_id: "thread-room-workbench",
      }),
      message({
        id: "msg-planner-plan",
        occurred_at: now - 1000 * 60 * 16,
        sender: "planner",
        text: "我检查完了。可以复用现有 SidePanel tabs，并把 Activity 作为 Room 右栏的一个内容视图。",
        thread_id: "thread-room-workbench",
        reply_to: {
          message_ids: ["msg-user-brief"],
          preview: "Room 前端工作台打通",
        },
        agent_turn: { trigger_message_id: "msg-user-brief", execution_id: "exec-planner-brief", cascade_id: "cascade-planner-brief", status: "completed", started_at_ms: now - 1000 * 60 * 17, completed_at_ms: now - 1000 * 60 * 16, duration_ms: 60_000 },
      }),
      message({
        id: "msg-builder-check",
        occurred_at: now - 1000 * 60 * 10,
        sender: "builder",
        text: "需要确认是否允许我把当前空 RoomPage 替换成 fixture-backed workbench。",
        thread_id: "thread-room-workbench",
        interactions: [{
          id: "interaction-room-page",
          kind: "delegation_check",
          label: "Replace RoomPage",
          status: "pending",
          responses: [
            { value: "approve", label: "Approve replacement" },
            { value: "reject", label: "Reject replacement" },
          ],
        }],
      }),
      message({
        id: "msg-planner-approved",
        occurred_at: now - 1000 * 60 * 7,
        sender: "planner",
        text: "三栏结构已经被接受：LeftSidePanel / FocusStage / RightSidePanel，数据随 Room 切换。",
        thread_id: "thread-room-workbench",
        interactions: [{
          id: "interaction-three-slot",
          kind: "delegation_check",
          label: "Three-slot IA",
          status: "approved",
          responses: [],
        }],
      }),
      message({
        id: "msg-user-activity",
        occurred_at: now - 1000 * 60 * 4,
        sender: "you",
        text: "[@Builder](fields://member/agent-builder) 把 Activity 右栏原型做出来。",
        thread_id: "thread-room-workbench",
      }),
      message({
        id: "msg-builder-quick",
        occurred_at: now - 1000 * 60 * 3,
        sender: "builder",
        text: "收到，我先梳理 Timeline 点击入口和右栏状态。",
        thread_id: "thread-room-workbench",
        reply_to: {
          message_ids: ["msg-user-activity"],
          preview: "@Builder 把 Activity 右栏原型做出来。",
        },
        agent_turn: { trigger_message_id: "msg-user-activity", execution_id: "exec-builder-activity", cascade_id: "cascade-builder-activity", status: "running", started_at_ms: prototypeLoadedAt - 1000 * 60 * 3, completed_at_ms: null, duration_ms: null },
      }),
    ],
    references: [
      { label: "Room brief", target: { type: "resource", id: "room-brief", room_id: "room-current" } },
      { label: "Sandbox boundary", target: { type: "context", room_id: "room-current", tab: "basis" } },
      { label: "Room memory", target: { type: "memory", id: "memory-room-workbench", room_id: "room-current" } },
    ],
    context: [
      item("ctx-basis", "Room boundary", "Room is the collaborative entry point; persisted collaboration stays in Backend and workspace operations use Company Runtime.", "Basis", { type: "context", room_id: "room-current", tab: "basis" }),
      item("ctx-risks", "Desktop risk", "Callbacks already exist in Timeline and Composer, but current Home wiring disables them.", "Risk", { type: "context", room_id: "room-current", tab: "risks" }),
    ],
    resources: [
      item("room-brief", "Room brief", "Working note for the three-slot Room workbench.", "Markdown", { type: "resource", id: "room-brief", room_id: "room-current" }),
      item("resource-wire", "Workbench wireframe", "Fixture-backed workbench reference.", "Image", { type: "resource", id: "resource-wire", room_id: "room-current" }),
    ],
    memories: [
      item("memory-room-workbench", "Room workbench", "Keep the Room workbench focused on collaborative Room behavior.", "Memory", { type: "memory", id: "memory-room-workbench", room_id: "room-current" }),
    ],
    agentTurns: [
      {
        agent_member_id: "agent-planner",
        trigger_message_id: "msg-user-brief",
        message_id: "msg-planner-plan",
        snapshot: {
          turn_id: "turn-planner-panel-review",
          status: "completed",
          started_at_ms: now - 1000 * 60 * 17,
          completed_at_ms: now - 1000 * 60 * 16,
          duration_ms: 60_000,
          error: null,
          narrative_items: [
            {
              type: "assistant_message",
              id: "item-planner-commentary-1",
              status: "completed",
              phase: "commentary",
              content: [{ type: "markdown", markdown: "我先检查现有工作区的左右面板结构，以及 Timeline 当前的消息交互。" }],
            },
            {
              type: "assistant_message",
              id: "item-planner-commentary-2",
              status: "completed",
              phase: "commentary",
              content: [{ type: "markdown", markdown: "右栏可以继续复用现有 Tab 外壳。Activity 只需要成为其中一种内容，不需要新的 surface 或 router。" }],
            },
            {
              type: "assistant_message",
              id: "item-planner-final",
              status: "completed",
              phase: "final_answer",
              content: [{ type: "markdown", markdown: "我检查完了。可以复用现有 SidePanel tabs，并把 Activity 作为 Room 右栏的一个内容视图。" }],
            },
          ],
          activity_items: [
            {
              type: "command",
              id: "item-planner-read-panels",
              status: "completed",
              command: "sed -n '1,680p' features/shell/Shell.tsx && sed -n '360,460p' app/workspace/RootApp.tsx",
              cwd: "/workspace/frontend",
              actions: [
                { type: "read", command: "sed -n '1,680p' features/shell/Shell.tsx", name: "Shell.tsx", path: "/workspace/frontend/features/shell/Shell.tsx" },
                { type: "read", command: "sed -n '360,460p' app/workspace/RootApp.tsx", name: "RootApp.tsx", path: "/workspace/frontend/app/workspace/RootApp.tsx" },
              ],
              output: "LeftSidePanel and RightSidePanel both accept the shared SidePanelTabs slot.",
              exit_code: 0,
              duration_ms: 184,
            },
            { type: "context_compaction", id: "item-planner-compaction", status: "completed" },
          ],
        },
      },
      {
        agent_member_id: "agent-builder",
        trigger_message_id: "msg-user-activity",
        message_id: "msg-builder-quick",
        snapshot: {
          turn_id: "turn-builder-activity-prototype",
          status: "running",
          started_at_ms: prototypeLoadedAt - 1000 * 60 * 3,
          completed_at_ms: null,
          duration_ms: null,
          error: null,
          narrative_items: [
            {
              type: "assistant_message",
              id: "item-builder-commentary-1",
              status: "completed",
              phase: "commentary",
              content: [{ type: "markdown", markdown: "我先梳理 Conversation 的点击入口，以及 Room controller 中右栏选择状态的归属。" }],
            },
            {
              type: "assistant_message",
              id: "item-builder-commentary-2",
              status: "completed",
              phase: "commentary",
              content: [{ type: "markdown", markdown: "点击行为已经可以保持回复选择优先。接下来把 Agent Turn items 交给 Conversation adapter 渲染。" }],
            },
          ],
          activity_items: [
            {
              type: "command",
              id: "item-builder-read-timeline",
              status: "completed",
              command: "sed -n '1,760p' features/conversation/Conversation.tsx && sed -n '1,720p' features/room/use-room-machine.ts",
              cwd: "/workspace/frontend",
              actions: [
                { type: "read", command: "sed -n '1,760p' features/conversation/Conversation.tsx", name: "Conversation.tsx", path: "/workspace/frontend/features/conversation/Conversation.tsx" },
                { type: "read", command: "sed -n '1,720p' features/room/use-room-machine.ts", name: "use-room-machine.ts", path: "/workspace/frontend/features/room/use-room-machine.ts" },
              ],
              output: "Conversation owns message interaction. Room controller owns panel selection and open state.",
              exit_code: 0,
              duration_ms: 221,
            },
            {
              type: "file_change",
              id: "item-builder-file-change",
              status: "completed",
              changes: [
                {
                  path: "features/conversation/fields-conversation-adapter.ts",
                  kind: "update",
                  diff: "- provider protocol event\n+ AgentTurnEvent",
                },
                {
                  path: "features/conversation/Conversation.tsx",
                  kind: "update",
                  diff: "- provider item row\n+ AgentActivityItemRow",
                },
              ],
            },
            {
              type: "command",
              id: "item-builder-typecheck",
              status: "running",
              command: "npm run typecheck",
              cwd: "/workspace/frontend",
              actions: [{ type: "unknown", command: "npm run typecheck" }],
              output: null,
              exit_code: null,
              duration_ms: null,
            },
          ],
        },
      },
    ],
  },
  {
    room: {
      id: "room-design",
      title: "Design Review",
      subtitle: "Product surface",
      status: "Reviewing",
    },
    members: [
      member("member-you", "You", "YU", "Room owner", "Current user", false, "Online"),
      member("agent-critic", "Critic", "CR", "Review actor", "Checks UI clarity", true, "Ready"),
    ],
    messages: [
      systemMessage("system-design", now - 1000 * 60 * 35, "Design Review was created from Current Room."),
      message({
        id: "msg-design-1",
        occurred_at: now - 1000 * 60 * 28,
        sender: "critic",
        text: "The Room workbench should feel like a collaborative room, not an IDE clone.",
        thread_id: "thread-design-review",
      }),
    ],
    references: [
      { label: "Design criteria", target: { type: "resource", id: "design-criteria", room_id: "room-design" } },
    ],
    context: [
      item("ctx-design", "Review lens", "Evaluate information scent, action reversibility, and panel density.", "Context", { type: "context", room_id: "room-design", tab: "basis" }),
    ],
    resources: [
      item("design-criteria", "Design criteria", "Compact notes for Room visual behavior.", "Doc", { type: "resource", id: "design-criteria", room_id: "room-design" }),
    ],
    memories: [
      item("memory-design", "Avoid placeholders", "UI text should be product content or actions.", "Memory", { type: "memory", id: "memory-design", room_id: "room-design" }),
    ],
    agentTurns: [],
  },
  {
    room: {
      id: "room-sandbox",
      title: "Sandbox Build",
      subtitle: "Room runtime",
      status: "Waiting",
    },
    members: [
      member("member-you", "You", "YU", "Room owner", "Current user", false, "Online"),
      member("agent-builder", "Builder", "BU", "Sandbox actor", "Runs implementation in Room Sandbox", true, "Idle"),
    ],
    messages: [
      message({
        id: "msg-sandbox",
        occurred_at: now - 1000 * 60 * 50,
        sender: "builder",
        text: "Sandbox Build is ready for runtime wiring after the fixture-backed UI proves the model.",
        thread_id: "thread-sandbox",
      }),
    ],
    references: [
      { label: "Runtime plan", target: { type: "resource", id: "runtime-plan", room_id: "room-sandbox" } },
    ],
    context: [
      item("ctx-runtime", "Runtime boundary", "Backend owns persisted Room collaboration while Company Runtime owns workspace operations.", "Boundary", { type: "context", room_id: "room-sandbox", tab: "basis" }),
    ],
    resources: [
      item("runtime-plan", "Runtime plan", "Future backend integration notes.", "Doc", { type: "resource", id: "runtime-plan", room_id: "room-sandbox" }),
    ],
    memories: [
      item("memory-runtime", "Runtime split", "Keep message state in Backend and filesystem state behind the Company Runtime proxy.", "Memory", { type: "memory", id: "memory-runtime", room_id: "room-sandbox" }),
    ],
    agentTurns: [],
  },
];

export type RoomFixtureServices = {
  listWorkspaces: () => Promise<RoomWorkspace[]>;
};

export const defaultRoomFixtureServices: RoomFixtureServices = {
  async listWorkspaces() {
    return defaultRoomWorkspaces;
  },
};

export function createRoomPrototypeServices(workspaces: readonly RoomWorkspace[]): RoomMachineServices {
  const workspacesByRoomId = new Map(workspaces.map((workspace) => [workspace.room.id, cloneWorkspace(workspace)]));
  const messageHandlers = new Map<string, Parameters<RoomMachineServices["subscribeMessageEvents"]>[1]>();

  return {
    async listRooms() {
      return {
        items: [...workspacesByRoomId.values()].map((workspace) => ({
          id: workspace.room.id,
          title: workspace.room.title,
          subtitle: workspace.room.subtitle,
          status: workspace.room.status,
        })),
        page: { next_cursor: null },
      };
    },
    subscribeMessageEvents(input, handlers) {
      messageHandlers.set(input.roomId, handlers);
      return { unsubscribe: () => messageHandlers.delete(input.roomId) };
    },
    async getAgentExecution(input) {
      const message = workspacesByRoomId.get(input.roomId)?.messages.find((value) => (
        value.kind === "message" && value.agent_turn?.execution_id === input.executionId
      ));
      if (message?.kind !== "message" || !message.agent_turn) throw new Error(`Execution ${input.executionId} was not found.`);
      return {
        execution_id: input.executionId,
        cascade_id: message.agent_turn.cascade_id,
        room_id: input.roomId,
        agent_member_id: message.sender.id,
        source_message_id: message.agent_turn.trigger_message_id,
        trigger: "mention",
        status: "running",
        started_at_ms: message.occurred_at,
        completed_at_ms: null,
        error: null,
      };
    },
    watchAgentActivity(input, handlers) {
      const workspace = workspacesByRoomId.get(input.roomId);
      const selectedMessage = workspace?.messages.find((value) => (
        value.kind === "message" && value.agent_turn?.execution_id === input.executionId
      ));
      const activity = workspace?.agentTurns.find((value) => (
        value.message_id === selectedMessage?.id
      ));
      if (activity) {
        queueMicrotask(() => handlers.onEvent({
          schema_version: 2,
          event_id: `prototype-agent-turn-${input.executionId}`,
          type: "agent_turn.snapshot",
          source: "backend",
          scope: {
            type: "room",
            room_id: input.roomId,
            agent_member_id: activity.agent_member_id,
            execution_id: input.executionId,
          },
          turn_id: activity.snapshot.turn_id,
          occurred_at_ms: Date.now(),
          snapshot: activity.snapshot,
        }));
      } else {
        queueMicrotask(() => handlers.onError(new Error(`Prototype Agent execution ${input.executionId} was not found.`)));
      }
      return { unsubscribe: () => undefined };
    },
    async readThread(input) {
      const messages = workspacesByRoomId.get(input.roomId)?.messages ?? [];
      return {
        room_id: input.roomId,
        thread_id: input.threadId,
        root_message_id: input.threadId,
        items: messages.filter((value) => (
          value.id === input.threadId || (value.kind === "message" && value.thread_id === input.threadId)
        )),
      };
    },
    async listMembers(input) {
      return {
        room_id: input.roomId,
        items: workspacesByRoomId.get(input.roomId)?.members ?? [],
      };
    },
    async addMember(input) {
      const workspace = workspacesByRoomId.get(input.roomId);
      if (workspace && !workspace.members.some((item) => item.member_id === input.actorId)) {
        workspace.members.push(member(input.actorId, input.actorId, "NM", "Member", "Room member", false, "Ready"));
      }
      return { room_id: input.roomId, items: workspace?.members ?? [] };
    },
    async removeMember(input) {
      const workspace = workspacesByRoomId.get(input.roomId);
      if (workspace) {
        workspace.members = workspace.members.filter((item) => item.member_id !== input.actorId);
      }
      return { room_id: input.roomId, items: workspace?.members ?? [] };
    },
    async listMessages(input) {
      return {
        room_id: input.roomId,
        items: workspacesByRoomId.get(input.roomId)?.messages ?? [],
        page: { next_cursor: null, backwards_cursor: null },
      };
    },
    async sendMessage(input) {
      const created = message({
        id: input.clientMessageId,
        occurred_at: Date.now(),
        sender: "you",
        text: input.markdown,
        thread_id: "thread-room-workbench",
        ...(input.replyToMessageIds?.length
          ? { reply_to: { message_ids: input.replyToMessageIds, preview: "" } }
          : {}),
      });
      const workspace = workspacesByRoomId.get(input.roomId);
      workspace?.messages.push(created);
      messageHandlers.get(input.roomId)?.onEvent({
        schema_version: 1,
        event_id: `prototype-event-${created.id}`,
        type: "room.message.created",
        source: "backend",
        room_id: input.roomId,
        occurred_at_ms: created.occurred_at,
        message: created,
      });
      return { submitted: true, room_id: input.roomId, message: created };
    },
    async respondToInteraction(input) {
      const workspace = workspacesByRoomId.get(input.roomId);
      const existing = workspace?.messages.find((item) => item.id === input.messageId);
      if (!existing || existing.kind !== "message") {
        throw new Error(`Prototype message ${input.messageId} was not found.`);
      }
      const updated: typeof existing = {
        ...existing,
        interactions: (existing.interactions ?? []).map((interaction) => (
          interaction.id === input.interactionId
            ? interaction.kind === "delegation_check" && typeof input.response === "string"
              ? { ...interaction, status: input.response === "approve" ? "approved" : "rejected" }
              : interaction.kind === "request_user_input" && typeof input.response !== "string"
                ? { ...interaction, status: "completed" as const, resolution: input.response.resolution }
                : interaction
            : interaction
        )),
      };
      if (workspace) {
        workspace.messages = workspace.messages.map((item) => item.id === updated.id ? updated : item);
      }
      return { room_id: input.roomId, message: updated };
    },
  };
}

export const defaultRoomPrototypeServices = createRoomPrototypeServices(defaultRoomWorkspaces);

function cloneWorkspace(workspace: RoomWorkspace): RoomWorkspace {
  return {
    ...workspace,
    members: workspace.members.map((item) => ({ ...item })),
    messages: workspace.messages.map((item) => ({ ...item })),
    references: [...workspace.references],
    context: [...workspace.context],
    resources: [...workspace.resources],
    memories: [...workspace.memories],
    agentTurns: workspace.agentTurns.map((activity) => ({
      ...activity,
      snapshot: {
        ...activity.snapshot,
        narrative_items: activity.snapshot.narrative_items.map((item) => ({ ...item })),
        activity_items: activity.snapshot.activity_items.map((item) => ({ ...item })),
      },
    })),
  };
}

function member(
  id: string,
  name: string,
  mark: string,
  role: string,
  meta: string,
  agent: boolean,
  status: string,
): ProfileMember {
  return {
    member_id: id,
    name,
    mark,
    role,
    meta,
    actor_type: agent ? "agent" : "human",
    joined_at_ms: now,
    membership_version: 1,
    agent,
    status,
    boundary: agent ? "Room-scoped" : "Human participant",
  };
}

function item(
  id: string,
  title: string,
  description: string,
  meta: string,
  target: ComposerReferenceOption["target"],
): RoomPanelItem {
  return { id, title, description, meta, target };
}

function systemMessage(id: string, occurred_at: number, text: string): TimelineMessage {
  return {
    id,
    kind: "system",
    occurred_at,
    body: {
      format: "inline_markdown",
      markdown: text,
      plain_text: text,
    },
  };
}

function message(input: {
  id: string;
  occurred_at: number;
  sender: "you" | "planner" | "builder" | "critic";
  text: string;
  thread_id: string;
  reply_to?: RoomMessageReplyTo;
  interactions?: Extract<TimelineMessage, { kind: "message" }>["interactions"];
  generation?: Extract<TimelineMessage, { kind: "message" }>["generation"];
  agent_turn?: Extract<TimelineMessage, { kind: "message" }>["agent_turn"];
}): TimelineMessage {
  return {
    id: input.id,
    kind: "message",
    occurred_at: input.occurred_at,
    sender: sender(input.sender),
    body: {
      format: "inline_markdown",
      markdown: input.text,
      plain_text: input.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    },
    reply_to: input.reply_to ?? null,
    interactions: input.interactions ?? [],
    thread_id: input.thread_id,
    ...(input.agent_turn ? { agent_turn: input.agent_turn } : {}),
    ...(input.generation ? { generation: input.generation } : {}),
  };
}

function sender(key: "you" | "planner" | "builder" | "critic") {
  if (key === "you") {
    return { type: "human" as const, id: "member-you", display_name: "You", mark: "YU", avatar_resource_id: null };
  }
  if (key === "planner") {
    return { type: "agent" as const, id: "agent-planner", display_name: "Planner", mark: "PL", avatar_resource_id: null };
  }
  if (key === "critic") {
    return { type: "agent" as const, id: "agent-critic", display_name: "Critic", mark: "CR", avatar_resource_id: null };
  }
  return { type: "agent" as const, id: "agent-builder", display_name: "Builder", mark: "BU", avatar_resource_id: null };
}
