import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetKind } from "@fields/contracts/public/asset";
import { DraggablePanel, Flexbox, Icon, Layout, Menu, type ItemType } from "@lobehub/ui";
import {
  Button,
  DropdownMenu,
  Input,
  Modal,
  TabsIndicator,
  TabsList,
  TabsRoot,
  TabsTab,
  Tooltip,
  tabsStyles,
  type DropdownItem,
} from "@lobehub/ui/base-ui";
import {
  ChevronLeft,
  Clock3,
  Files,
  Globe2,
  Home,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail as MailIcon,
  MessagesSquare,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  Search,
  Server,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Boxes } from "lucide-react";

import appMark from "../../assets/brand/fields-app-mark-dark.png";
import { SidePanelResizeHandle } from "./SidePanelResizeHandle";
import { isDesktopSearchShortcut } from "./desktop-chrome";
import {
  calculateSidePanelMaxWidth,
  LEFT_SIDE_PANEL_DEFAULT_WIDTH,
  LEFT_SIDE_PANEL_MAX_WIDTH,
  LEFT_SIDE_PANEL_MIN_WIDTH,
  RIGHT_SIDE_PANEL_DEFAULT_WIDTH,
  RIGHT_SIDE_PANEL_MAX_WIDTH,
  RIGHT_SIDE_PANEL_MIN_WIDTH,
} from "./side-panel-sizing";

export type OverlayKind = "search" | null;
export type FullPage = "memory" | "resources" | "settings" | "admin" | "assets" | "browser" | "files" | "mail" | "scheduledTasks" | null;
export type GlobalRailRoomItem = { id: string; title: string; subtitle: string; active?: boolean };
export type GlobalRailAccount = {
  displayName: string;
  email: string;
  menu: { isOpen: boolean; open: () => void; close: () => void };
  openSettings: () => void;
  executorSetup: { incomplete: boolean; open: () => void };
  logout: () => void;
};
export type MainWorkspacePanelSlot = {
  open: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  content: ReactNode;
  tabs?: MainWorkspaceSidePanelTabsSlot;
};
export type MainWorkspaceOverlaySlot = { open: boolean; onOpenChange: (open: boolean) => void; content?: ReactNode };
export type MainWorkspaceSidePanelTabItem = { value: string; label: string; disabled?: boolean };
export type MainWorkspaceSidePanelTabsSlot = {
  value: string;
  items: MainWorkspaceSidePanelTabItem[];
  onValueChange: (value: string) => void;
  actions?: ReactNode;
  ariaLabel?: string;
};
export type MainWorkspaceCanvasTabItem = { value: string; label: string; disabled?: boolean };
export type MainWorkspaceCanvasTabsSlot = {
  value: string;
  items: MainWorkspaceCanvasTabItem[];
  onValueChange: (value: string) => void;
  ariaLabel?: string;
};
export type MainWorkspaceCanvasContent = { value: string; content: ReactNode; forceMount?: boolean };
export type MainWorkspaceCanvasSlot = MainWorkspaceCanvasTabsSlot & { contents: MainWorkspaceCanvasContent[] };
export type MainWorkspaceHeaderSlot = { title?: string | null; subtitle?: string | null; center?: ReactNode; actions?: ReactNode };
export type MainWorkspaceProps = {
  header?: MainWorkspaceHeaderSlot | null;
  canvas?: MainWorkspaceCanvasSlot | null;
  leftPanel: MainWorkspacePanelSlot | null;
  focusStage: ReactNode;
  rightPanel: MainWorkspacePanelSlot | null;
  overlay: MainWorkspaceOverlaySlot;
  hidden?: boolean;
};

const border = "1px solid var(--ant-color-border-secondary)";
const muted = "var(--ant-color-text-secondary)";
const railStyle: CSSProperties = {
  background: "var(--fields-color-ink)",
  borderRight: "1px solid var(--fields-color-border)",
  color: "var(--fields-color-surface-soft)",
  height: "100%",
  position: "relative",
  zIndex: 50,
};

