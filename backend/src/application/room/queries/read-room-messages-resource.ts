import type {
  CompanyRuntimeRoomMessagesReadInput,
  CompanyRuntimeRoomMessagesReadResult,
} from "@fields/contracts/internal/company-runtime";

import type {
  GetCompanyDirectoryActorUseCase,
} from "../../actor/queries/index.js";
import { ApplicationError } from "../../platform/errors.js";
import type {
  PersistedRoomMessage,
  RoomMessageApplication,
} from "../ports/index.js";

export const ROOM_MESSAGES_RESOURCE_ACCESS_DENIED_CODE =
  "ROOM_MESSAGES_RESOURCE_ACCESS_DENIED";

export type ReadRoomMessagesResourceDependencies = {
  companyActors: {
    getCompanyDirectoryActor: GetCompanyDirectoryActorUseCase;
  };
  roomMessages: RoomMessageApplication;
};

/**
 * Reads a Room conversation projection for an Agent MCP Resource. Both the
 * active Agent identity and active Room membership are revalidated on every
 * call by the Actor and Room owners respectively.
 */
export async function readRoomMessagesResource(
  dependencies: ReadRoomMessagesResourceDependencies,
  input: CompanyRuntimeRoomMessagesReadInput,
): Promise<CompanyRuntimeRoomMessagesReadResult> {
  const actor = await dependencies.companyActors.getCompanyDirectoryActor.execute({
    companyId: input.company_id,
    requestedByActorId: input.member_id,
    actorId: input.member_id,
  });
  const permitted = input.access_mode === "agent_execution"
    ? actor.actorType === "agent"
    : actor.actorType === "human";
  if (!permitted) {
    throw new ApplicationError(ROOM_MESSAGES_RESOURCE_ACCESS_DENIED_CODE, false);
  }

  const messages = input.resource.kind === "around"
    ? await dependencies.roomMessages.context({
      roomId: input.room_id,
      companyId: input.company_id,
      requestedByMemberId: input.member_id,
      messageId: input.resource.message_id,
      limit: 21,
    })
    : await dependencies.roomMessages.list({
      roomId: input.room_id,
      companyId: input.company_id,
      requestedByMemberId: input.member_id,
      beforeSequence: input.resource.kind === "before"
        ? input.resource.sequence
        : null,
      limit: 50,
    });

  const uri = resourceUri(input.resource);
  return {
    uri,
    mime_type: "text/markdown",
    text: renderConversation(messages, nextPageUri(input.resource.kind, messages)),
  };
}

function resourceUri(
  resource: CompanyRuntimeRoomMessagesReadInput["resource"],
): string {
  if (resource.kind === "latest") return "fields://room/messages/latest";
  if (resource.kind === "before") {
    return `fields://room/messages/before/${resource.sequence}`;
  }
  return `fields://room/messages/around/${encodeURIComponent(resource.message_id)}`;
}

function nextPageUri(
  kind: CompanyRuntimeRoomMessagesReadInput["resource"]["kind"],
  messages: readonly PersistedRoomMessage[],
): string | null {
  if ((kind !== "latest" && kind !== "before") || messages.length < 50) {
    return null;
  }
  const first = messages[0];
  return first
    ? `fields://room/messages/before/${first.sequence}`
    : null;
}

function renderConversation(
  messages: readonly PersistedRoomMessage[],
  nextPage: string | null,
): string {
  const senderByMessageId = new Map(
    messages.map((message) => [message.messageId, message.senderDisplayName]),
  );
  const records = messages.map((message) => {
    const replyTarget = message.replyToMessageIds
      .map((messageId) => senderByMessageId.get(messageId))
      .find((sender): sender is string => sender !== undefined);
    const heading = replyTarget
      ? `${message.senderDisplayName} (replying to ${replyTarget}):`
      : message.replyToMessageIds.length > 0
        ? `${message.senderDisplayName} (replying to an earlier message):`
        : `${message.senderDisplayName}:`;
    return `${heading}\n${message.markdown}`;
  });
  if (nextPage) {
    records.push(`Next page: ${nextPage}`);
  }
  return records.join("\n\n");
}
