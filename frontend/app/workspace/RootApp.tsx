import type {
  CompanyActor,
} from "@fields/contracts/public/company";
import type { AssetKind, AssetLifecycle } from "@fields/contracts/public/asset";
import type { AssetBuilderTarget } from "@fields/contracts/public/asset-builder";
import type { PersonalExecutorSummary } from "@fields/contracts/public/executor";
import { ContextMenuHost } from "@lobehub/ui";
import { Button, Tooltip } from "@lobehub/ui/base-ui";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AccountSettings } from "../../features/account/AccountSettings";
import { authServiceErrorMessage } from "../../data/auth/auth-machine-services";
import { backendTrpc } from "../../data/boundary/backend-trpc";
import {
  ExecutorAccessGate,
  ExecutorCreation,
  useExecutorAccess,
  type ExecutorAccessController,
} from "../../features/executor-onboarding";
import { HomeChat, HomeContextExplorer, HomeProjectsPanel, HomeThreadListPanel, useHomeMachine } from "../../features/home";
import { GlobalSearchPanel } from "../../features/search/GlobalSearchPanel";
import {
  actorSelectionAfterRemoval,
  invitationSelectionAfterRevocation,
  MemberDirectoryList,
  MemberPage,
  AgentBuilderPanel,
  useMemberWorkspace,
  type MemberWorkspaceController,
  type MemberWorkspaceTarget,
} from "../../features/members";
import {
  createDefaultRoom,
  RoomMembersPanel,
  RoomPage,
  RoomSideChatPanel,
  useRoomMachine,
} from "../../features/room";
import {
  AppShell,
  GlobalLoadingOverlay,
  GlobalRail,
  LobeAgentWorkspace,
  LobeGroupWorkspace,
  MainWorkspace,
  StagePageShell,
  StagePlaceholder,
  type FullPage,
  type OverlayKind,
} from "../../features/shell";
import { AuthBoundary } from "../session/AuthBoundary";
import type { AuthenticatedAuthController } from "../session/AuthBoundary";
import { WorkspaceErrorBoundary } from "../observability/WorkspaceErrorBoundary";
import { workspaceTelemetry } from "../observability/workspace-telemetry";
import { useAppToast } from "../providers/toast";
import { FilePickButton } from "../../shared/platform/file-pick-button";
import type { HomeFilesystemController } from "../../features/home/use-home-machine";
import { AssetBuilderPanel, AssetsWorkbench } from "../../features/assets";
import { CompanyFilesWorkbench } from "../../features/company-files";
import { MailWorkbench, type MailTarget } from "../../features/mail";
import { ScheduledTasksWorkbench } from "../../features/scheduled-tasks";
import { DesktopBrowserStage } from "../../features/desktop-browser/DesktopBrowserStage";
import type { DesktopNotificationEvent } from "@fields/contracts/public/desktop-notification";
import type { HomeConversationImport } from "@fields/contracts/public/home";
import {
  currentWorkspaceResumeRuntime,
  readWorkspaceResume,
  workspaceResumeKey,
  workspaceResumeStorage,
  writeWorkspaceResume,
  type WorkspaceProductDestination,
  type WorkspaceResumeView,
} from "./workspace-resume";

type FocusStageState =
  | { kind: "home_chat" }
  | { kind: "room_workbench" }
  | { kind: "member_workbench"; target: MemberWorkspaceTarget }
  | { kind: "stage_page"; page: Exclude<FullPage, null> };

export function RootApp() {
  return (
    <>
      <ContextMenuHost />
      <AuthBoundary>
        {(auth) => (
          <WorkspaceErrorBoundary>
            <ProductWorkspace key={`${auth.session.company_id}:${auth.session.actor_id}`} auth={auth} />
          </WorkspaceErrorBoundary>
        )}
      </AuthBoundary>
    </>
  );
}

