import { Empty, Skeleton } from "@lobehub/ui";
import { ChatHeader, ChatHeaderTitle } from "@lobehub/ui/mobile";
import { Button, Input } from "@lobehub/ui/base-ui";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

import type { HomeMachineController } from "../features/home";
import type { RoomController } from "../features/room";
import { translateMessage } from "../shared/i18n";
import { mobileHomeRow, mobileRoomRow, type MobileConversationRow } from "./adapters";

export function MobileHomeList({ home, homeAvailable, onNew, onSelect }: {
  home: HomeMachineController;
  homeAvailable: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const threads = home.rightPanel.threads;
  const error = translateMessage(t, threads.error);
  return (
    <section className="fields-mobile-screen">
      <ChatHeader
        center={<ChatHeaderTitle title={t("shell.home")} />}
        right={<Button aria-label={t("workspace.newChat")} disabled={!homeAvailable} icon={<Plus size={18} />} onClick={onNew} shape="circle" type="text" />}
      />
      {!homeAvailable ? <div className="fields-mobile-home-unavailable" role="status">{t("mobile.homeExecutorRequired")}</div> : null}
      <div className="fields-mobile-filter-strip" role="tablist">
        <Button className={!home.rightPanel.projects.selectedId ? "is-active" : ""} onClick={() => home.rightPanel.projects.select(null)} size="small" type="text">{t("home.allChats")}</Button>
        {home.rightPanel.projects.items.map((project) => (
          <Button className={home.rightPanel.projects.selectedId === project.project_id ? "is-active" : ""} key={project.project_id} onClick={() => home.rightPanel.projects.select(project.project_id)} size="small" type="text">{project.name}</Button>
        ))}
      </div>
      <div className="fields-mobile-search">
        <Search aria-hidden size={16} />
        <Input
          aria-label={t("common.search")}
          onChange={(event) => home.rightPanel.threads.search.setDraft(event.target.value)}
          onFocus={home.rightPanel.threads.search.open}
          placeholder={t("common.search")}
          value={home.rightPanel.threads.search.draft}
          variant="borderless"
        />
        {home.rightPanel.threads.search.draft ? <Button aria-label={t("shell.closeSearch")} icon={<X size={15} />} onClick={() => home.rightPanel.threads.search.setDraft("")} shape="circle" size="small" type="text" /> : null}
      </div>
      <MobileRows
        emptyAction={homeAvailable ? onNew : home.rightPanel.threads.refresh}
        emptyActionLabel={homeAvailable ? t("workspace.newChat") : t("common.refresh")}
        emptyLabel={t("home.noSessions")}
        error={error}
        hasMore={threads.hasMore}
        items={threads.items.map(mobileHomeRow)}
        loading={threads.loading}
        loadingMore={threads.loadingMore}
        onLoadMore={threads.loadMore}
        onRefresh={threads.refresh}
        onSelect={onSelect}
      />
    </section>
  );
}

export function MobileRoomsList({ room, onSelect }: {
  room: RoomController;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => room.rooms.search(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [room.rooms.search, search]);
  return (
    <section className="fields-mobile-screen">
      <ChatHeader center={<ChatHeaderTitle title={t("shell.rooms")} />} />
      <div className="fields-mobile-search">
        <Search aria-hidden size={16} />
        <Input aria-label={t("common.search")} onChange={(event) => setSearch(event.target.value)} placeholder={t("common.search")} value={search} variant="borderless" />
        {search ? <Button aria-label={t("shell.closeSearch")} icon={<X size={15} />} onClick={() => setSearch("")} shape="circle" size="small" type="text" /> : null}
      </div>
      <MobileRows
        emptyAction={room.rooms.refresh}
        emptyActionLabel={t("common.refresh")}
        emptyLabel={t("mobile.noRooms")}
        error={translateMessage(t, room.rooms.error)}
        hasMore={room.rooms.hasMore}
        items={room.rooms.items.map(mobileRoomRow)}
        loading={room.rooms.loading}
        loadingMore={room.rooms.loading && room.rooms.items.length > 0}
        onLoadMore={room.rooms.loadMore}
        onRefresh={room.rooms.refresh}
        onSelect={onSelect}
      />
    </section>
  );
}

function MobileRows({ items, loading, loadingMore, error, hasMore, emptyLabel, emptyActionLabel, emptyAction, onRefresh, onLoadMore, onSelect }: {
  items: MobileConversationRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  emptyLabel: string;
  emptyActionLabel: string;
  emptyAction: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (loading && items.length === 0) return <div className="fields-mobile-list-skeleton"><Skeleton active paragraph={{ rows: 7 }} title={false} /></div>;
  if (error && items.length === 0) return <MobileListState action={onRefresh} actionLabel={t("common.retry")} label={error} tone="error" />;
  if (!loading && items.length === 0) return <MobileListState action={emptyAction} actionLabel={emptyActionLabel} label={emptyLabel} />;
  return (
    <div className="fields-mobile-list-wrap">
      {error ? <div className="fields-mobile-inline-error" role="alert"><span>{error}</span><Button aria-label={t("common.retry")} icon={<RefreshCw size={15} />} onClick={onRefresh} shape="circle" size="small" type="text" /></div> : null}
      <div className="fields-mobile-list" role="list">
        {items.map((item) => <MobileRow item={item} key={item.id} onClick={() => onSelect(item.id)} />)}
      </div>
      {hasMore ? <Button block disabled={loadingMore} loading={loadingMore} onClick={onLoadMore} type="text">{t("common.continue")}</Button> : null}
    </div>
  );
}

function MobileRow({ item, onClick }: { item: MobileConversationRow; onClick: () => void }) {
  return (
    <button className="fields-mobile-row" onClick={onClick} role="listitem" type="button">
      <span className="fields-mobile-row-copy"><strong>{item.title}</strong>{item.preview ? <span>{item.preview}</span> : null}</span>
      <span className="fields-mobile-row-meta"><time>{item.meta}</time>{item.unreadCount > 0 ? <b aria-label={String(item.unreadCount)}>{item.unreadCount}</b> : null}</span>
    </button>
  );
}

function MobileListState({ label, actionLabel, action, tone = "empty" }: { label: string; actionLabel: string; action: () => void; tone?: "empty" | "error" }) {
  return <div className={`fields-mobile-state is-${tone}`}><Empty description={label} imageSize={48} /><Button onClick={action} type="primary">{actionLabel}</Button></div>;
}
