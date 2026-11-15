import type { UIChatMessage } from "@lobechat/types";
import { Flexbox } from "@lobehub/ui";
import { ChatHeader, ChatHeaderTitle, ChatInputArea, ChatSendButton } from "@lobehub/ui/mobile";
import { Button, DropdownMenu, type DropdownItem } from "@lobehub/ui/base-ui";
import { AtSign, BrainCircuit, BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExecutorAccessController } from "../features/executor-onboarding";
import type { MessageImageAttachment } from "@fields/contracts/public/home";
import type { RoomMessageImageAttachment } from "@fields/contracts/public/room";
import type { HomeMachineController } from "../features/home";
import type { RoomController } from "../features/room";
import { Conversation, type ConversationMessageAction } from "../features/conversation/Conversation";
import { composerMentionMarkdown } from "../features/conversation/editor-markdown";
import { translateMessage } from "../shared/i18n";
import { MobileImagePicker, MobileImageTray } from "./MobileImageDrafts";
import { type MobileImageUploadAdapter, useMobileImageDrafts } from "./use-mobile-image-drafts";

export type MobileImageComposerAdapter<THandle> = MobileImageUploadAdapter<THandle> & {
  send: (input: { markdown: string; imageAttachments: THandle[] }) => Promise<void>;
};

