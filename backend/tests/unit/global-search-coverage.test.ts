import assert from "node:assert/strict";
import test from "node:test";

import { runGlobalSearch as globalSearch } from "../../src/application/search/global-search.js";
import type { BackendTrpcContext } from "../../src/interface/trpc/core.js";

const rooms = [
  {
    roomId: "room-1",
    name: "One",
    subtitle: null,
    status: "active" as const,
    updatedAtMs: 1,
  },
  {
    roomId: "room-2",
    name: "Two",
    subtitle: null,
    status: "active" as const,
    updatedAtMs: 2,
  },
];

function companyFile(fileId: string, name: string) {
  return {
    file_id: fileId,
    folder_id: null,
    name,
    revision: 1,
    current_version: {
      version_id: `${fileId}-version-1`,
      file_id: fileId,
      version_number: 1,
      blob_sha256: "a".repeat(64),
      size_bytes: 10,
      mime_type: "text/markdown",
      original_name: name,
      created_by_actor_id: "member-1",
      created_at_ms: 1,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
  };
}

function context(overrides: {
  visibleRooms?: typeof rooms;
  members?: Array<{
    actorId: string;
    displayName: string;
    mark: string;
    email: string | null;
    actorType: "human" | "agent";
  }>;
  companyFilesList?: () => Promise<unknown>;
  messageSearch?: () => Promise<unknown>;
  memberExecutorRead?: () => Promise<unknown>;
  assetSearch?: (
    companyId: string,
    query: string,
    limit: number,
    cursor?: string | null,
  ) => Promise<unknown>;
  mailSearch?: (
    authority: {
      companyId: string;
      actorId: string;
      isCompanyOwner: boolean;
    },
    input: {
      search_term: string;
      limit: number;
      include_remote_history: boolean;
    },
  ) => Promise<unknown>;
  homeThreadSearch?: (
    companyId: string,
    memberId: string,
    input: { cursor?: string | null; limit?: number },
  ) => Promise<unknown>;
  homeFilesystemSearch?: (
    companyId: string,
    memberId: string,
    input: { cursor?: string | null; limit?: number },
  ) => Promise<unknown>;
} = {}): BackendTrpcContext {
  return {
    rooms: {
      listRooms: {
        execute: async () => ({
          items: overrides.visibleRooms ?? rooms,
          page: { nextCursor: null },
        }),
      },
    },
    companyActors: {
      listCompanyDirectoryActors: {
        execute: async () => overrides.members ?? [{
          actorId: "member-1",
          displayName: "Member",
          mark: "ME",
          email: "member@example.test",
          actorType: "human" as const,
        }],
      },
    },
    roomMessages: {
      search: overrides.messageSearch ?? (async () => []),
    },
    assets: {
      searchPublished: overrides.assetSearch
        ?? (async () => ({ items: [], page: { next_cursor: null } })),
    },
    companyFiles: {
      list: overrides.companyFilesList
        ?? (async () => ({ folders: [], files: [] })),
    },
    mail: {
      searchMessages: overrides.mailSearch ?? (async () => ({
        items: [],
        next_cursor: null,
        coverage: {
          indexed_from_ms: null,
          includes_remote_results: false,
          partial: false,
          failed_mailbox_ids: [],
        },
      })),
    },
    memberExecutors: {
      read: overrides.memberExecutorRead ?? (async () => ({
        executor: { availability: "available" },
        state: "ready",
      })),
    },
    runtime: {
      homeThreadSearch: overrides.homeThreadSearch
        ?? (async () => ({ items: [], page: { next_cursor: null } })),
      homeFilesystemSearch: overrides.homeFilesystemSearch
        ?? (async () => ({ items: [], page: { next_cursor: null } })),
    },
  } as unknown as BackendTrpcContext;
}

test("kind filtering does not claim Room coverage for member-only search", async () => {
  const result = await globalSearch(context({
    memberExecutorRead: async () => {
      throw new Error("member-only search must not read Home Executor state");
    },
  }), "company-1", "member-1", {
    search_term: "member",
    kind: "member",
  });
  assert.deepEqual(result.groups.map((group) => group.kind), ["member"]);
  assert.equal(result.coverage.visible_room_count, 2);
  assert.equal(result.coverage.searched_room_count, 0);
  assert.deepEqual(result.coverage.failed_sources, []);
});

test("missing active Executor skips Home sources while preserving Company file search", async () => {
  let homeFilesystemSearchCalls = 0;
  const result = await globalSearch(context({
    memberExecutorRead: async () => ({
      executor: { availability: "pending_auth" },
      state: "auth_required",
    }),
    homeFilesystemSearch: async () => {
      homeFilesystemSearchCalls += 1;
      return { items: [], page: { next_cursor: null } };
    },
    companyFilesList: async () => ({
      folders: [],
      files: [companyFile("file-1", "plan.md")],
    }),
  }), "company-1", "member-1", {
    search_term: "plan",
    kind: "file",
  });

  assert.equal(homeFilesystemSearchCalls, 0);
  assert.equal(result.groups[0]?.items.length, 1);
  assert.equal(result.coverage.searched_room_count, 0);
  assert.deepEqual(result.coverage.failed_sources, [{
    target: { kind: "file", source: { type: "home" } },
    code: "UNAVAILABLE",
  }]);
});

test("missing active Executor returns explicit unavailable Home Thread coverage", async () => {
  let homeThreadSearchCalls = 0;
  const result = await globalSearch(context({
    memberExecutorRead: async () => ({
      executor: { availability: "available" },
      state: "failed",
    }),
    homeThreadSearch: async () => {
      homeThreadSearchCalls += 1;
      return { items: [], page: { next_cursor: null } };
    },
  }), "company-1", "member-1", {
    search_term: "thread",
    kind: "home_thread",
  });

  assert.equal(homeThreadSearchCalls, 0);
  assert.deepEqual(result.groups, [{
    kind: "home_thread",
    items: [],
    page: { next_cursor: null },
  }]);
  assert.deepEqual(result.coverage.failed_sources, [{
    target: { kind: "home_thread" },
    code: "UNAVAILABLE",
  }]);
});

test("Company file coverage reports object metadata failure without Room scope", async () => {
  const result = await globalSearch(context({
    companyFilesList: async () => { throw new Error("offline"); },
  }), "company-1", "member-1", {
    search_term: "file",
    kind: "file",
  });
  assert.equal(result.coverage.searched_room_count, 0);
  assert.deepEqual(result.coverage.failed_sources, [{
    target: { kind: "file", source: { type: "company" } },
    code: "UNAVAILABLE",
  }]);
});

test("message source failure clears Room coverage without provider details", async () => {
  const result = await globalSearch(context({
    messageSearch: async () => {
      throw new Error("postgres detail must not escape");
    },
  }), "company-1", "member-1", {
    search_term: "message",
    kind: "message",
  });
  assert.equal(result.coverage.searched_room_count, 0);
  assert.deepEqual(result.coverage.failed_sources, [{
    target: { kind: "message" },
    code: "FAILED",
  }]);
  assert.equal(JSON.stringify(result).includes("postgres"), false);
});

test("shared search query returns all seven authorized result kinds and forwards pagination", async () => {
  let homeCursor: string | null | undefined;
  let homeLimit: number | undefined;
  const result = await globalSearch(context({
    visibleRooms: [{
      ...rooms[0]!,
      name: "needle room",
    }, rooms[1]!],
    members: [{
      actorId: "member-1",
      displayName: "needle member",
      mark: "NM",
      email: "member@example.test",
      actorType: "human",
    }],
    messageSearch: async () => [{
      messageId: "message-1",
      roomId: "room-1",
      roomTitle: "One",
      sequence: 3,
      senderDisplayName: "Member",
      plainText: "needle message",
      createdAtMs: 3,
    }],
    assetSearch: async () => ({
      items: [{
        asset_id: "asset-1",
        kind: "skill",
        name: "needle skill",
        slug: "needle-skill",
        description: "published",
        lifecycle: "published",
        current_version: "1.2.3",
        draft_count: 0,
        validation_status: "valid",
        updated_at_ms: 6,
      }],
      page: { next_cursor: "asset-next" },
    }),
    mailSearch: async () => ({
      items: [{
        message_id: "mail-message-1",
        mailbox_id: "mailbox-1",
        folder_id: "folder-1",
        internet_message_id: "<mail-message-1@example.test>",
        thread_id: "mail-thread-1",
        subject: "needle mail",
        from: [{ name: "Sender", address: "sender@example.test" }],
        to: [{ name: null, address: "member@example.test" }],
        cc: [],
        sent_at_ms: 3,
        received_at_ms: 4,
        flags: [],
        size_bytes: 100,
        attachments: [],
        indexed_at_ms: 5,
      }],
      next_cursor: "mail-next",
      coverage: {
        indexed_from_ms: 1,
        includes_remote_results: false,
        partial: false,
        failed_mailbox_ids: [],
      },
    }),
    homeThreadSearch: async (_companyId, _memberId, input) => {
      homeCursor = input.cursor;
      homeLimit = input.limit;
      return {
        items: [{
          thread_id: "home-thread-1",
          title: "needle home",
          preview: "private",
          created_at_ms: 1,
          updated_at_ms: 2,
          status: "idle",
        }],
        page: { next_cursor: "home-next" },
      };
    },
    homeFilesystemSearch: async () => ({
      items: [{
        id: "home-file-1",
        path: "needle-home.md",
        name: "needle-home.md",
        is_folder: false,
        size_bytes: 10,
        modified_at_ms: 4,
      }],
      page: { next_cursor: null },
    }),
    companyFilesList: async () => ({
      folders: [],
      files: [companyFile("company-file-1", "needle-company.md")],
    }),
  }), "company-1", "member-1", {
    search_term: "needle",
    cursor: "opaque-cursor",
    limit: 7,
  });

  assert.deepEqual(result.groups.map((group) => group.kind), [
    "room",
    "member",
    "asset",
    "email",
    "home_thread",
    "message",
    "file",
  ]);
  assert.deepEqual(result.groups.map((group) => (
    group.items.map((item) => item.kind)
  )), [
    ["room"],
    ["member"],
    ["asset"],
    ["email"],
    ["home_thread"],
    ["message"],
    ["file", "file"],
  ]);
  assert.equal(result.groups[2]?.page.next_cursor, "asset-next");
  assert.equal(result.groups[3]?.page.next_cursor, "mail-next");
  assert.equal(result.groups[4]?.page.next_cursor, "home-next");
  assert.equal(homeCursor, "opaque-cursor");
  assert.equal(homeLimit, 7);
  assert.deepEqual(result.coverage, {
    visible_room_count: 2,
    searched_room_count: 2,
    failed_sources: [],
    email: {
      indexed_from_ms: 1,
      includes_remote_results: false,
      partial: false,
      failed_mailbox_ids: [],
    },
  });
});

test("email-only search forwards a stable ISO UTC date to the indexed mail search", async () => {
  const dateTerm = "2026-07-27T12:34:56.789Z";
  const occurredAtMs = Date.parse(dateTerm);
  let receivedAuthority: unknown;
  let receivedInput: unknown;
  const result = await globalSearch(context({
    mailSearch: async (authority, input) => {
      receivedAuthority = authority;
      receivedInput = input;
      return {
        items: [{
          message_id: "mail-message-date",
          mailbox_id: "mailbox-1",
          folder_id: "folder-1",
          internet_message_id: "<mail-message-date@example.test>",
          thread_id: "mail-thread-date",
          subject: "dated mail",
          from: [{ name: "Sender", address: "sender@example.test" }],
          to: [{ name: null, address: "member@example.test" }],
          cc: [],
          sent_at_ms: occurredAtMs,
          received_at_ms: null,
          flags: [],
          size_bytes: 100,
          attachments: [],
          indexed_at_ms: occurredAtMs,
        }],
        next_cursor: null,
        coverage: {
          indexed_from_ms: occurredAtMs - 1,
          includes_remote_results: false,
          partial: false,
          failed_mailbox_ids: [],
        },
      };
    },
  }), "company-1", "member-1", {
    search_term: dateTerm,
    kind: "email",
    limit: 7,
  }, true);

  assert.deepEqual(receivedAuthority, {
    companyId: "company-1",
    actorId: "member-1",
    isCompanyOwner: true,
  });
  assert.deepEqual(receivedInput, {
    search_term: dateTerm,
    limit: 7,
    include_remote_history: false,
  });
  assert.equal(result.groups[0]?.kind, "email");
  assert.equal(result.groups[0]?.items[0]?.kind, "email");
  assert.equal(result.groups[0]?.items[0]?.occurred_at_ms, occurredAtMs);
});

test("asset search failure is partial coverage and does not fail other groups", async () => {
  const result = await globalSearch(context({
    assetSearch: async () => {
      throw new Error("postgres details must not escape");
    },
  }), "company-1", "member-1", {
    search_term: "needle",
  });

  assert.equal(result.groups.find((group) => group.kind === "asset")?.items.length, 0);
  assert.ok(result.groups.some((group) => group.kind === "room"));
  assert.deepEqual(result.coverage.failed_sources, [{
    target: { kind: "asset" },
    code: "FAILED",
  }]);
  assert.equal(JSON.stringify(result).includes("postgres"), false);
});

test("asset-only search forwards opaque pagination cursor", async () => {
  let receivedCursor: string | null | undefined;
  const result = await globalSearch(context({
    assetSearch: async (_companyId, _query, _limit, cursor) => {
      receivedCursor = cursor;
      return { items: [], page: { next_cursor: "next-assets" } };
    },
  }), "company-1", "member-1", {
    search_term: "needle",
    kind: "asset",
    cursor: "asset-cursor",
  });

  assert.equal(receivedCursor, "asset-cursor");
  assert.deepEqual(result.groups, [{
    kind: "asset",
    items: [],
    page: { next_cursor: "next-assets" },
  }]);
});
