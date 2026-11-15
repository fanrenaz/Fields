import type {
  GlobalSearchInput,
  GlobalSearchResult,
} from "@fields/contracts/public/search";

import type {
  ListCompanyDirectoryActorsUseCase,
} from "../actor/queries/company-directory.js";
import type {
  CompanyRuntimePublicGateway,
  MemberExecutorAssignmentApplication,
} from "../execution/ports/index.js";
import {
  MEMBER_EXECUTOR_NOT_FOUND_CODE,
} from "../execution/ports/index.js";
import { ApplicationError } from "../platform/errors.js";
import type {
  ListRoomsUseCase,
} from "../room/queries/list-rooms.js";
import type {
  RoomMessageApplication,
} from "../room/ports/index.js";
import type { CompanyAssetApplication } from "../company/ports/company-assets.js";
import type { CompanyFileApplication } from "../company/ports/company-files.js";
import type { MailApplication } from "../mail/index.js";

export type GlobalSearchDependencies = {
  rooms: {
    listRooms: ListRoomsUseCase;
  };
  companyActors: {
    listCompanyDirectoryActors: ListCompanyDirectoryActorsUseCase;
  };
  memberExecutors: MemberExecutorAssignmentApplication;
  roomMessages: RoomMessageApplication;
  runtime: CompanyRuntimePublicGateway;
  assets: CompanyAssetApplication;
  companyFiles: CompanyFileApplication;
  mail: MailApplication;
};

/**
 * Shared application query for browser and Agent search callers. Authorization
 * is derived from the requesting Member id and the same owner ports in both
 * cases; transports do not widen or duplicate the search policy.
 */