export function AppShell({ children, onSearch }: { children: ReactNode; onSearch?: () => void }) {
  return (
    <Flexbox className="fields-window-surface">
      <DesktopTitleBar onSearch={onSearch} />
      <Flexbox horizontal flex={1} style={{ background: "var(--ant-color-bg-layout)", minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative", width: "100%" }}>
        {children}
      </Flexbox>
    </Flexbox>
  );
}

export function DesktopTitleBar({ onSearch }: { onSearch?: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!onSearch) return;
    const openSearch = (event: KeyboardEvent) => {
      if (!isDesktopSearchShortcut(event)) return;
      event.preventDefault();
      onSearch();
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [onSearch]);

  return (
    <header aria-label={t("shell.desktopTitleBar")} className="fields-desktop-titlebar">
      <div className="fields-desktop-titlebar__safe-area">
        <div className="fields-desktop-titlebar__brand">
          <img alt="Fields" src={appMark} />
        </div>
        <div className="fields-desktop-titlebar__drag-region">
          {onSearch ? (
            <Button
              aria-label={t("shell.searchWorkspace")}
              className="fields-desktop-titlebar__search"
              icon={<Search size={14} />}
              onClick={onSearch}
              type="text"
            >
              <span className="fields-desktop-titlebar__search-content">
                <span>{t("shell.searchWorkspace")}</span>
                <kbd>Ctrl K</kbd>
              </span>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function MainWorkspace({ header, canvas, leftPanel, focusStage, rightPanel, overlay, hidden = false }: MainWorkspaceProps) {
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_SIDE_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_SIDE_PANEL_DEFAULT_WIDTH);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const leftMax = calculateSidePanelMaxWidth({ workspaceWidth, oppositePanelOpen: Boolean(rightPanel?.open), oppositePanelWidth: rightPanelWidth, minValue: LEFT_SIDE_PANEL_MIN_WIDTH, maxValue: LEFT_SIDE_PANEL_MAX_WIDTH });
  const rightMax = calculateSidePanelMaxWidth({ workspaceWidth, oppositePanelOpen: Boolean(leftPanel?.open), oppositePanelWidth: leftPanelWidth, minValue: RIGHT_SIDE_PANEL_MIN_WIDTH, maxValue: RIGHT_SIDE_PANEL_MAX_WIDTH });
  const currentCanvas = canvas?.contents.filter((entry) => entry.forceMount || entry.value === canvas.value) ?? [];
  const stage = canvas ? currentCanvas.map((entry) => <div key={entry.value} style={{ display: entry.value === canvas.value ? "flex" : "none", flex: 1, minHeight: 0, minWidth: 0 }}>{entry.content}</div>) : focusStage;

  return (
    <section
      aria-hidden={hidden || undefined}
      ref={(node) => {
        if (!node) return;
        const update = () => setWorkspaceWidth(node.getBoundingClientRect().width);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
      }}
      style={{ display: hidden ? "none" : "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative" }}
    >
      {header || canvas || leftPanel || rightPanel ? <WorkspaceHeader header={header} canvas={canvas} leftPanel={leftPanel} rightPanel={rightPanel} /> : null}
      <Flexbox horizontal flex={1} style={{ minHeight: 0, minWidth: 0 }}>
        {leftPanel ? (
          <DraggablePanel
            backgroundColor="var(--ant-color-bg-container)"
            expand={leftPanel.open}
            maxWidth={leftMax}
            minWidth={LEFT_SIDE_PANEL_MIN_WIDTH}
            placement="left"
            size={{ height: "100%", width: leftPanelWidth }}
            stableLayout
            style={{ height: "100%" }}
            onExpandChange={(open) => open ? leftPanel.onExpand() : leftPanel.onCollapse()}
            onSizeChange={(_, size) => setLeftPanelWidth(panelWidthFromSize(size?.width, leftPanelWidth, LEFT_SIDE_PANEL_MIN_WIDTH, leftMax))}
          >
            <LeftSidePanel tabs={leftPanel.tabs}>
              {leftPanel.content}
              {leftPanel.open ? <SidePanelResizeHandle side="left" value={leftPanelWidth} minValue={LEFT_SIDE_PANEL_MIN_WIDTH} maxValue={leftMax} onChange={setLeftPanelWidth} /> : null}
            </LeftSidePanel>
          </DraggablePanel>
        ) : null}
        <FocusStage>{stage}</FocusStage>
        {rightPanel ? (
          <DraggablePanel
            backgroundColor="var(--ant-color-bg-container)"
            expand={rightPanel.open}
            maxWidth={rightMax}
            minWidth={RIGHT_SIDE_PANEL_MIN_WIDTH}
            placement="right"
            size={{ height: "100%", width: rightPanelWidth }}
            stableLayout
            style={{ height: "100%" }}
            onExpandChange={(open) => open ? rightPanel.onExpand() : rightPanel.onCollapse()}
            onSizeChange={(_, size) => setRightPanelWidth(panelWidthFromSize(size?.width, rightPanelWidth, RIGHT_SIDE_PANEL_MIN_WIDTH, rightMax))}
          >
            <RightSidePanel tabs={rightPanel.tabs}>
              {rightPanel.content}
              {rightPanel.open ? <SidePanelResizeHandle side="right" value={rightPanelWidth} minValue={RIGHT_SIDE_PANEL_MIN_WIDTH} maxValue={rightMax} onChange={setRightPanelWidth} /> : null}
            </RightSidePanel>
          </DraggablePanel>
        ) : null}
      </Flexbox>
      <OverlayLayer open={overlay.open} onOpenChange={overlay.onOpenChange}>{overlay.content}</OverlayLayer>
    </section>
  );
}

export function WorkspaceHeader({ header, canvas, leftPanel, rightPanel }: { header?: MainWorkspaceHeaderSlot | null; canvas?: MainWorkspaceCanvasSlot | null; leftPanel: MainWorkspacePanelSlot | null; rightPanel: MainWorkspacePanelSlot | null }) {
  return (
    <header style={{ alignItems: "center", borderBottom: border, display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", minHeight: 44, padding: "0 12px" }}>
      <div style={{ alignItems: "center", display: "flex", gap: 8, minWidth: 0 }}>
        {leftPanel ? <PanelToggle side="left" active={leftPanel.open} onClick={() => togglePanel(leftPanel)} /> : null}
        {header?.title || header?.subtitle ? <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{header.title}</div>{header.subtitle ? <div style={{ color: muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{header.subtitle}</div> : null}</div> : null}
      </div>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "center", minWidth: 0 }}>{canvas ? <WorkspaceCanvasTabs slot={canvas} /> : null}{header?.center}</div>
      <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "flex-end", minWidth: 0 }}>{header?.actions}{rightPanel ? <PanelToggle side="right" active={rightPanel.open} onClick={() => togglePanel(rightPanel)} /> : null}</div>
    </header>
  );
}

export function WorkspaceCanvasTabs({ slot }: { slot: MainWorkspaceCanvasTabsSlot }) {
  if (slot.items.length === 0) return null;
  return <WorkspaceTabs ariaLabel={slot.ariaLabel} items={slot.items} onValueChange={slot.onValueChange} value={slot.value} />;
}

export function FocusStage({ children }: { children: ReactNode }) {
  return <Layout.Main style={{ background: "var(--ant-color-bg-layout)", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>{children}</Layout.Main>;
}

export function GlobalRail({ active, browserEnabled = false, roomsOpen, assetsOpen, assetKind, rooms, onCollapse, onHome, onBrowser, onRooms, onScheduledTasks, onAssetsOpenChange, onAssetKind, onCreateRoom, onSelectRoom, onMembers, onFiles, onMail, onSearch, account }: {
  active: string | null; browserEnabled?: boolean; roomsOpen: boolean; assetsOpen: boolean; assetKind: AssetKind; rooms?: GlobalRailRoomItem[]; onCollapse: () => void; onHome: () => void; onBrowser: () => void; onRooms: () => void; onScheduledTasks: () => void; onAssetsOpenChange: (open: boolean) => void; onAssetKind: (kind: AssetKind) => void; onCreateRoom?: () => void; onSelectRoom?: (roomId: string) => void; onMembers: () => void; onFiles: () => void; onMail: () => void; onSearch: () => void; account: GlobalRailAccount;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const width = expanded ? 232 : 64;
  const items = useMemo<ItemType[]>(() => [
    { icon: Search, key: "search", label: t("common.search") },
    { type: "divider" },
    { icon: Home, key: "home", label: t("shell.home") },
    ...(browserEnabled ? [{ icon: Globe2, key: "browser", label: t("shell.browser") }] : []),
    { icon: MessagesSquare, key: "rooms", label: t("shell.rooms") },
    { icon: Users, key: "members", label: t("shell.members") },
    { icon: Files, key: "files", label: t("shell.files") },
    { icon: MailIcon, key: "mail", label: t("shell.mail") },
    { icon: Clock3, key: "scheduledTasks", label: t("shell.scheduledTasks") },
    {
      children: [
        { icon: Puzzle, key: "asset:plugin", label: t("assets.kinds.plugin") },
        { icon: Sparkles, key: "asset:skill", label: t("assets.kinds.skill") },
        { icon: Server, key: "asset:mcp", label: t("assets.kinds.mcp") },
      ],
      icon: Boxes,
      key: "assets",
      label: t("shell.assets"),
    },
  ], [browserEnabled, t]);
  const selectedKeys = active === "assets"
    ? [`asset:${assetKind}`]
    : active && ["search", "home", "browser", "rooms", "members", "files", "mail", "scheduledTasks"].includes(active)
      ? [active]
      : [];
  return (
    <div style={{ background: railStyle.background, height: "100%", minWidth: 64, position: "relative", width: 64, zIndex: 60 }}>
      <nav aria-label={t("shell.navigation")} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setExpanded(false); onCollapse(); } }} onFocus={() => setExpanded(true)} onMouseEnter={() => setExpanded(true)} onMouseLeave={() => { setExpanded(false); onCollapse(); }} style={{ ...railStyle, boxShadow: expanded ? "var(--ant-box-shadow-secondary)" : "none", left: 0, minWidth: width, position: "absolute", top: 0, transition: "width 160ms ease, min-width 160ms ease, box-shadow 160ms ease", width }}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", padding: "8px 12px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Menu
              className="fields-global-rail-menu"
              inlineCollapsed={!expanded}
              items={items}
              mode="inline"
              openKeys={assetsOpen ? ["assets"] : []}
              selectedKeys={selectedKeys}
              style={{ width: expanded ? 208 : 40 }}
              onClick={({ key }) => {
                if (!key.startsWith("asset:")) onAssetsOpenChange(false);
                if (key === "search") onSearch();
                else if (key === "home") onHome();
                else if (key === "browser") onBrowser();
                else if (key === "rooms") {
                  setExpanded(true);
                  onRooms();
                } else if (key === "members") onMembers();
                else if (key === "files") onFiles();
                else if (key === "mail") onMail();
                else if (key === "scheduledTasks") onScheduledTasks();
                else if (key.startsWith("asset:")) {
                  onAssetKind(key.slice("asset:".length) as AssetKind);
                }
              }}
              onOpenChange={(keys) => onAssetsOpenChange(keys.includes("assets"))}
            />
          </div>
          <AccountRailEntry active={active === "account"} expanded={expanded} account={account} />
        </div>
        {roomsOpen ? <RoomsMenu railWidth={width} rooms={rooms} onCreateRoom={onCreateRoom} onSelectRoom={onSelectRoom} /> : null}
      </nav>
    </div>
  );
}

function AccountRailEntry({ expanded, active, account }: { expanded: boolean; active: boolean; account: GlobalRailAccount }) {
  const { t } = useTranslation();
  const items = useMemo<DropdownItem[]>(() => [
    ...(account.executorSetup.incomplete ? [{
      icon: KeyRound,
      key: "executor",
      label: t("shell.completeExecutorSetup"),
      onClick: () => { account.menu.close(); account.executorSetup.open(); },
    }] : []),
    { icon: Settings, key: "settings", label: t("shell.accountSettings"), onClick: () => { account.menu.close(); account.openSettings(); } },
    { icon: LogOut, key: "logout", label: t("auth.logOut"), onClick: () => { account.menu.close(); account.logout(); } },
  ], [account, t]);
  return (
    <DropdownMenu
      header={<div style={{ minWidth: 240, padding: "4px 8px" }}><div style={{ fontWeight: 800 }}>{account.displayName}</div><div style={{ color: muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.email}</div></div>}
      items={items}
      nativeButton
      onOpenChange={(open) => open ? account.menu.open() : account.menu.close()}
      open={account.menu.isOpen}
      placement="topRight"
      trigger="click"
    >
      <Button aria-label={t("shell.accountMenu")} style={railButtonStyle(expanded, active || account.menu.isOpen)} type="text">
        <span style={{ alignItems: "center", background: "var(--fields-color-primary)", borderRadius: "50%", display: "flex", fontSize: 11, fontWeight: 900, height: 28, justifyContent: "center", minWidth: 28, position: "relative", width: 28 }}>{accountMark(account.displayName)}{account.executorSetup.incomplete ? <i style={{ background: "var(--fields-color-primary)", border: "1px solid var(--fields-color-ink)", borderRadius: "50%", height: 9, position: "absolute", right: -3, top: -3, width: 9 }} /> : null}</span>
        {expanded ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span> : null}
      </Button>
    </DropdownMenu>
  );
}

function accountMark(displayName: string): string { const words = displayName.trim().split(/\s+/u).filter(Boolean); return words.length === 0 ? "N" : words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join(""); }

function RoomsMenu({ railWidth, rooms = [], onCreateRoom, onSelectRoom }: { railWidth: number; rooms?: GlobalRailRoomItem[]; onCreateRoom?: () => void; onSelectRoom?: (roomId: string) => void }) {
  const { t } = useTranslation();
  return <aside style={{ background: "var(--ant-color-bg-container)", borderRight: border, boxShadow: "var(--ant-box-shadow-secondary)", color: "var(--ant-color-text)", height: "100%", left: railWidth, padding: 12, position: "absolute", top: 0, width: 304, zIndex: 80 }}><Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 8 }}><strong style={{ color: "var(--ant-color-text)", fontSize: 18 }}>{t("shell.rooms")}</strong><Tooltip title={t("shell.createRoom")}><Button aria-label={t("shell.createRoom")} disabled={!onCreateRoom} icon={<Plus size={16} />} onClick={onCreateRoom} shape="circle" size="small" type="text" /></Tooltip></Flexbox><Flexbox gap={4}>{rooms.map((room) => <Button block key={room.id} onClick={() => onSelectRoom?.(room.id)} style={{ alignItems: "stretch", border: room.active ? "1px solid var(--ant-color-primary-border)" : "1px solid transparent", flexDirection: "column", height: "auto", padding: 8, textAlign: "left" }} type={room.active ? "fill" : "text"}><div style={{ fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.title}</div><div style={{ color: muted, fontSize: 12, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.subtitle}</div></Button>)}</Flexbox></aside>;
}

export function LeftSidePanel({ tabs, children }: { tabs?: MainWorkspaceSidePanelTabsSlot; children?: ReactNode }) {
  return <Flexbox style={{ background: "var(--ant-color-bg-container)", height: "100%", minHeight: 0, minWidth: 0, position: "relative" }}>{tabs ? <SidePanelTabs slot={tabs} /> : null}<div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div></Flexbox>;
}

export function RightSidePanel({ tabs, children }: { tabs?: MainWorkspaceSidePanelTabsSlot; children?: ReactNode }) {
  return <Flexbox style={{ background: "var(--ant-color-bg-container)", height: "100%", minHeight: 0, minWidth: 0, position: "relative" }}>{tabs ? <SidePanelTabs slot={tabs} /> : null}<div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div></Flexbox>;
}

export function SidePanelTabs({ slot }: { slot: MainWorkspaceSidePanelTabsSlot }) {
  if (slot.items.length === 0 && !slot.actions) return null;
  return <Flexbox horizontal align="center" style={{ borderBottom: border, minHeight: 42, padding: "0 12px" }}>{slot.items.length > 0 ? <WorkspaceTabs ariaLabel={slot.ariaLabel} flex items={slot.items} onValueChange={slot.onValueChange} value={slot.value} /> : <span style={{ flex: 1 }} />}{slot.actions ? <Flexbox horizontal align="center" gap={4}>{slot.actions}</Flexbox> : null}</Flexbox>;
}

export function StagePageShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return <div style={{ background: "var(--ant-color-bg-layout)", display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}><header style={{ alignItems: "center", borderBottom: border, display: "flex", gap: 8, minHeight: 60, padding: "0 14px" }}><Tooltip title={t("shell.backToRoom")}><Button aria-label={t("shell.backToRoom")} icon={<ChevronLeft size={18} />} onClick={onBack} shape="circle" size="small" type="text" /></Tooltip><strong style={{ fontSize: 18 }}>{title}</strong></header><div style={{ display: "flex", flex: 1, minHeight: 0 }}>{children}</div></div>;
}

export function OverlayLayer({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return <Modal centered closable={false} destroyOnHidden draggable={false} footer={null} height="min(760px, calc(100vh - 48px))" open={open} styles={{ body: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0 } }} title={<Flexbox horizontal align="center" justify="space-between"><strong>{t("common.search")}</strong><Tooltip title={t("shell.closeSearch")}><Button aria-label={t("shell.closeSearch")} icon={<X size={16} />} onClick={() => onOpenChange(false)} shape="circle" size="small" type="text" /></Tooltip></Flexbox>} width="min(880px, calc(100vw - 48px))" onCancel={() => onOpenChange(false)}>{children ?? <><Input placeholder={t("shell.searchWorkspace")} /><StagePlaceholder compact title={t("shell.searchResults")} /></>}</Modal>;
}

export function GlobalLoadingOverlay({ open }: { open: boolean }) { const { t } = useTranslation(); return open ? <Flexbox align="center" aria-live="polite" gap={8} justify="center" style={{ background: "color-mix(in srgb, var(--ant-color-bg-container) 92%, transparent)", inset: 0, position: "absolute", zIndex: 1000 }}><Icon icon={LoaderCircle} spin /><span>{t("shell.loading")}</span></Flexbox> : null; }

export function StagePlaceholder({ title, compact = false }: { title: string; compact?: boolean }) { const { t } = useTranslation(); return <div style={{ alignItems: "center", color: muted, display: "flex", flex: 1, justifyContent: "center", minHeight: compact ? 140 : 0, padding: 16, textAlign: "center" }}>{t("shell.placeholder", { title })}</div>; }

function railButtonStyle(expanded: boolean, active?: boolean): CSSProperties { const width = expanded ? 208 : 40; return { alignItems: "center", background: active ? "var(--fields-color-primary)" : "transparent", border: active ? "1px solid var(--fields-color-primary)" : "1px solid transparent", borderRadius: 8, color: "var(--fields-color-surface-soft)", cursor: "pointer", display: "flex", font: "inherit", fontSize: 13, fontWeight: 800, gap: expanded ? 10 : 0, height: 40, justifyContent: expanded ? "flex-start" : "center", maxWidth: width, minWidth: width, overflow: "hidden", padding: expanded ? "0 10px" : 0, width }; }
function PanelToggle({ side, active, onClick }: { side: "left" | "right"; active: boolean; onClick: () => void }) { const { t } = useTranslation(); const label = side === "left" ? active ? t("shell.collapseLeftSidePanel") : t("shell.expandLeftSidePanel") : active ? t("shell.collapseSidePanel") : t("shell.expandSidePanel"); return <Tooltip title={label}><Button aria-label={label} icon={side === "left" ? <PanelLeft size={18} /> : <PanelRight size={18} />} onClick={onClick} shape="circle" size="small" type="text" /></Tooltip>; }
function togglePanel(panel: MainWorkspacePanelSlot) { if (panel.open) panel.onCollapse(); else panel.onExpand(); }
function panelWidthFromSize(value: number | string | undefined, fallback: number, minValue: number, maxValue: number): number {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : fallback;
  return Math.min(Math.max(Number.isFinite(numericValue) ? numericValue : fallback, minValue), maxValue);
}
function WorkspaceTabs({ ariaLabel, flex = false, items, onValueChange, value }: {
  ariaLabel?: string;
  flex?: boolean;
  items: MainWorkspaceSidePanelTabItem[];
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <TabsRoot className={tabsStyles.root} size="small" style={{ flex: flex ? 1 : undefined, minWidth: 0, width: "auto" }} value={value} variant="square" onValueChange={(nextValue) => { if (nextValue) onValueChange(nextValue); }}>
      <TabsList aria-label={ariaLabel}>
        <TabsIndicator />
        {items.map((item) => <TabsTab disabled={item.disabled} key={item.value} value={item.value}>{item.label}</TabsTab>)}
      </TabsList>
    </TabsRoot>
  );
}
