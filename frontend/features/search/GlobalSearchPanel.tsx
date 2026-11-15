import type {
  GlobalSearchResult,
  SearchResultGroup,
  SearchResultItem,
  SearchResultKind,
} from "@fields/contracts/public/search";
import { Empty, Flexbox, List, ScrollArea, SearchBar, Skeleton, Text, type ListItemProps } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { searchResultPreviewText } from "./search-result-presentation";

export type GlobalSearchPanelProps = {
  onRoom: (roomId: string) => void;
  onMember: (actorId: string) => void;
  onHomeThread: (threadId: string) => void;
  onMessage: (roomId: string, messageId: string) => void;
  onHomeFile: (path: string) => void;
  onCompanyFile: (fileId: string) => void;
  onAsset: (assetId: string, kind: "plugin" | "skill" | "mcp") => void;
  onEmail: (mailboxId: string, folderId: string, messageId: string) => void;
  isItemSelectable?: (item: SearchResultItem) => boolean;
  onSelectItem?: (item: SearchResultItem) => void;
};

export function GlobalSearchPanel(props: GlobalSearchPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState<SearchResultKind | null>(null);
  const [collapsedKinds, setCollapsedKinds] = useState<Set<SearchResultKind>>(() => new Set());
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  async function submit(value = draft) {
    const query = value.trim();
    if (!query) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const next = await backendTrpc.search.query.query({ search_term: query });
      if (requestId.current === id) { setResult(next); setCollapsedKinds(new Set()); }
    } catch { if (requestId.current === id) setError(true); }
    finally { if (requestId.current === id) setLoading(false); }
  }

  async function loadMore(group: SearchResultGroup) {
    if (!result || !group.page.next_cursor) return;
    const id = ++requestId.current;
    setLoadingKind(group.kind);
    try {
      const next = await backendTrpc.search.query.query({ search_term: result.query, kind: group.kind, cursor: group.page.next_cursor });
      if (requestId.current !== id || !next.groups[0]) return;
      const nextGroup = next.groups[0];
      setResult({ ...result, coverage: next.coverage, groups: result.groups.map((current) => current.kind === group.kind ? { ...nextGroup, items: [...current.items, ...nextGroup.items] } : current) });
    } finally { if (requestId.current === id) setLoadingKind(null); }
  }

  function toggleGroup(kind: SearchResultKind) {
    setCollapsedKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <Flexbox flex={1} gap={12} style={{ minHeight: 0 }}>
      <SearchBar
        autoFocus
        loading={loading}
        onInputChange={setDraft}
        onSearch={(value) => void submit(value)}
        placeholder={t("shell.searchWorkspace")}
        value={draft}
      />
      {loading ? (
        <SearchState><Skeleton active paragraph={{ rows: 5 }} title={false} width="100%" /></SearchState>
      ) : error ? (
        <SearchState><Empty description={t("search.failed")} /></SearchState>
      ) : result ? (
        <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
          <Flexbox gap={12} paddingBlock="0 8px">
            <Coverage result={result} />
            {result.groups.map((group) => (
              <SearchGroup
                collapsed={collapsedKinds.has(group.kind)}
                group={props.isItemSelectable ? {
                  ...group,
                  items: group.items.filter(props.isItemSelectable),
                } : group}
                key={group.kind}
                loadingKind={loadingKind}
                onLoadMore={() => void loadMore(group)}
                onOpen={(item) => {
                  if (props.onSelectItem) props.onSelectItem(item);
                  else openItem(item, props);
                }}
                onToggle={() => toggleGroup(group.kind)}
              />
            ))}
          </Flexbox>
        </ScrollArea>
      ) : (
        <SearchState><Empty description={t("search.enterToSearch")} /></SearchState>
      )}
    </Flexbox>
  );
}

