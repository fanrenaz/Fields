import { Composer } from "../conversation/Composer";
import type { UIChatMessage } from "@lobechat/types";
import { Tag } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { useState } from "react";

import { Conversation, type ConversationMessageAction } from "../conversation/Conversation";
import type { RoomController } from "./use-room-machine";
import { ScheduledTaskDrawer } from "../scheduled-tasks";
import { QuestionInteractionCard } from "../conversation/QuestionInteractionCard";
import { roomQuestionInteractionSchema } from "@fields/contracts/public/room";

type RoomPageProps = {
  controller: RoomController;
};

export function RoomPage({ controller: room }: RoomPageProps) {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const activeRoom = room.rooms.items.find((candidate) => candidate.active) ?? null;
  return (
    <div style={{ background: "var(--ant-color-bg-container)", display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      <Conversation
        contentWidth="main"
        context={{ id: room.rooms.items.find((candidate) => candidate.active)?.id ?? "room", surface: "room" }}
        error={room.timeline.error}
        generatingMessageIds={room.timeline.conversationGeneratingMessageIds}
        loading={room.timeline.loading}
        messageActions={roomMessageActions}
        messages={room.timeline.conversationMessages}
        onBranchSwitch={room.timeline.onConversationBranchSwitch}
        onLinkPress={room.timeline.onInlineLink}
        onMessageAction={(action, message) => {
          if (action === "edit") room.timeline.onConversationEdit(message);
          if (action === "delete") room.timeline.onConversationDelete(message);
          if (action === "regenerate") room.timeline.onConversationRegenerate(message);
          if (action === "reply") room.timeline.onReply([roomMessageId(message)]);
        }}
        renderBelowMessage={(message) => (
          <RoomInteractions message={message} room={room} />
        )}
        store={room.timeline.conversationStore}
      />
      <Composer
        contentWidth="main"
        draft={room.composer.draft}
        replyAnchor={room.composer.replyAnchor}
        referenceOptions={room.composer.referenceOptions}
        mentionOptions={room.composer.mentionOptions}
        pendingReferenceInsertion={room.composer.pendingReferenceInsertion}
        onDraft={room.composer.onDraft}
        onClearReply={room.composer.onClearReply}
        onSearch={room.composer.onSearch}
        onReferenceInserted={room.composer.onReferenceInserted}
        onSend={room.composer.onSend}
        onSchedule={() => setSchedulerOpen(true)}
        sendDisabled={room.composer.sendDisabled}
        showMentionButton={room.composer.showMentionButton}
        statusMessage={room.composer.statusMessage}
        error={room.composer.error}
      />
      <ScheduledTaskDrawer
        mode="create"
        onClose={() => setSchedulerOpen(false)}
        onSaved={() => {
          room.composer.onDraft("");
          room.composer.onClearReply();
        }}
        open={schedulerOpen}
        seed={room.composer.roomId ? {
          lockedTarget: true,
          markdown: room.composer.draft,
          references: room.composer.referencesForDraft(room.composer.draft),
          replyToMessageIds: room.composer.replyToMessageIds,
          target: { kind: "room", room_id: room.composer.roomId },
        } : undefined}
        targetOptions={{ rooms: activeRoom ? [{ id: activeRoom.id, title: activeRoom.title }] : [], threads: [] }}
      />
    </div>
  );
}

function roomMessageActions(message: UIChatMessage): readonly ConversationMessageAction[] {
  const self = message.metadata?.fieldsIsSelf === true;
  const deleted = Boolean(message.metadata?.fieldsDeletedAt);
  if (deleted || message.role === "system") return [];
  if (message.role === "user" && self) return ["edit", "reply", "copy", "delete"];
  if (message.role === "assistant" || message.role === "assistantGroup") {
    return ["regenerate", "reply", "copy"];
  }
  return ["reply", "copy"];
}

function RoomInteractions({ message, room }: { message: UIChatMessage; room: RoomController }) {
  const interactions = Array.isArray(message.metadata?.fieldsInteractions)
    ? message.metadata.fieldsInteractions
    : [];
  if (interactions.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {interactions.map((interaction) => {
        const question = roomQuestionInteractionSchema.safeParse(interaction);
        if (question.success) {
          return (
            <QuestionInteractionCard
              interaction={question.data}
              key={question.data.id}
              onRespond={(answers, resolution) => {
                return room.timeline.onRespondToQuestion(
                  roomMessageId(message),
                  question.data.id,
                  answers,
                  resolution,
                );
              }}
              onSnooze={() => room.timeline.onSnoozeInteraction(roomMessageId(message), question.data.id)}
              policy="room"
            />
          );
        }
        if (
          typeof interaction !== "object"
          || interaction === null
          || typeof interaction.id !== "string"
          || typeof interaction.label !== "string"
          || !Array.isArray(interaction.responses)
        ) return null;
        const status = typeof interaction.status === "string" ? interaction.status : "pending";
        return (
          <div key={interaction.id} style={{ alignItems: "center", display: "flex", gap: 6 }}>
            <Tag>{interaction.label}</Tag>
            <Tag>{status}</Tag>
            {interaction.responses.map((response: {
              value?: unknown;
              label?: unknown;
            }) => {
              const value = response?.value;
              if (value !== "approve" && value !== "reject") return null;
              return (
                <Button
                  disabled={status !== "pending"}
                  key={value}
                  onClick={() => room.timeline.onRespondToInteraction(
                    roomMessageId(message),
                    interaction.id,
                    value,
                  )}
                  size="small"
                >
                  {typeof response.label === "string" ? response.label : value}
                </Button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function roomMessageId(message: UIChatMessage): string {
  const value = message.metadata?.fieldsRoomMessageId;
  return typeof value === "string" ? value : message.id.replace(/^room:message:/u, "");
}
