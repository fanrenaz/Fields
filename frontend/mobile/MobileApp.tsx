import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { useEffect, useRef } from "react";
import { Button } from "@lobehub/ui/base-ui";
import { useTranslation } from "react-i18next";

import { useExecutorAccess } from "../features/executor-onboarding";
import { useHomeMachine } from "../features/home";
import { useRoomMachine } from "../features/room";
import { MobileAuthBoundary, type MobileAuthenticatedController } from "./MobileAuthBoundary";
import { MobileHomeConversation, MobileRoomConversation } from "./MobileConversation";
import { MobileHomeList, MobileRoomsList } from "./MobileLists";
import { MobileMe } from "./MobileMe";
import { MobileTabBar } from "./MobileTabBar";
import { uploadHomeMessageImage, uploadRoomMessageImage } from "./mobile-image-services";
import "./mobile.css";
import { useUiLocale } from "../shared/i18n/I18nProvider";
import { useMobileCapabilities } from "./use-mobile-capabilities";
import { backendTrpc } from "../data/boundary/backend-trpc";
import { notificationMarkReadInput } from "./mobile-pure-adapters";

export function MobileApp() {
  return <MobileAuthBoundary>{(auth) => <AuthenticatedMobileApp auth={auth} />}</MobileAuthBoundary>;
}

function AuthenticatedMobileApp({ auth }: { auth: MobileAuthenticatedController }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale } = useUiLocale();
  const capabilities = useMobileCapabilities(locale);
  const executorAccess = useExecutorAccess();
  const homeThreadId = routeId(location.pathname, "/home/");
  const roomId = routeId(location.pathname, "/rooms/");
  const home = useHomeMachine({
    active: location.pathname.startsWith("/home"),
    initialThreadId: homeThreadId === "new" ? null : homeThreadId,
    modelSourceKey: executorAccess.assignment?.executor
      ? `${executorAccess.assignment.executor.executor_id}:${executorAccess.assignment.version}:${executorAccess.assignment.session_state}`
      : null,
  });
  const room = useRoomMachine({
    actorId: auth.session.actor_id,
    displayName: auth.session.display_name,
    initialRoomId: roomId ?? undefined,
  });
  const activeHome = home.rightPanel.threads.items.find((item) => item.id === home.timeline.activeThreadId);
  const activeRoom = room.rooms.items.find((item) => item.id === room.rooms.activeId);
  useMarkConversationRead(
    activeHome?.unread ? { kind: "home", id: activeHome.id, through: activeHome.readThrough } : null,
    home.rightPanel.threads.refresh,
  );
  useMarkConversationRead(
    activeRoom?.unreadCount ? { kind: "room", id: activeRoom.id, through: activeRoom.readThrough } : null,
    room.rooms.refresh,
  );

  const conversationOpen = /^\/(?:home|rooms)\/[^/]+/u.test(location.pathname);
  return (
    <main className={`fields-mobile-app${conversationOpen ? " is-conversation" : ""}`}>
      <div className="fields-mobile-route">
        <Routes>
          <Route path="/home" element={<MobileHomeList home={home} homeAvailable={executorAccess.active} onNew={() => { if (!executorAccess.active) return; home.rightPanel.threads.startNew(); void navigate("/home/new"); }} onSelect={(id) => { home.rightPanel.threads.select(id); void navigate(`/home/${id}`); }} />} />
          <Route path="/home/:threadId" element={<MobileHomeConversation executorAccess={executorAccess} home={home} imageAdapter={{ upload: uploadHomeMessageImage, send: ({ markdown, imageAttachments }) => home.composer.onSend(markdown, imageAttachments) }} onBack={() => { void navigate("/home"); }} />} />
          <Route path="/rooms" element={<MobileRoomsList room={room} onSelect={(id) => { room.rooms.select(id); void navigate(`/rooms/${id}`); }} />} />
          <Route path="/rooms/:roomId" element={<MobileRoomRoute navigateBack={() => { void navigate("/rooms"); }} room={room} />} />
          <Route path="/rooms/:roomId/messages/:messageId" element={<MobileRoomRoute navigateBack={() => { void navigate("/rooms"); }} room={room} />} />
          <Route path="/me" element={<MobileMe auth={auth} capabilities={capabilities} executorAccess={executorAccess} />} />
          <Route path="/login" element={<Navigate replace to="/home" />} />
          <Route path="*" element={<Navigate replace to="/home" />} />
        </Routes>
      </div>
      {capabilities.notificationPrompt && !conversationOpen ? <aside className="fields-mobile-notification-prompt"><span>{t("mobile.notificationPrompt")}</span><Button onClick={() => void capabilities.enableNotifications()} size="small" type="primary">{t("mobile.enable")}</Button><Button onClick={capabilities.dismissNotificationPrompt} size="small" type="text">{t("common.close")}</Button></aside> : null}
      {conversationOpen ? null : <MobileTabBar />}
    </main>
  );
}

function MobileRoomRoute({ room, navigateBack }: { room: ReturnType<typeof useRoomMachine>; navigateBack: () => void }) {
  const { roomId, messageId } = useParams();
  useEffect(() => {
    if (!roomId) return;
    room.rooms.select(roomId);
    if (messageId) void room.timeline.openSearchMessage(roomId, messageId);
  }, [messageId, room.rooms.select, room.timeline.openSearchMessage, roomId]);
  return <MobileRoomConversation imageAdapter={{ upload: uploadRoomMessageImage, send: ({ markdown, imageAttachments }) => { if (!room.composer.onSend(markdown, imageAttachments)) return Promise.reject(new Error("room_image_send_rejected")); return Promise.resolve(); } }} room={room} onBack={navigateBack} />;
}

function routeId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length).split("/")[0];
  return id ? decodeURIComponent(id) : null;
}

function useMarkConversationRead(target: { kind: "home" | "room"; id: string; through?: string | null } | null, refresh: () => void) {
  const pending = useRef(new Set<string>());
  useEffect(() => {
    if (!target?.through) return;
    const through = target.through;
    const key = `${target.kind}:${target.id}:${through}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    void backendTrpc.notifications.inbox.markRead.mutate(notificationMarkReadInput({ ...target, through })).then(refresh).catch(() => pending.current.delete(key));
  }, [refresh, target?.id, target?.kind, target?.through]);
}