function SearchGroup({
  collapsed,
  group,
  loadingKind,
  onLoadMore,
  onOpen,
  onToggle,
}: {
  collapsed: boolean;
  group: SearchResultGroup;
  loadingKind: SearchResultKind | null;
  onLoadMore: () => void;
  onOpen: (item: SearchResultItem) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const items: ListItemProps[] = group.items.map((item) => ({
    avatar: <span aria-hidden />,
    description: searchItemSummary(item, t),
    key: searchItemKey(item),
    onClick: () => onOpen(item),
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(item);
      }
    },
    role: "button",
    style: { minHeight: 48, padding: "8px 4px" },
    tabIndex: 0,
    title: searchItemTitle(item),
  }));

  return (
    <section>
      <Button
        aria-expanded={!collapsed}
        block
        icon={collapsed ? ChevronRight : ChevronDown}
        onClick={onToggle}
        size="small"
        style={{ justifyContent: "flex-start" }}
        type="text"
      >
        {t(`search.groups.${group.kind}`)}
      </Button>
      {collapsed ? null : (
        <Flexbox>
          {items.length === 0 ? (
            <Text fontSize={12} style={{ padding: 8 }} type="secondary">{t("search.noResults")}</Text>
          ) : (
            <List items={items} padding={0} />
          )}
          {group.page.next_cursor ? (
            <Button
              disabled={loadingKind !== null}
              loading={loadingKind === group.kind}
              onClick={onLoadMore}
              size="small"
              type="link"
            >
              {t("search.more")}
            </Button>
          ) : null}
        </Flexbox>
      )}
    </section>
  );
}

function Coverage({ result }: { result: GlobalSearchResult }) {
  const { t } = useTranslation();
  const coverage = result.coverage;
  const partiallySearched = coverage.searched_room_count < coverage.visible_room_count;
  const emailLimited = coverage.email.partial
    || coverage.email.failed_mailbox_ids.length > 0
    || coverage.email.indexed_from_ms !== null;
  if (!partiallySearched && coverage.failed_sources.length === 0 && !emailLimited) return null;
  return (
    <Flexbox gap={2}>
      {partiallySearched || coverage.failed_sources.length > 0 ? <Text fontSize={12} type="secondary">{t("search.coverage", {
        failed: coverage.failed_sources.length,
        searched: coverage.searched_room_count,
        visible: coverage.visible_room_count,
      })}</Text> : null}
      {emailLimited ? <Text fontSize={12} type="secondary">{t("search.emailCoverage", {
        date: coverage.email.indexed_from_ms ? new Date(coverage.email.indexed_from_ms).toLocaleDateString() : t("search.unknownDate"),
        failed: coverage.email.failed_mailbox_ids.length,
      })}</Text> : null}
    </Flexbox>
  );
}

function SearchState({ children }: { children: React.ReactNode }) {
  return <Flexbox align="center" flex={1} justify="center" style={{ minHeight: 220 }}>{children}</Flexbox>;
}

function searchItemTitle(item: SearchResultItem): string { if (item.kind === "room") return item.title; if (item.kind === "member") return item.display_name; if (item.kind === "home_thread") return searchResultPreviewText(item.title ?? item.preview ?? item.thread_id); if (item.kind === "message") return `${item.sender_display_name} · ${item.room_title}`; if (item.kind === "email") return item.subject; return item.name; }
function searchItemSummary(item: SearchResultItem, t: (key: string) => string): string { if (item.kind === "room") return item.subtitle ?? ""; if (item.kind === "member") return item.email ?? item.mark; if (item.kind === "home_thread") return searchResultPreviewText(item.preview ?? ""); if (item.kind === "message") return searchResultPreviewText(item.body_plain_text); if (item.kind === "asset") return `${t(`assets.kinds.${item.asset_kind}`)} · ${item.current_version}`; if (item.kind === "email") return item.sender_name ?? item.sender_address ?? ""; return item.path; }
function searchItemKey(item: SearchResultItem): string { if (item.kind === "room") return `room:${item.room_id}`; if (item.kind === "member") return `member:${item.actor_id}`; if (item.kind === "home_thread") return `home:${item.thread_id}`; if (item.kind === "message") return `message:${item.room_id}:${item.message_id}`; if (item.kind === "asset") return `asset:${item.asset_id}`; if (item.kind === "email") return `email:${item.mailbox_id}:${item.folder_id}:${item.message_id}`; return item.source.type === "home" ? `file:home:${item.path}` : `file:company:${item.file_id ?? item.path}`; }
function openItem(item: SearchResultItem, props: GlobalSearchPanelProps): void { if (item.kind === "room") props.onRoom(item.room_id); else if (item.kind === "member") props.onMember(item.actor_id); else if (item.kind === "home_thread") props.onHomeThread(item.thread_id); else if (item.kind === "message") props.onMessage(item.room_id, item.message_id); else if (item.kind === "asset") props.onAsset(item.asset_id, item.asset_kind); else if (item.kind === "email") props.onEmail(item.mailbox_id, item.folder_id, item.message_id); else if (item.source.type === "home") props.onHomeFile(item.path); else if (item.file_id) props.onCompanyFile(item.file_id); }