function ProductWorkspace({
  auth,
}: {
  auth: AuthenticatedAuthController;
}) {
  const { t } = useTranslation();
  const toast = useAppToast();
  const session = auth.session;
  const [resume] = useState(() => {
    const runtime = currentWorkspaceResumeRuntime();
    const storage = workspaceResumeStorage(runtime);
    const key = workspaceResumeKey(session.company_id, session.actor_id);
    return { key, read: readWorkspaceResume(storage, key, runtime), runtime, storage };
  });
  const initialProductDestination = productDestinationFromResume(resume.read.view);
  const [globalSubRail, setGlobalSubRail] = useState<"rooms" | "assets" | null>(null);
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [desktopBrowserEnabled, setDesktopBrowserEnabled] = useState(false);
  const [focusStage, setFocusStage] = useState<FocusStageState>(() => (
    resume.read.view?.page === "settings"
      ? { kind: "stage_page", page: "settings" }
      : focusStageFromDestination(initialProductDestination)
  ));
  useEffect(() => {
    if (!window.fieldsDesktop?.browser) return;
    let active = true;
    const refresh = () => void backendTrpc.account.desktopBrowser.status.query().then((status) => {
      if (active) setDesktopBrowserEnabled(status.enabled);
    }).catch(() => { if (active) setDesktopBrowserEnabled(false); });
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [newMemberKey, setNewMemberKey] = useState(0);
  const [pendingHomeTarget, setPendingHomeTarget] = useState<
    { kind: "thread"; threadId: string } | { kind: "file"; path: string } | null
  >(null);
  const [pendingAssetTarget, setPendingAssetTarget] = useState<{
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  }>(() => {
    if (initialProductDestination.page !== "assets") {
      return { assetId: null, kind: "plugin", lifecycle: "published" };
    }
    return {
      assetId: initialProductDestination.assetId,
      kind: initialProductDestination.kind,
      lifecycle: initialProductDestination.lifecycle,
    };
  });
  const [assetMountKey, setAssetMountKey] = useState(0);
  const [assetBuilderTarget, setAssetBuilderTarget] = useState<AssetBuilderTarget>({
    kind: "plugin",
    asset_id: null,
    draft_id: null,
  });
  const [assetBuilderOpen, setAssetBuilderOpen] = useState(false);
  const [mailTarget, setMailTarget] = useState<MailTarget>(() => {
    if (initialProductDestination.page !== "mail") {
      return { mailboxId: null, folderId: null, messageId: null };
    }
    return {
      mailboxId: initialProductDestination.mailboxId,
      folderId: initialProductDestination.folderId,
      messageId: initialProductDestination.messageId,
    };
  });
  const [mailMountKey, setMailMountKey] = useState(0);
  const [settingsReturnTo, setSettingsReturnTo] = useState<WorkspaceProductDestination>(
    initialProductDestination,
  );
  const [accountSettingsSection, setAccountSettingsSection] = useState<
    "account" | "executors"
  >("account");
  const [executorCreation, setExecutorCreation] = useState<{
    origin: "settings" | "onboarding";
    executor: PersonalExecutorSummary | null;
  } | null>(null);
  const executorAccess = useExecutorAccess();
  const hasAvailableExecutor = executorAccess.options.some(
    (executor) => executor.availability === "available",
  );
  const executorSetupIncomplete = executorAccess.status === "required"
    && !hasAvailableExecutor;
  const home = useHomeMachine({
    active: focusStage.kind === "home_chat" && executorAccess.active,
    initialThreadId: initialProductDestination.page === "home"
      ? initialProductDestination.threadId
      : null,
    modelSourceKey: executorAccess.assignment?.executor
      ? `${executorAccess.assignment.executor.executor_id}:${executorAccess.assignment.version}:${executorAccess.assignment.session_state}`
      : null,
  });
  const member = useMemberWorkspace(
    session.actor_id,
    session.company_role === "owner",
  );
  const room = useRoomMachine({
    actorId: session.actor_id,
    displayName: session.display_name,
    initialRoomId: initialProductDestination.page === "room"
      ? initialProductDestination.roomId
      : undefined,
  });
  const roomWorkbenchActive = focusStage.kind === "room_workbench";
  const globalLoading = creatingRoom;
  const activeOverlay = roomWorkbenchActive ? room.overlay.kind : overlay;
  const referenceSearchActive = roomWorkbenchActive && activeOverlay === "reference-search";
  const settingsActive = focusStage.kind === "stage_page" && focusStage.page === "settings";
  const productDestination = useMemo<WorkspaceProductDestination>(() => (
    productDestinationFromWorkspace(
      focusStage,
      session.actor_id,
      home.timeline.activeThreadId,
      room.rooms.activeId,
      pendingAssetTarget,
      mailTarget,
    )
  ), [
    focusStage,
    home.timeline.activeThreadId,
    mailTarget,
    pendingAssetTarget,
    room.rooms.activeId,
    session.actor_id,
  ]);
  const PrimaryWorkspace = focusStage.kind === "home_chat"
    ? LobeAgentWorkspace
    : focusStage.kind === "room_workbench"
      ? LobeGroupWorkspace
      : MainWorkspace;
  useEffect(() => {
    if (!pendingHomeTarget || focusStage.kind !== "home_chat") return;
    if (pendingHomeTarget.kind === "thread") {
      home.rightPanel.open();
      home.rightPanel.threads.select(pendingHomeTarget.threadId);
    } else {
      home.leftPanel.open();
      const directories = searchResultDirectories(pendingHomeTarget.path);
      home.leftPanel.filesystem.setExpandedIds(directories);
      directories.forEach(home.leftPanel.filesystem.loadDirectory);
      home.leftPanel.filesystem.selectEntry(pendingHomeTarget.path);
    }
    setPendingHomeTarget(null);
  }, [focusStage.kind, home, pendingHomeTarget]);

  useEffect(() => {
    const view = settingsActive
      ? { page: "settings" as const, returnTo: settingsReturnTo }
      : productDestination;
    writeWorkspaceResume(resume.storage, resume.key, resume.runtime, view);
  }, [productDestination, resume, settingsActive, settingsReturnTo]);

  useEffect(() => {
    if (
      focusStage.kind === "room_workbench"
      && !room.rooms.loading
      && !room.rooms.hasMore
      && room.rooms.activeId
      && !room.rooms.items.some((candidate) => candidate.id === room.rooms.activeId)
    ) {
      room.overlay.close();
      setFocusStage({ kind: "home_chat" });
    }
  }, [focusStage.kind, room.overlay, room.rooms.activeId, room.rooms.hasMore, room.rooms.items, room.rooms.loading]);

  const railActive = useMemo(() => {
    if (settingsActive || auth.account.menu.isOpen) return "account";
    if (activeOverlay === "search" || activeOverlay === "reference-search") return "search";
    if (globalSubRail) return globalSubRail;
    if (focusStage.kind === "room_workbench") return "rooms";
    if (focusStage.kind === "member_workbench") return "members";
    if (focusStage.kind === "stage_page") return focusStage.page;
    return "home";
  }, [activeOverlay, auth.account.menu.isOpen, focusStage, globalSubRail, settingsActive]);

  if (executorCreation) {
    return <ExecutorCreation
      actorId={session.actor_id}
      companyId={session.company_id}
      existingExecutor={executorCreation.executor}
      onCancel={() => {
        setExecutorCreation(null);
        void executorAccess.refresh();
      }}
      onComplete={async (executor) => {
        if (executorCreation.origin === "onboarding") {
          await executorAccess.bind(executor.executor_id);
        }
        setExecutorCreation(null);
        await executorAccess.refresh();
      }}
    />;
  }

  function startExecutorCreation() {
    const hasOwnedExecutor = executorAccess.options.some(
      (executor) => executor.owner_actor_id === session.actor_id,
    );
    setExecutorCreation({
      origin: !hasAvailableExecutor && !hasOwnedExecutor ? "onboarding" : "settings",
      executor: null,
    });
  }

  async function resumeExecutorCreation(executorId: string) {
    try {
      const result = await backendTrpc.account.executors.list.query();
      const executor = result.items.find((item) => item.executor_id === executorId);
      if (!executor) throw new Error("EXECUTOR_NOT_FOUND");
      const hasOtherOwnedExecutor = executorAccess.options.some((item) => (
        item.owner_actor_id === session.actor_id
        && item.executor_id !== executor.executor_id
      ));
      const alreadyAssigned = executorAccess.assignment?.executor?.executor_id
        === executor.executor_id;
      setExecutorCreation({
        origin: !hasAvailableExecutor && !hasOtherOwnedExecutor && !alreadyAssigned
          ? "onboarding"
          : "settings",
        executor,
      });
    } catch (cause) {
      workspaceTelemetry.recordError("executor_onboarding_executor_list");
      toast.error(authServiceErrorMessage(cause, t("executor.unavailable")));
    }
  }

  function openAccountSettings(section: "account" | "executors") {
    if (!settingsActive) setSettingsReturnTo(productDestination);
    room.overlay.close();
    setOverlay(null);
    setGlobalSubRail(null);
    setAccountSettingsSection(section);
    setFocusStage({ kind: "stage_page", page: "settings" });
  }

  function closeAccountSettings() {
    setFocusStage(focusStageFromDestination(settingsReturnTo));
  }

  function openExecutorManagement() {
    openAccountSettings("executors");
  }

  function openExecutorSetup() {
    const incomplete = executorAccess.options.find((executor) => (
      executor.owner_actor_id === session.actor_id
      && (executor.availability === "pending_auth"
        || executor.availability === "configuration_required")
    ));
    if (incomplete) {
      void resumeExecutorCreation(incomplete.executor_id);
      return;
    }
    if (executorAccess.options.some((executor) => executor.owner_actor_id === session.actor_id)) {
      openExecutorManagement();
      return;
    }
    startExecutorCreation();
  }

  function openHomeChat() {
    room.overlay.close();
    setFocusStage({ kind: "home_chat" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openSelectedRoom(roomId: string) {
    room.rooms.select(roomId);
    room.leftPanel.open();
    room.rightPanel.close();
    setFocusStage({ kind: "room_workbench" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openSelectedMember(actorId: string, agentHint = false) {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    setFocusStage({ kind: "member_workbench", target: { kind: "existing", actorId } });
    if (
      agentHint
      || member.directory.members.some((actor) => actor.actor_id === actorId && actor.actor_type === "agent")
    ) {
      member.panels.openRight();
    } else {
      member.panels.closeRight();
    }
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openSelectedInvitation(invitationCredential: string) {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    setFocusStage({
      kind: "member_workbench",
      target: { kind: "invitation", invitationCredential },
    });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openMembersWorkspace() {
    member.panels.openLeft();
    openSelectedMember(session.actor_id);
  }

  function openNewMemberWorkspace() {
    member.panels.openLeft();
    setNewMemberKey((value) => value + 1);
    setFocusStage({ kind: "member_workbench", target: { kind: "new", key: newMemberKey + 1 } });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openAssets(
    assetId: string | null = null,
    kind: AssetKind = "plugin",
    lifecycle: AssetLifecycle = "published",
  ) {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    setPendingAssetTarget({ assetId, kind, lifecycle });
    setAssetMountKey((value) => value + 1);
    setAssetBuilderTarget((current) => ({
      kind,
      asset_id: assetId,
      draft_id: current.asset_id === assetId ? current.draft_id : null,
    }));
    setFocusStage({ kind: "stage_page", page: "assets" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openMail(target?: Partial<MailTarget>) {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    if (target) {
      setMailTarget({
        mailboxId: target.mailboxId ?? null,
        folderId: target.folderId ?? null,
        messageId: target.messageId ?? null,
      });
      setMailMountKey((value) => value + 1);
    }
    setFocusStage({ kind: "stage_page", page: "mail" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openFiles() {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    setFocusStage({ kind: "stage_page", page: "files" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  function openScheduledTasks() {
    room.overlay.close();
    home.leftPanel.close();
    home.rightPanel.close();
    room.leftPanel.close();
    room.rightPanel.close();
    setFocusStage({ kind: "stage_page", page: "scheduledTasks" });
    setOverlay(null);
    setGlobalSubRail(null);
  }

  async function handleRemoveMember(actor: CompanyActor) {
    const removed = await member.directory.removeActor(actor);
    if (removed) {
      setFocusStage((current) => {
        if (current.kind !== "member_workbench" || current.target.kind !== "existing") {
          return current;
        }
        const nextActorId = actorSelectionAfterRemoval(current.target.actorId, actor.actor_id, session.actor_id);
        return nextActorId === current.target.actorId
          ? current
          : { kind: "member_workbench", target: { kind: "existing", actorId: nextActorId } };
      });
    }
  }

  function handleInvitationRevoked(invitationCredential: string) {
    setFocusStage((current) => {
      if (
        current.kind !== "member_workbench"
        || current.target.kind !== "invitation"
      ) return current;
      const fallback = invitationSelectionAfterRevocation(
        current.target.invitationCredential,
        invitationCredential,
        session.actor_id,
      );
      return fallback
        ? { kind: "member_workbench", target: { kind: "existing", actorId: fallback.actorId } }
        : current;
    });
  }

  async function handleCreateRoom() {
    setCreatingRoom(true);
    try {
      const created = await createDefaultRoom();
      room.rooms.refresh();
      room.rooms.select(created.id);
      room.leftPanel.open();
      room.rightPanel.close();
      setFocusStage({ kind: "room_workbench" });
      setOverlay(null);
      setGlobalSubRail(null);
    } catch {
      workspaceTelemetry.recordError();
      room.rooms.refresh();
      toast.error(t("room.createFailed"));
    } finally {
      setCreatingRoom(false);
    }
  }

  function openHomeSearchFile(path: string) {
    openHomeChat();
    setPendingHomeTarget({ kind: "file", path });
  }

  function openGlobalSearch() {
    setGlobalSubRail(null);
    if (roomWorkbenchActive) room.overlay.openSearch();
    else setOverlay("search");
  }

  function openDesktopBrowser() {
    if (!desktopBrowserEnabled) return;
    room.overlay.close();
    setOverlay(null);
    setGlobalSubRail(null);
    setFocusStage({ kind: "stage_page", page: "browser" });
  }

  useEffect(() => {
    const bridge = window.fieldsDesktop?.notifications;
    if (!bridge) return undefined;
    const subscription = backendTrpc.desktop.notifications.events.subscribe({}, {
      onData: (event: DesktopNotificationEvent) => {
        if (event.type === "room.message") {
          void bridge.show({ eventId: event.event_id, title: `${event.sender_name} · ${event.room_name}`, body: event.preview || t("desktopNotifications.roomMessage"), destination: { kind: "room", roomId: event.room_id, messageId: event.message_id } });
          return;
        }
        const targetName = event.target.kind === "room" ? event.target.room_name : event.target.title;
        const body = event.preview || t(`desktopNotifications.${event.status}`);
        const destination: DesktopNavigationDestination = event.target.kind === "room"
          ? { kind: "room", roomId: event.target.room_id, messageId: event.target.message_id }
          : { kind: "home", threadId: event.target.thread_id };
        void bridge.show({ eventId: event.event_id, title: `${targetName} · ${t("desktopNotifications.agent")}`, body, destination });
      },
    });
    return () => subscription.unsubscribe();
  }, [t]);

  useEffect(() => window.fieldsDesktop?.navigation.onOpen((destination) => {
    if (destination.kind === "home") {
      openHomeChat();
      setPendingHomeTarget({ kind: "thread", threadId: destination.threadId });
      return;
    }
    openSelectedRoom(destination.roomId);
    window.setTimeout(() => { void room.timeline.openSearchMessage(destination.roomId, destination.messageId); }, 0);
  }), [room.timeline]);

  return (
    <AppShell onSearch={openGlobalSearch}>
      <GlobalRail
        active={railActive}
        assetKind={pendingAssetTarget.kind}
        assetsOpen={globalSubRail === "assets"}
        browserEnabled={desktopBrowserEnabled}
        roomsOpen={globalSubRail === "rooms"}
        rooms={room.rooms.items}
        onCollapse={() => setGlobalSubRail(null)}
        onHome={openHomeChat}
        onBrowser={openDesktopBrowser}
        onRooms={() => {
          if (roomWorkbenchActive) room.overlay.close();
          setOverlay(null);
          setGlobalSubRail((current) => (current === "rooms" ? null : "rooms"));
        }}
        onCreateRoom={() => {
          void handleCreateRoom();
        }}
        onSelectRoom={openSelectedRoom}
        onMembers={openMembersWorkspace}
        onFiles={openFiles}
        onMail={() => openMail()}
        onScheduledTasks={openScheduledTasks}
        onAssetsOpenChange={(open) => {
          setGlobalSubRail((current) => (
            open ? "assets" : current === "assets" ? null : current
          ));
        }}
        onAssetKind={(kind) => openAssets(null, kind, "published")}
        onSearch={openGlobalSearch}
        account={{
          displayName: auth.account.displayName,
          email: auth.account.email,
          menu: auth.account.menu,
          executorSetup: {
            incomplete: executorSetupIncomplete,
            open: openExecutorSetup,
          },
          openSettings: () => {
            openAccountSettings("account");
          },
          logout: auth.account.logout,
        }}
      />
      <PrimaryWorkspace
        header={workspaceHeaderSlot(focusStage, room.rooms.items)}
        leftPanel={leftPanelSlot(
          focusStage,
          t,
          home,
          executorAccess,
          member,
          room,
          session.company_role === "owner",
          openNewMemberWorkspace,
          openSelectedMember,
          openSelectedInvitation,
          (actor) => void handleRemoveMember(actor),
        )}
        focusStage={settingsActive ? (
          <AccountSettings
            initialSection={accountSettingsSection}
            controller={{
              actorId: session.actor_id,
              companyId: session.company_id,
              displayName: auth.account.displayName,
              email: auth.account.email,
              companyRole: auth.account.companyRole,
              close: closeAccountSettings,
              createExecutor: () => setExecutorCreation({ origin: "settings", executor: null }),
              configureExecutorModels: (executor) => setExecutorCreation({ origin: "settings", executor }),
              password: auth.account.password,
            }}
          />
        ) : focusStageSlot(
          focusStage,
          t,
          home,
          executorAccess,
          session.company_id,
          session.actor_id,
          member,
          room,
          session.company_role === "owner",
          openHomeChat,
          openSelectedRoom,
          openSelectedMember,
          handleInvitationRevoked,
          startExecutorCreation,
          (executorId) => { void resumeExecutorCreation(executorId); },
          openExecutorManagement,
          pendingAssetTarget,
          assetMountKey,
          setPendingAssetTarget,
          openAssets,
          setAssetBuilderTarget,
          session.company_role === "owner",
          mailTarget,
          mailMountKey,
          setMailTarget,
          session.company_role === "owner",
          toast,
        )}
        rightPanel={rightPanelSlot(
          focusStage,
          t,
          home,
          executorAccess,
          member,
          room,
          assetBuilderTarget,
          assetBuilderOpen,
          setAssetBuilderOpen,
          (target) => {
            setAssetBuilderTarget(target);
            if (target.asset_id) openAssets(target.asset_id, target.kind, "draft");
          },
        )}
        overlay={{
          open: activeOverlay === "search" || activeOverlay === "reference-search",
          onOpenChange: (open) => {
            if (roomWorkbenchActive) {
              if (open) {
                if (referenceSearchActive) room.overlay.openReferenceSearch();
                else room.overlay.openSearch();
              }
              else room.overlay.close();
            } else {
              setOverlay(open ? "search" : null);
            }
          },
          content: (
            <GlobalSearchPanel
              isItemSelectable={referenceSearchActive ? room.composer.canAddSearchResult : undefined}
              onSelectItem={referenceSearchActive ? (item) => {
                if (room.composer.onAddSearchResult(item)) room.overlay.close();
              } : undefined}
              onRoom={openSelectedRoom}
              onMember={openSelectedMember}
              onHomeThread={(threadId) => {
                openHomeChat();
                setPendingHomeTarget({ kind: "thread", threadId });
              }}
              onMessage={(roomId, messageId) => {
                openSelectedRoom(roomId);
                void room.timeline.openSearchMessage(roomId, messageId);
              }}
              onHomeFile={openHomeSearchFile}
              onCompanyFile={() => openFiles()}
              onAsset={(assetId, kind) => openAssets(assetId, kind, "published")}
              onEmail={(mailboxId, folderId, messageId) => openMail({ mailboxId, folderId, messageId })}
            />
          ),
        }}
      />
      <GlobalLoadingOverlay open={globalLoading} />
    </AppShell>
  );
}

function productDestinationFromResume(
  view: WorkspaceResumeView | null,
): WorkspaceProductDestination {
  if (!view) return { page: "home", threadId: null };
  if (view.page === "settings") return view.returnTo;
  return view;
}

function focusStageFromDestination(destination: WorkspaceProductDestination): FocusStageState {
  if (destination.page === "home") return { kind: "home_chat" };
  if (destination.page === "room") return { kind: "room_workbench" };
  if (destination.page === "member") {
    return {
      kind: "member_workbench",
      target: { kind: "existing", actorId: destination.actorId },
    };
  }
  return { kind: "stage_page", page: destination.page };
}

function productDestinationFromWorkspace(
  focusStage: FocusStageState,
  currentActorId: string,
  homeThreadId: string | null,
  roomId: string | null,
  assetTarget: {
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  },
  mailTarget: MailTarget,
): WorkspaceProductDestination {
  if (focusStage.kind === "home_chat") return { page: "home", threadId: homeThreadId };
  if (focusStage.kind === "room_workbench") {
    return roomId ? { page: "room", roomId } : { page: "home", threadId: null };
  }
  if (focusStage.kind === "member_workbench") {
    return focusStage.target.kind === "existing"
      ? { page: "member", actorId: focusStage.target.actorId }
      : { page: "member", actorId: currentActorId };
  }
  if (focusStage.page === "files") return { page: "files" };
  if (focusStage.page === "assets") return { page: "assets", ...assetTarget };
  if (focusStage.page === "mail") return { page: "mail", ...mailTarget };
  if (focusStage.page === "scheduledTasks") return { page: "scheduledTasks" };
  return { page: "home", threadId: null };
}

function searchResultDirectories(path: string): string[] {
  const parts = path.split("/").filter((part) => part && part !== ".");
  const directories = ["."];
  let current = "";
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    directories.push(current);
  }
  return directories;
}

function workspaceHeaderSlot(
  focusStage: FocusStageState,
  rooms: ReturnType<typeof useRoomMachine>["rooms"]["items"],
) {
  if (focusStage.kind === "stage_page") {
    return null;
  }
  if (focusStage.kind === "room_workbench") {
    const activeRoom = rooms.find((room) => room.active);
    return activeRoom
      ? { title: activeRoom.title, subtitle: activeRoom.subtitle }
      : {};
  }
  return {};
}

function leftPanelSlot(
  focusStage: FocusStageState,
  t: (key: string) => string,
  home: ReturnType<typeof useHomeMachine>,
  executorAccess: ExecutorAccessController,
  member: MemberWorkspaceController,
  room: ReturnType<typeof useRoomMachine>,
  canManageMembers: boolean,
  openNewMemberWorkspace: () => void,
  openSelectedMember: (actorId: string, agentHint?: boolean) => void,
  openSelectedInvitation: (invitationCredential: string) => void,
  removeMember: (member: CompanyActor) => void,
) {
  if (focusStage.kind === "home_chat") {
    if (!executorAccess.active) return null;
    return {
      open: home.rightPanel.isOpen,
      onCollapse: home.rightPanel.close,
      onExpand: home.rightPanel.open,
      tabs: {
        value: "chat",
        items: [{ value: "chat", label: t("workspace.chat") }],
        onValueChange: () => undefined,
        actions: (
          <>
            <Tooltip title={t("workspace.newChat")}><Button aria-label={t("workspace.newChat")} disabled={home.rightPanel.threads.navigationDisabled} icon={<Plus size={15} />} onClick={home.rightPanel.threads.startNew} shape="circle" size="small" type="text" /></Tooltip>
            <ConversationImportButton onCompleted={home.rightPanel.threads.refresh} />
            <Tooltip title={t("common.refresh")}><Button aria-label={t("common.refresh")} icon={<RefreshCw size={14} />} onClick={home.rightPanel.threads.refresh} shape="circle" size="small" type="text" /></Tooltip>
            <Tooltip title={t("common.search")}><Button aria-label={t("common.search")} icon={<Search size={14} />} onClick={home.rightPanel.threads.search.open} shape="circle" size="small" type="text" /></Tooltip>
          </>
        ),
      },
      content: (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
          <HomeProjectsPanel
            activeThreadId={home.timeline.activeThreadId}
            disabled={home.rightPanel.threads.navigationDisabled}
            error={home.rightPanel.projects.error}
            items={home.rightPanel.projects.items}
            loading={home.rightPanel.projects.loading}
            onCreate={home.rightPanel.projects.create}
            onDelete={home.rightPanel.projects.remove}
            onMoveActiveThread={home.rightPanel.projects.moveActiveThread}
            onRename={home.rightPanel.projects.rename}
            onSelect={home.rightPanel.projects.select}
            selectedId={home.rightPanel.projects.selectedId}
          />
          <HomeThreadListPanel
            items={home.rightPanel.threads.items}
            loading={home.rightPanel.threads.loading}
            error={home.rightPanel.threads.error}
            hasMore={home.rightPanel.threads.hasMore}
            searchOpen={home.rightPanel.threads.search.isOpen}
            searchDraft={home.rightPanel.threads.search.draft}
            expanded={home.rightPanel.threads.expanded}
            navigationDisabled={home.rightPanel.threads.navigationDisabled}
            onNewThread={home.rightPanel.threads.startNew}
            onRefresh={home.rightPanel.threads.refresh}
            onSearchOpen={home.rightPanel.threads.search.open}
            onSearchClose={home.rightPanel.threads.search.close}
            onSearchDraftChange={home.rightPanel.threads.search.setDraft}
            onExpand={home.rightPanel.threads.expand}
            onLoadMore={home.rightPanel.threads.loadMore}
            onSelectThread={(thread) => home.rightPanel.threads.select(thread.id)}
            showHeader={false}
          />
        </div>
      ),
    };
  }
  if (focusStage.kind === "room_workbench") {
    return {
      open: room.leftPanel.isOpen,
      onCollapse: room.leftPanel.close,
      onExpand: room.leftPanel.open,
      tabs: {
        ...room.leftPanel.tabs,
        actions: !room.leftPanel.members.adding ? (
          <span style={{ alignItems: "center", display: "flex", gap: 4 }}>
            <Tooltip title={t("common.refresh")}><Button aria-label={t("common.refresh")} disabled={room.leftPanel.members.loading} icon={<RefreshCw size={14} />} onClick={room.leftPanel.members.refresh} shape="circle" size="small" type="text" /></Tooltip>
            {room.leftPanel.members.canManage ? (
              <Tooltip title={t("workspace.addMember")}><Button
                aria-label={t("workspace.addMember")}
                icon={<Plus size={15} />}
                onClick={() => {
                  room.leftPanel.members.openAdd();
                  if (!member.directory.loaded && !member.directory.loading) {
                    void member.directory.refresh();
                  }
                }}
                shape="circle"
                size="small"
                type="text"
              /></Tooltip>
            ) : null}
          </span>
        ) : null,
      },
      content: (
        <RoomMembersPanel
          roomId={room.leftPanel.members.roomId}
          members={room.leftPanel.members.items}
          loading={room.leftPanel.members.loading}
          error={room.leftPanel.members.error}
          canManage={room.leftPanel.members.canManage}
          adding={room.leftPanel.members.adding}
          companyActors={member.directory.members}
          companyActorsLoading={member.directory.loading}
          companyActorsLoaded={member.directory.loaded}
          companyActorsError={member.directory.error}
          onAddMember={room.leftPanel.members.add}
          onCloseAdd={room.leftPanel.members.closeAdd}
          onRetryCompanyActors={() => void member.directory.refresh()}
          onRemoveMember={room.leftPanel.members.remove}
        />
      ),
    };
  }
  if (focusStage.kind === "member_workbench") {
    return {
      open: member.panels.leftOpen,
      onCollapse: member.panels.closeLeft,
      onExpand: member.panels.openLeft,
      tabs: {
        value: "members",
        items: [],
        onValueChange: () => undefined,
        actions: canManageMembers
          ? <Tooltip title={t("workspace.addMember")}><Button aria-label={t("workspace.addMember")} icon={<Plus size={15} />} onClick={openNewMemberWorkspace} shape="circle" size="small" type="text" /></Tooltip>
          : null,
      },
      content: (
        <MemberDirectoryList
          entries={member.directory.entries}
          loading={member.directory.loading}
          error={member.directory.error}
          invitationError={member.directory.invitationError}
          canManage={canManageMembers}
          removingActorId={member.directory.removingActorId}
          onRetry={() => void member.directory.refresh()}
          onSelectMember={openSelectedMember}
          onSelectInvitation={openSelectedInvitation}
          onRemoveMember={removeMember}
        />
      ),
    };
  }
  return null;
}

function ConversationImportButton({ onCompleted }: { onCompleted: () => void }) {
  const { t } = useTranslation();
  const toast = useAppToast();
  const [uploading, setUploading] = useState(false);
  const waitForImport = async (initial: HomeConversationImport): Promise<HomeConversationImport> => {
    let current = initial;
    while (current.status !== "succeeded" && current.status !== "failed") {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      current = await backendTrpc.home.conversationImport.read.query({ import_id: current.import_id });
    }
    return current;
  };
  return <Tooltip title={t("home.importConversations")}>
    <FilePickButton
      accept=".zip,.json,.jsonl,application/zip,application/json"
      aria-label={t("home.importConversations")}
      disabled={uploading}
      icon={<Upload size={14} />}
      maxFileSizeBytes={512 * 1024 * 1024}
      multiple={false}
      onFilesPicked={(files) => {
        const picked = files[0];
        if (!picked) return;
        setUploading(true);
        void fetch(`/api/v1/home/conversation-imports?name=${encodeURIComponent(picked.name)}`, {
          method: "POST",
          body: picked.file,
          headers: { "content-type": "application/octet-stream" },
        }).then(async (response) => {
          if (!response.ok) throw new Error("conversation_import_upload_failed");
          return waitForImport(await response.json() as HomeConversationImport);
        }).then((result) => {
          if (result.status !== "succeeded") throw new Error(result.error_code ?? "conversation_import_failed");
          toast.success(t("home.importConversationsSucceeded", { count: result.total_conversations - result.skipped_conversations }));
          onCompleted();
        }).catch(() => toast.error(t("home.importConversationsFailed"))).finally(() => setUploading(false));
      }}
      onFilesRejected={() => toast.error(t("home.importConversationsTooLarge"))}
      shape="circle"
      size="small"
      type="text"
    />
  </Tooltip>;
}

function FilesystemUploadAction({
  filesystem,
}: {
  filesystem: HomeFilesystemController;
}) {
  const { t } = useTranslation();
  const toast = useAppToast();
  const [uploading, setUploading] = useState(false);
  return (
    <Tooltip title={t("workspace.upload")}>
      <FilePickButton
        aria-label={t("workspace.upload")}
        disabled={uploading || filesystem.mutating}
        icon={<Upload size={14} />}
        onFilesPicked={(files) => {
          setUploading(true);
          void filesystem.uploadFiles(filesystemUploadParent(filesystem), files)
            .then((result) => {
              if (result.failed.length > 0) {
                toast.error(t("workspace.uploadFailed", { count: result.failed.length }));
              } else {
                toast.success(t("workspace.uploadSucceeded", { count: result.uploaded.length }));
              }
            })
            .finally(() => setUploading(false));
        }}
        onFilesRejected={(files) => {
          toast.error(t("workspace.uploadFailed", { count: files.length }));
        }}
        shape="circle"
        size="small"
        type="text"
      />
    </Tooltip>
  );
}

function filesystemUploadParent(
  filesystem: HomeFilesystemController,
): string {
  const selected = filesystem.selectedId ? filesystem.items[filesystem.selectedId] : null;
  if (!selected) return filesystem.rootId;
  if (selected.is_folder) return selected.path;
  const slash = selected.path.lastIndexOf("/");
  return slash < 0 ? filesystem.rootId : selected.path.slice(0, slash);
}

function focusStageSlot(
  focusStage: FocusStageState,
  t: (key: string) => string,
  home: ReturnType<typeof useHomeMachine>,
  executorAccess: ExecutorAccessController,
  companyId: string,
  actorId: string,
  member: MemberWorkspaceController,
  room: ReturnType<typeof useRoomMachine>,
  canManageAgentExecutor: boolean,
  openHomeChat: () => void,
  openSelectedRoom: (roomId: string) => void,
  openSelectedMember: (actorId: string, agentHint?: boolean) => void,
  onInvitationRevoked: (invitationCredential: string) => void,
  createExecutor: () => void,
  resumeExecutor: (executorId: string) => void,
  manageExecutors: () => void,
  assetTarget: {
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  },
  assetMountKey: number,
  onAssetLocationChange: (target: {
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  }) => void,
  openAssetTarget: (
    assetId: string | null,
    kind: AssetKind,
    lifecycle: AssetLifecycle,
  ) => void,
  onAssetBuilderTargetChange: (target: AssetBuilderTarget) => void,
  canManageAssetCredentials: boolean,
  mailTarget: MailTarget,
  mailMountKey: number,
  onMailTargetChange: (target: MailTarget) => void,
  canManageSharedMail: boolean,
  toast: ReturnType<typeof useAppToast>,
) {
  if (focusStage.kind === "stage_page") {
    if (focusStage.page === "browser") {
      return <DesktopBrowserStage actorId={actorId} companyId={companyId} />;
    }
    if (focusStage.page === "files") {
      return <CompanyFilesWorkbench canDelete={canManageSharedMail} toast={toast} />;
    }
    if (focusStage.page === "assets") {
      return (
        <AssetsWorkbench
          canManageCredentials={canManageAssetCredentials}
          initialAssetId={assetTarget.assetId}
          initialKind={assetTarget.kind}
          initialLifecycle={assetTarget.lifecycle}
          key={`assets:${assetMountKey}`}
          onLocationChange={onAssetLocationChange}
          onTargetChange={({ assetId, kind, lifecycle }) => {
            openAssetTarget(assetId, kind, lifecycle);
          }}
          onBuilderTargetChange={onAssetBuilderTargetChange}
        />
      );
    }
    if (focusStage.page === "mail") {
      return (
        <MailWorkbench
          actorId={actorId}
          canManageShared={canManageSharedMail}
          initialTarget={mailTarget}
          key={`mail:${mailMountKey}`}
          onTargetChange={onMailTargetChange}
          toast={toast}
        />
      );
    }
    if (focusStage.page === "scheduledTasks") {
      return (
        <ScheduledTasksWorkbench
          onOpenHomeThread={(threadId) => {
            home.rightPanel.threads.select(threadId);
            openHomeChat();
          }}
          onOpenRoomMessage={(roomId, messageId) => {
            openSelectedRoom(roomId);
            void room.timeline.openSearchMessage(roomId, messageId);
          }}
          targetOptions={{
            rooms: room.rooms.items.map((item) => ({ id: item.id, title: item.title })),
            threads: home.rightPanel.threads.items.map((item) => ({ id: item.id, title: item.title })),
          }}
        />
      );
    }
    return (
      <StagePageShell title={fullPageTitle(focusStage.page, t)} onBack={openHomeChat}>
        <StagePlaceholder title={fullPageTitle(focusStage.page, t)} />
      </StagePageShell>
    );
  }
  if (focusStage.kind === "room_workbench") {
    return <RoomPage controller={room} />;
  }
  if (focusStage.kind === "member_workbench") {
    return (
      <MemberPage
        target={focusStage.target}
        members={member.directory.members}
        invitations={member.directory.invitations}
        canManageAgentExecutor={canManageAgentExecutor}
        getActor={member.directory.getActor}
        createActor={member.directory.createActor}
        confirmInvitationCopy={member.directory.confirmInvitationCopy}
        revokeInvitation={member.directory.revokeInvitation}
        onAgentCreated={(agentId) => {
          openSelectedMember(agentId, true);
        }}
        onInvitationRevoked={onInvitationRevoked}
        onMemberUnavailable={() => openSelectedMember(actorId)}
      />
    );
  }
  if (!executorAccess.active) {
    return (
      <ExecutorAccessGate
        actorId={actorId}
        controller={executorAccess}
        onCreate={createExecutor}
        onManage={manageExecutors}
        onResume={resumeExecutor}
      />
    );
  }
  return <HomeChat executorAccess={executorAccess} home={home} onOpenExecutorSetup={manageExecutors} />;
}

function rightPanelSlot(
  focusStage: FocusStageState,
  t: (key: string) => string,
  home: ReturnType<typeof useHomeMachine>,
  executorAccess: ExecutorAccessController,
  member: MemberWorkspaceController,
  room: ReturnType<typeof useRoomMachine>,
  assetBuilderTarget: AssetBuilderTarget,
  assetBuilderOpen: boolean,
  setAssetBuilderOpen: (open: boolean) => void,
  onAssetBuilderTargetChange: (target: AssetBuilderTarget) => void,
) {
  if (focusStage.kind === "home_chat") {
    if (!executorAccess.active) return null;
    return {
      open: home.leftPanel.isOpen,
      onCollapse: home.leftPanel.close,
      onExpand: home.leftPanel.open,
      tabs: {
        value: "explorer",
        items: [{ value: "explorer", label: t("workspace.explorer") }],
        onValueChange: () => undefined,
        actions: (
          <span style={{ alignItems: "center", display: "flex", gap: 4 }}>
            <FilesystemUploadAction filesystem={home.leftPanel.filesystem} />
            <Tooltip title={t("common.refresh")}><Button aria-label={t("common.refresh")} disabled={home.leftPanel.filesystem.loading} icon={<RefreshCw size={14} />} onClick={home.leftPanel.filesystem.refresh} shape="circle" size="small" type="text" /></Tooltip>
          </span>
        ),
      },
      content: <HomeContextExplorer filesystem={home.leftPanel.filesystem} showHeader={false} />,
    };
  }
  if (focusStage.kind === "room_workbench") {
    const activeRoomId = room.rooms.items.find((candidate) => candidate.active)?.id ?? null;
    return {
      open: room.rightPanel.isOpen,
      onCollapse: room.rightPanel.close,
      onExpand: room.rightPanel.open,
      tabs: room.rightPanel.tabs,
      content: (
        <RoomSideChatPanel
          active={room.rightPanel.isOpen}
          roomId={activeRoomId}
        />
      ),
    };
  }
  if (focusStage.kind === "member_workbench") {
    const target = focusStage.target;
    const actor = target.kind === "existing"
      ? member.directory.members.find((candidate) => candidate.actor_id === target.actorId)
      : null;
    if (!actor || actor.actor_type !== "agent") return null;
    return {
      open: member.panels.rightOpen,
      onCollapse: member.panels.closeRight,
      onExpand: member.panels.openRight,
      content: <AgentBuilderPanel agentMemberId={actor.actor_id} agentName={actor.display_name} />,
    };
  }
  if (focusStage.kind === "stage_page" && focusStage.page === "assets") {
    return {
      open: assetBuilderOpen,
      onCollapse: () => setAssetBuilderOpen(false),
      onExpand: () => setAssetBuilderOpen(true),
      content: (
        <AssetBuilderPanel
          key={`${assetBuilderTarget.kind}:${assetBuilderTarget.asset_id ?? "new"}:${assetBuilderTarget.draft_id ?? "draft"}`}
          target={assetBuilderTarget}
          onTargetChange={onAssetBuilderTargetChange}
        />
      ),
    };
  }
  return null;
}

function fullPageTitle(page: Exclude<FullPage, null>, t: (key: string) => string) {
  if (page === "files") return t("shell.files");
  if (page === "assets") return t("assets.title");
  if (page === "scheduledTasks") return t("scheduledTasks.title");
  if (page === "memory") return t("workspace.memories");
  if (page === "resources") return t("workspace.resources");
  if (page === "settings") return t("workspace.roomDetails");
  return t("workspace.admin");
}