export function MobileHomeConversation({ home, executorAccess, imageAdapter, onBack }: {
  home: HomeMachineController;
  executorAccess: ExecutorAccessController;
  imageAdapter: MobileImageComposerAdapter<MessageImageAttachment>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const images = useMobileImageDrafts(imageAdapter);
  const [sendingImages, setSendingImages] = useState(false);
  const active = home.rightPanel.threads.items.find((item) => item.id === home.timeline.activeThreadId);
  return (
    <MobileConversationFrame
      composer={(
        <MobileComposer
          disabled={home.composer.sendDisabled || !executorAccess.active || images.blocked || sendingImages}
          error={home.composer.error}
          images={<MobileImageTray drafts={images.drafts} onRemove={images.remove} onRetry={images.retry} />}
          hasImages={images.handles.length > 0}
          loading={sendingImages || (home.composer.sendDisabled && home.timeline.generatingMessageIds.length > 0)}
          toolbar={<HomeToolbar executorAccess={executorAccess} home={home} imagePicker={<MobileImagePicker onFiles={images.add} />} />}
          value={home.composer.draft}
          onChange={home.composer.onDraft}
          onSend={() => {
            if (images.handles.length === 0) return void home.composer.onSend(home.composer.draft);
            setSendingImages(true);
            void imageAdapter.send({ markdown: home.composer.draft, imageAttachments: images.handles })
              .then(() => { home.composer.onDraft(""); images.clear(); })
              .finally(() => setSendingImages(false));
          }}
        />
      )}
      empty={!home.timeline.loading && !home.timeline.error && home.timeline.messages.length === 0}
      emptyLabel={t("home.prompt")}
      onBack={onBack}
      title={active?.title ?? t("workspace.newChat")}
    >
      {!executorAccess.active ? <div className="fields-mobile-home-unavailable" role="status">{t("mobile.homeExecutorRequired")}</div> : null}
      <Conversation
        contentWidth="compact"
        context={{ id: home.timeline.activeThreadId ?? "new", surface: "home" }}
        error={home.timeline.error}
        generatingMessageIds={home.timeline.generatingMessageIds}
        loading={home.timeline.loading}
        messageActions={homeMessageActions}
        messages={home.timeline.messages}
        onBranchSwitch={home.timeline.onBranchSwitch}
        onMessageAction={(action, message) => {
          if (action === "edit") home.timeline.onEdit(message);
          if (action === "branch") home.timeline.onFork(message);
          if (action === "regenerate") home.timeline.onRegenerate(message);
          if (action === "delete") home.timeline.onDeleteThread();
        }}
        store={home.timeline.store}
      />
    </MobileConversationFrame>
  );
}

export function MobileRoomConversation({ room, imageAdapter, onBack }: { room: RoomController; imageAdapter: MobileImageComposerAdapter<RoomMessageImageAttachment>; onBack: () => void }) {
  const { t } = useTranslation();
  const images = useMobileImageDrafts(imageAdapter);
  const [sendingImages, setSendingImages] = useState(false);
  const active = room.rooms.items.find((item) => item.active);
  return (
    <MobileConversationFrame
      composer={(
        <MobileComposer
          disabled={room.composer.sendDisabled || images.blocked || sendingImages}
          error={room.composer.error}
          images={<MobileImageTray drafts={images.drafts} onRemove={images.remove} onRetry={images.retry} />}
          hasImages={images.handles.length > 0}
          loading={sendingImages || room.timeline.conversationGeneratingMessageIds.length > 0}
          reply={room.composer.replyAnchor}
          toolbar={<RoomToolbar imagePicker={<MobileImagePicker onFiles={images.add} />} room={room} />}
          value={room.composer.draft}
          onChange={room.composer.onDraft}
          onSend={() => {
            if (images.handles.length === 0) return void room.composer.onSend(room.composer.draft);
            setSendingImages(true);
            void imageAdapter.send({ markdown: room.composer.draft, imageAttachments: images.handles })
              .then(() => { room.composer.onDraft(""); images.clear(); })
              .finally(() => setSendingImages(false));
          }}
        />
      )}
      empty={!room.timeline.loading && !room.timeline.error && room.timeline.conversationMessages.length === 0}
      emptyLabel={t("mobile.noMessages")}
      onBack={onBack}
      subtitle={active?.subtitle}
      title={active?.title ?? t("shell.rooms")}
    >
      <Conversation
        contentWidth="compact"
        context={{ id: room.rooms.activeId ?? "room", surface: "room" }}
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
        store={room.timeline.conversationStore}
      />
    </MobileConversationFrame>
  );
}

function MobileConversationFrame({ title, subtitle, empty, emptyLabel, composer, onBack, children }: {
  title: string;
  subtitle?: string;
  empty: boolean;
  emptyLabel: string;
  composer: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="fields-mobile-conversation">
      <ChatHeader center={<ChatHeaderTitle desc={subtitle} title={title} />} onBackClick={onBack} showBackButton />
      <div className="fields-mobile-timeline">{empty ? <div className="fields-mobile-conversation-empty">{emptyLabel}</div> : children}</div>
      {composer}
    </section>
  );
}

function MobileComposer({ value, disabled, loading, error, reply, toolbar, images, hasImages, onChange, onSend }: {
  value: string;
  disabled: boolean;
  loading: boolean;
  error: unknown;
  reply?: string | null;
  toolbar: ReactNode;
  images: ReactNode;
  hasImages: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  const message = translateMessage(t, error as never);
  const send = () => { if (!disabled && (value.trim() || hasImages)) onSend(); };
  return (
    <div className="fields-mobile-composer">
      {reply ? <div className="fields-mobile-reply">{reply}</div> : null}
      {message ? <div className="fields-mobile-composer-error" role="alert">{message}</div> : null}
      {images}
      <ChatInputArea
        bottomAddons={toolbar}
        loading={loading}
        safeArea
        textAreaRightAddons={<ChatSendButton aria-label={t("composer.send")} disabled={disabled || (!value.trim() && !hasImages)} loading={loading} onSend={send} />}
        value={value}
        onInput={onChange}
        onSend={send}
      />
    </div>
  );
}

function HomeToolbar({ home, executorAccess, imagePicker }: { home: HomeMachineController; executorAccess: ExecutorAccessController; imagePicker: ReactNode }) {
  const { t } = useTranslation();
  const modelItems: DropdownItem[] = home.composer.model.options.map((option) => ({
    key: option.model,
    label: option.display_name,
    onClick: () => home.composer.model.selectModel(option.model),
  }));
  const model = home.composer.model.selection?.model ?? t("home.model");
  const selectedOption = home.composer.model.options.find((option) => option.model === home.composer.model.selection?.model);
  const reasoningItems: DropdownItem[] = (selectedOption?.supported_reasoning_efforts ?? []).map((effort) => ({
    key: effort,
    label: effort,
    onClick: () => home.composer.model.selectReasoningEffort(effort),
  }));
  const reasoning = home.composer.model.selection?.reasoning_effort
    ?? selectedOption?.default_reasoning_effort
    ?? t("home.reasoning");
  const memoryActive = home.composer.memory.profile?.applied_enabled === true;
  return (
    <Flexbox horizontal align="center" gap={4}>
      {imagePicker}
      <Button disabled icon={<BrainCircuit size={15} />} size="small" type="text">{executorAccess.assignment?.executor?.name ?? t("executor.unavailable")}</Button>
      <DropdownMenu items={modelItems} nativeButton trigger="click"><Button disabled={home.composer.model.loading || modelItems.length === 0} size="small" type="text">{model}</Button></DropdownMenu>
      <DropdownMenu items={reasoningItems} nativeButton trigger="click"><Button disabled={home.composer.model.updating || reasoningItems.length === 0} size="small" type="text">{reasoning}</Button></DropdownMenu>
      <Button aria-label={t("home.memory")} disabled={!home.composer.memory.profile || home.composer.memory.updating} icon={<BookOpen size={15} />} onClick={() => home.composer.memory.setEnabled(!home.composer.memory.profile?.enabled)} size="small" type={memoryActive ? "primary" : "text"} />
    </Flexbox>
  );
}

function RoomToolbar({ room, imagePicker }: { room: RoomController; imagePicker: ReactNode }) {
  const { t } = useTranslation();
  const mentionItems: DropdownItem[] = room.composer.mentionOptions.map((mention) => ({
    key: mention.id,
    label: mention.label,
    onClick: () => appendMarkdown(room.composer.draft, composerMentionMarkdown({ label: mention.label, metadata: { id: mention.id } }), room.composer.onDraft),
  }));
  return (
    <Flexbox horizontal align="center" gap={4}>
      <DropdownMenu items={mentionItems} nativeButton trigger="click"><Button aria-label={t("composer.mention")} disabled={mentionItems.length === 0} icon={<AtSign size={16} />} size="small" type="text" /></DropdownMenu>
      {imagePicker}
    </Flexbox>
  );
}

function appendMarkdown(current: string, insertion: string, onChange: (value: string) => void) {
  onChange(`${current}${current.trim() ? " " : ""}${insertion}`);
}

function homeMessageActions(message: UIChatMessage): readonly ConversationMessageAction[] {
  if (message.metadata?.fieldsImported === true) return message.role === "user" ? ["copy", "delete"] : ["copy"];
  if (message.role === "user") return ["edit", "branch", "copy", "delete"];
  if (message.role === "assistant" || message.role === "assistantGroup") return ["regenerate", "branch", "copy"];
  return [];
}

function roomMessageActions(message: UIChatMessage): readonly ConversationMessageAction[] {
  if (message.metadata?.fieldsDeletedAt || message.role === "system") return [];
  if (message.role === "user" && message.metadata?.fieldsIsSelf === true) return ["edit", "reply", "copy", "delete"];
  if (message.role === "assistant" || message.role === "assistantGroup") return ["regenerate", "reply", "copy"];
  return ["reply", "copy"];
}

function roomMessageId(message: UIChatMessage): string {
  const id = message.metadata?.fieldsRoomMessageId;
  return typeof id === "string" ? id : message.id.replace(/^room:message:/u, "");
}