export async function runGlobalSearch(
  dependencies: GlobalSearchDependencies,
  companyId: string,
  memberId: string,
  input: GlobalSearchInput,
  isCompanyOwner = false,
): Promise<GlobalSearchResult> {
  const query = input.search_term.trim();
  const normalized = query.toLocaleLowerCase();
  const limit = input.limit ?? 50;
  const wants = (kind: GlobalSearchResult["groups"][number]["kind"]) => (
    input.kind === undefined || input.kind === kind
  );
  const groups: GlobalSearchResult["groups"] = [];
  const failedSources: GlobalSearchResult["coverage"]["failed_sources"] = [];
  let emailCoverage: GlobalSearchResult["coverage"]["email"] = {
    indexed_from_ms: null,
    includes_remote_results: false,
    partial: false,
    failed_mailbox_ids: [],
  };
  const homeAvailable = wants("home_thread") || wants("file")
    ? await memberHomeAvailable(dependencies, companyId, memberId)
    : false;

  const visibleRooms: Awaited<
    ReturnType<typeof dependencies.rooms.listRooms.execute>
  >["items"][number][] = [];
  let cursor: string | null = null;
  do {
    const page = await dependencies.rooms.listRooms.execute({
      companyId,
      actorId: memberId,
      cursor,
      limit: 50,
      includeArchived: false,
    });
    visibleRooms.push(...page.items);
    cursor = page.page.nextCursor;
  } while (cursor !== null);
  const roomTitle = new Map(visibleRooms.map((room) => [room.roomId, room.name]));

  if (wants("room")) {
    groups.push({
      kind: "room",
      items: visibleRooms
        .filter((room) => `${room.name}\n${room.subtitle ?? ""}`.toLocaleLowerCase().includes(normalized))
        .slice(0, limit)
        .map((room) => ({
          kind: "room" as const,
          room_id: room.roomId,
          title: room.name,
          subtitle: room.subtitle,
          updated_at_ms: room.updatedAtMs,
        })),
      page: { next_cursor: null },
    });
  }

  if (wants("member")) {
    let members: {
      actorId: string;
      displayName: string;
      mark: string;
      email: string | null;
      actorType: "human" | "agent";
    }[] = [];
    try {
      members = [...await dependencies.companyActors.listCompanyDirectoryActors.execute({
        companyId,
        requestedByActorId: memberId,
      })];
    } catch (error) {
      members = [];
      failedSources.push({
        target: { kind: "member" },
        code: searchCoverageFailureCode(error, "FAILED"),
      });
    }
    groups.push({
      kind: "member",
      items: members
        .filter((member) => (
          `${member.displayName}\n${member.mark}\n${member.email ?? ""}`
            .toLocaleLowerCase()
            .includes(normalized)
        ))
        .slice(0, limit)
        .map((member) => ({
          kind: "member" as const,
          actor_id: member.actorId,
          display_name: member.displayName,
          mark: member.mark,
          email: member.email,
          actor_type: member.actorType,
        })),
      page: { next_cursor: null },
    });
  }

  if (wants("asset")) {
    try {
      const result = await dependencies.assets.searchPublished(
        companyId,
        query,
        limit,
        input.cursor,
      );
      groups.push({
        kind: "asset",
        items: result.items.flatMap((asset) => asset.current_version ? [{
          kind: "asset" as const,
          asset_id: asset.asset_id,
          asset_kind: asset.kind,
          name: asset.name,
          slug: asset.slug,
          description: asset.description,
          current_version: asset.current_version,
          updated_at_ms: asset.updated_at_ms,
        }] : []),
        page: { next_cursor: result.page.next_cursor },
      });
    } catch (error) {
      failedSources.push({
        target: { kind: "asset" },
        code: searchCoverageFailureCode(error, "FAILED"),
      });
      groups.push({ kind: "asset", items: [], page: { next_cursor: null } });
    }
  }

  if (wants("email")) {
    try {
      const result = await dependencies.mail.searchMessages({
        companyId,
        actorId: memberId,
        isCompanyOwner,
      }, {
        search_term: query,
        limit,
        include_remote_history: false,
      });
      groups.push({
        kind: "email",
        items: result.items.map((message) => ({
          kind: "email" as const,
          mailbox_id: message.mailbox_id,
          folder_id: message.folder_id,
          message_id: message.message_id,
          subject: message.subject,
          sender_name: message.from[0]?.name ?? null,
          sender_address: message.from[0]?.address ?? null,
          occurred_at_ms: message.received_at_ms ?? message.sent_at_ms,
        })),
        page: { next_cursor: result.next_cursor },
      });
      emailCoverage = {
        indexed_from_ms: result.coverage.indexed_from_ms,
        includes_remote_results: false,
        partial: result.coverage.partial,
        failed_mailbox_ids: result.coverage.failed_mailbox_ids,
      };
      for (const mailboxId of result.coverage.failed_mailbox_ids) {
        failedSources.push({
          target: { kind: "email", mailbox_id: mailboxId },
          code: "UNAVAILABLE",
        });
      }
    } catch (error) {
      emailCoverage = {
        indexed_from_ms: null,
        includes_remote_results: false,
        partial: true,
        failed_mailbox_ids: [],
      };
      failedSources.push({
        target: { kind: "email" },
        code: searchCoverageFailureCode(error, "UNAVAILABLE"),
      });
      groups.push({ kind: "email", items: [], page: { next_cursor: null } });
    }
  }

  if (wants("home_thread")) {
    if (!homeAvailable) {
      failedSources.push({
        target: { kind: "home_thread" },
        code: "UNAVAILABLE",
      });
      groups.push({ kind: "home_thread", items: [], page: { next_cursor: null } });
    } else try {
      const result = await dependencies.runtime.homeThreadSearch(companyId, memberId, {
        search_term: query,
        cursor: input.cursor,
        limit,
      });
      groups.push({
        kind: "home_thread",
        items: result.items.map((thread) => ({ ...thread, kind: "home_thread" as const })),
        page: { next_cursor: result.page.next_cursor },
      });
    } catch (error) {
      failedSources.push({
        target: { kind: "home_thread" },
        code: searchCoverageFailureCode(error, "UNAVAILABLE"),
      });
      groups.push({ kind: "home_thread", items: [], page: { next_cursor: null } });
    }
  }

  const roomScopedRequested = wants("room") || wants("message");
  const roomSearchSuccess = new Set(
    roomScopedRequested ? visibleRooms.map((room) => room.roomId) : [],
  );
  if (wants("message")) {
    try {
      const messages = await dependencies.roomMessages.search({
        companyId,
        requestedByMemberId: memberId,
        query,
        limit,
      });
      groups.push({
        kind: "message",
        items: messages.map((message) => ({
          kind: "message" as const,
          room_id: message.roomId,
          room_title: roomTitle.get(message.roomId) ?? message.roomTitle,
          message_id: message.messageId,
          sequence: message.sequence,
          sender_display_name: message.senderDisplayName,
          body_plain_text: message.plainText,
          occurred_at_ms: message.createdAtMs,
        })),
        page: { next_cursor: null },
      });
    } catch (error) {
      failedSources.push({
        target: { kind: "message" },
        code: searchCoverageFailureCode(error, "FAILED"),
      });
      roomSearchSuccess.clear();
      groups.push({ kind: "message", items: [], page: { next_cursor: null } });
    }
  }

  if (wants("file")) {
    const fileItems: GlobalSearchResult["groups"][number]["items"] = [];
    if (!homeAvailable) {
      failedSources.push({
        target: { kind: "file", source: { type: "home" } },
        code: "UNAVAILABLE",
      });
    } else try {
      const home = await dependencies.runtime.homeFilesystemSearch(companyId, memberId, {
        search_term: query,
        cursor: input.cursor,
        limit,
      });
      fileItems.push(...home.items.map((entry) => ({
        kind: "file" as const,
        source: { type: "home" as const },
        file_id: null,
        path: entry.path,
        name: entry.name,
        is_folder: entry.is_folder,
        modified_at_ms: entry.modified_at_ms,
      })));
    } catch (error) {
      failedSources.push({
        target: { kind: "file", source: { type: "home" } },
        code: searchCoverageFailureCode(error, "UNAVAILABLE"),
      });
    }
    try {
      const result = await dependencies.companyFiles.list(companyId, {
        folder_id: null,
        recursive: false,
        search_term: query,
      });
      fileItems.push(...result.files.map((file) => ({
        kind: "file" as const,
        source: { type: "company" as const },
        file_id: file.file_id,
        path: file.name,
        name: file.name,
        is_folder: false,
        modified_at_ms: file.updated_at_ms,
      })));
      fileItems.push(...result.folders.map((folder) => ({
        kind: "file" as const,
        source: { type: "company" as const },
        file_id: null,
        path: folder.name,
        name: folder.name,
        is_folder: true,
        modified_at_ms: folder.updated_at_ms,
      })));
    } catch (error) {
      failedSources.push({
        target: { kind: "file", source: { type: "company" } },
        code: searchCoverageFailureCode(error, "UNAVAILABLE"),
      });
    }
    groups.push({
      kind: "file",
      items: fileItems.slice(0, limit),
      page: { next_cursor: null },
    });
  }

  return {
    query,
    groups,
    coverage: {
      visible_room_count: visibleRooms.length,
      searched_room_count: roomSearchSuccess.size,
      failed_sources: failedSources,
      email: emailCoverage,
    },
  };
}

async function memberHomeAvailable(
  dependencies: GlobalSearchDependencies,
  companyId: string,
  memberId: string,
): Promise<boolean> {
  try {
    const assignment = await dependencies.memberExecutors.read({
      companyId,
      memberId,
      authority: { kind: "self", requestedByMemberId: memberId },
    });
    return assignment.executor.availability === "available"
      && assignment.state === "ready";
  } catch (error) {
    if (error instanceof ApplicationError && error.code === MEMBER_EXECUTOR_NOT_FOUND_CODE) {
      return false;
    }
    throw error;
  }
}

function searchCoverageFailureCode(
  error: unknown,
  fallback: "FAILED" | "UNAVAILABLE",
): "FAILED" | "UNAVAILABLE" | "FORBIDDEN" | "NOT_FOUND" {
  if (error instanceof ApplicationError) {
    if (/FORBIDDEN|ACCESS_DENIED/u.test(error.code)) return "FORBIDDEN";
    if (/NOT_FOUND/u.test(error.code)) return "NOT_FOUND";
  }
  if (isRecord(error) && typeof error.code === "string") {
    if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") return "FORBIDDEN";
    if (error.code === "NOT_FOUND") return "NOT_FOUND";
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
