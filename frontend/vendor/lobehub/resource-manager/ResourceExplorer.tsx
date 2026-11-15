import { ActionIcon, Flexbox, Icon, Tag } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { createStyles } from "antd-style";
import { Dropdown, Empty, Input, Skeleton, Tooltip, type MenuProps } from "antd";
import dayjs from "dayjs";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  FileIcon,
  Files,
  Folder,
  FolderInput,
  FolderPlus,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

export type ResourceExplorerItem = {
  id: string;
  kind: "file" | "folder";
  mimeType?: string;
  name: string;
  sizeBytes?: number;
  thumbnailUrl?: string;
  updatedAtMs: number;
  uploader: string;
};

export type ResourceExplorerBreadcrumb = {
  id: string | null;
  name: string;
};

type ResourceExplorerProps = {
  breadcrumbs: ResourceExplorerBreadcrumb[];
  busy: boolean;
  canDelete: boolean;
  items: ResourceExplorerItem[];
  loading: boolean;
  onBatchDelete(ids: string[]): void;
  onBatchMove(ids: string[]): void;
  onCreateFolder(): void;
  onDelete(item: ResourceExplorerItem): void;
  onDownload(item: ResourceExplorerItem): void;
  onDropFiles(files: File[]): void;
  onMove(ids: string[], folderId: string | null): void;
  onNavigate(folderId: string | null): void;
  onOpen(item: ResourceExplorerItem): void;
  onRefresh(): void;
  onRename(item: ResourceExplorerItem): void;
  onSearch(value: string): void;
  onRequestThumbnail(item: ResourceExplorerItem): void;
  onShare?(item: ResourceExplorerItem): void;
  onUpload(): void;
  onUploadFolder(): void;
  onUploadVersion(item: ResourceExplorerItem): void;
  search: string;
  selectedIds: string[];
  setSelectedIds(ids: string[]): void;
  setSort(sort: "name-asc" | "name-desc" | "updated-desc"): void;
  setViewMode(mode: "list" | "masonry"): void;
  sort: "name-asc" | "name-desc" | "updated-desc";
  viewMode: "list" | "masonry";
};

const useStyles = createStyles(({ css, token }) => ({
  body: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  breadcrumb: css`
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  `,
  card: css`
    position: relative;
    display: flex;
    min-height: 172px;
    flex-direction: column;
    justify-content: space-between;
    padding: 16px;
    cursor: default;
    background: ${token.colorFillQuaternary};
    border: 1px solid transparent;
    border-radius: ${token.borderRadiusLG}px;
    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;

    &:hover {
      background: ${token.colorFillTertiary};
      transform: translateY(-1px);
    }

    &[data-selected="true"] {
      background: ${token.colorPrimaryBg};
      border-color: ${token.colorPrimaryBorder};
    }
  `,
  dropTarget: css`
    &[data-drop-target="true"] {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: -2px;
    }
  `,
  empty: css`
    display: grid;
    height: 100%;
    place-items: center;
  `,
  grid: css`
    display: grid;
    overflow: auto;
    height: 100%;
    padding: 16px 20px 28px;
    align-content: start;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 12px;
  `,
  header: css`
    display: flex;
    min-height: 64px;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  listHeader: css`
    display: grid;
    min-height: 40px;
    align-items: center;
    padding: 0 14px;
    color: ${token.colorTextSecondary};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    font-size: 12px;
    grid-template-columns: minmax(260px, 1fr) 160px 120px 150px 40px;
  `,
  row: css`
    display: grid;
    min-height: 54px;
    align-items: center;
    padding: 0 14px;
    cursor: default;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    grid-template-columns: minmax(260px, 1fr) 160px 120px 150px 40px;
    transition: background 140ms ease;

    &:hover {
      background: ${token.colorFillQuaternary};
    }

    &[data-selected="true"] {
      background: ${token.colorPrimaryBg};
    }
  `,
  title: css`
    overflow: hidden;
    color: ${token.colorText};
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  toolbar: css`
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
}));

export const ResourceExplorer = memo<ResourceExplorerProps>((props) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation();
  const sortedItems = useMemo(() => [...props.items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    if (props.sort === "updated-desc") return right.updatedAtMs - left.updatedAtMs;
    const comparison = left.name.localeCompare(right.name, undefined, { numeric: true });
    return props.sort === "name-desc" ? -comparison : comparison;
  }), [props.items, props.sort]);
  const selected = new Set(props.selectedIds);

  function select(item: ResourceExplorerItem, additive: boolean) {
    if (additive) {
      props.setSelectedIds(selected.has(item.id)
        ? props.selectedIds.filter((id) => id !== item.id)
        : [...props.selectedIds, item.id]);
      return;
    }
    props.setSelectedIds([item.id]);
  }

  function itemMenu(item: ResourceExplorerItem): MenuProps {
    const items: MenuProps["items"] = [
      { key: "open", label: item.kind === "folder" ? t("companyFiles.open") : t("companyFiles.preview"), icon: <FileIcon size={15} /> },
      { key: "rename", label: t("companyFiles.rename"), icon: <Pencil size={15} /> },
      { key: "move", label: t("companyFiles.moveTo"), icon: <FolderInput size={15} /> },
    ];
    if (item.kind === "file") {
      if (props.onShare) items.push({ key: "share", label: t("companyFiles.share"), icon: <Share2 size={15} /> });
      items.push(
        { key: "version", label: t("companyFiles.uploadVersion"), icon: <UploadCloud size={15} /> },
        { key: "download", label: t("companyFiles.download"), icon: <Download size={15} /> },
      );
    }
    if (props.canDelete) {
      items.push({ type: "divider" }, { danger: true, key: "delete", label: t("common.delete"), icon: <Trash2 size={15} /> });
    }
    return {
      items,
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === "open") props.onOpen(item);
        if (key === "rename") props.onRename(item);
        if (key === "move") props.onBatchMove([item.id]);
        if (key === "share") props.onShare?.(item);
        if (key === "version") props.onUploadVersion(item);
        if (key === "download") props.onDownload(item);
        if (key === "delete") props.onDelete(item);
      },
    };
  }

  const row = (item: ResourceExplorerItem) => (
    <div
      className={cx(styles.row, styles.dropTarget)}
      data-selected={selected.has(item.id)}
      draggable
      key={item.id}
      onClick={(event) => select(item, event.metaKey || event.ctrlKey)}
      onDoubleClick={() => props.onOpen(item)}
      onDragOver={(event) => {
        if (item.kind === "folder") event.preventDefault();
      }}
      onDrop={(event) => {
        if (item.kind !== "folder") return;
        event.preventDefault();
        const ids = event.dataTransfer.getData("application/x-fields-file-ids").split(",").filter(Boolean);
        if (ids.length > 0) props.onMove(ids, item.id);
      }}
      onDragStart={(event) => {
        const ids = selected.has(item.id) ? props.selectedIds : [item.id];
        event.dataTransfer.setData("application/x-fields-file-ids", ids.join(","));
      }}
    >
      <Flexbox align="center" gap={10} horizontal style={{ minWidth: 0 }}>
        <Icon icon={item.kind === "folder" ? Folder : Files} size={19} />
        <span className={styles.title}>{item.name}</span>
      </Flexbox>
      <span>{item.uploader}</span>
      <span>{item.kind === "file" ? formatBytes(item.sizeBytes ?? 0) : "—"}</span>
      <span>{dayjs(item.updatedAtMs).format("YYYY-MM-DD HH:mm")}</span>
      <Dropdown menu={itemMenu(item)} trigger={["click"]}>
        <ActionIcon
          aria-label={t("companyFiles.actionsNamed", { name: item.name })}
          icon={MoreHorizontal}
          onClick={(event) => event.stopPropagation()}
          size="small"
          title={t("companyFiles.actions")}
        />
      </Dropdown>
    </div>
  );

  return (
    <Flexbox flex={1} height="100%" style={{ minHeight: 0 }}>
      <header className={styles.header}>
        <nav className={styles.breadcrumb}>
          {props.breadcrumbs.map((breadcrumb, index) => (
            <Flexbox align="center" horizontal key={breadcrumb.id ?? "root"}>
              {index > 0 ? <span style={{ opacity: 0.45, padding: "0 2px" }}>/</span> : null}
              <Button
                onClick={() => props.onNavigate(breadcrumb.id)}
                size="small"
                type={index === props.breadcrumbs.length - 1 ? "text" : "link"}
              >
                {breadcrumb.name}
              </Button>
            </Flexbox>
          ))}
        </nav>
        <Input
          allowClear
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder={t("companyFiles.search")}
          prefix={<Search size={15} />}
          style={{ marginLeft: "auto", maxWidth: 280 }}
          value={props.search}
        />
        <Button disabled={props.busy} icon={<FolderPlus size={16} />} onClick={props.onCreateFolder}>
          {t("companyFiles.newFolder")}
        </Button>
        <Dropdown
          menu={{
            items: [
              { icon: <Upload size={15} />, key: "files", label: t("companyFiles.upload") },
              { icon: <FolderInput size={15} />, key: "folder", label: t("companyFiles.uploadFolder") },
            ],
            onClick: ({ key }) => key === "folder" ? props.onUploadFolder() : props.onUpload(),
          }}
        >
          <Button disabled={props.busy} type="primary">{t("companyFiles.add")}</Button>
        </Dropdown>
      </header>
      <div className={styles.toolbar}>
        <Flexbox align="center" gap={8} horizontal>
          {props.selectedIds.length > 0 ? (
            <>
              <Tag>{t("companyFiles.selectedCount", { count: props.selectedIds.length })}</Tag>
              <Button icon={<FolderInput size={15} />} onClick={() => props.onBatchMove(props.selectedIds)} size="small">{t("companyFiles.move")}</Button>
              {props.canDelete ? <Button danger icon={<Trash2 size={15} />} onClick={() => props.onBatchDelete(props.selectedIds)} size="small">{t("common.delete")}</Button> : null}
              <ActionIcon icon={X} onClick={() => props.setSelectedIds([])} size="small" title={t("companyFiles.clearSelection")} />
            </>
          ) : <span style={{ color: "var(--ant-color-text-secondary)" }}>{t("companyFiles.itemCount", { count: sortedItems.length })}</span>}
        </Flexbox>
        <Flexbox align="center" gap={4} horizontal>
          <Dropdown
            menu={{
              items: [
                { icon: <ArrowDownAZ size={15} />, key: "name-asc", label: t("companyFiles.sortNameAsc") },
                { icon: <ArrowUpAZ size={15} />, key: "name-desc", label: t("companyFiles.sortNameDesc") },
                { key: "updated-desc", label: t("companyFiles.sortUpdated") },
              ],
              onClick: ({ key }) => props.setSort(key as ResourceExplorerProps["sort"]),
              selectedKeys: [props.sort],
            }}
          >
            <ActionIcon icon={ArrowDownAZ} size="small" title={t("companyFiles.sort")} />
          </Dropdown>
          <Tooltip title={t("companyFiles.listView")}><ActionIcon active={props.viewMode === "list"} icon={List} onClick={() => props.setViewMode("list")} size="small" /></Tooltip>
          <Tooltip title={t("companyFiles.gridView")}><ActionIcon active={props.viewMode === "masonry"} icon={Grid2X2} onClick={() => props.setViewMode("masonry")} size="small" /></Tooltip>
          <Tooltip title={t("common.refresh")}><ActionIcon disabled={props.loading} icon={RefreshCw} onClick={props.onRefresh} size="small" /></Tooltip>
        </Flexbox>
      </div>
      <main
        className={styles.body}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          props.onDropFiles([...event.dataTransfer.files]);
        }}
      >
        {props.loading ? <Flexbox gap={10} padding={20}><Skeleton active /><Skeleton active /></Flexbox> : null}
        {!props.loading && sortedItems.length === 0 ? <div className={styles.empty}><Empty description={props.search ? t("companyFiles.noMatches") : t("companyFiles.empty")} /></div> : null}
        {!props.loading && sortedItems.length > 0 && props.viewMode === "list" ? (
          <Flexbox height="100%">
            <div className={styles.listHeader}>
              <span>{t("companyFiles.name")}</span><span>{t("companyFiles.uploader")}</span><span>{t("companyFiles.size")}</span><span>{t("companyFiles.modified")}</span><span />
            </div>
            <Virtuoso data={sortedItems} itemContent={(_index, item) => row(item)} style={{ flex: 1 }} />
          </Flexbox>
        ) : null}
        {!props.loading && sortedItems.length > 0 && props.viewMode === "masonry" ? (
          <div className={styles.grid}>
            {sortedItems.map((item) => (
              <article
                className={cx(styles.card, styles.dropTarget)}
                data-selected={selected.has(item.id)}
                draggable
                key={item.id}
                onClick={(event) => select(item, event.metaKey || event.ctrlKey)}
                onDoubleClick={() => props.onOpen(item)}
                onDragOver={(event) => {
                  if (item.kind === "folder") event.preventDefault();
                }}
                onDrop={(event) => {
                  if (item.kind !== "folder") return;
                  event.preventDefault();
                  const ids = event.dataTransfer.getData("application/x-fields-file-ids").split(",").filter(Boolean);
                  if (ids.length > 0) props.onMove(ids, item.id);
                }}
                onDragStart={(event) => {
                  const ids = selected.has(item.id) ? props.selectedIds : [item.id];
                  event.dataTransfer.setData("application/x-fields-file-ids", ids.join(","));
                }}
              >
                <Flexbox align="center" horizontal justify="space-between">
                  <ResourceThumbnail item={item} onVisible={() => props.onRequestThumbnail(item)} />
                  <Dropdown menu={itemMenu(item)} trigger={["click"]}>
                    <ActionIcon icon={MoreHorizontal} onClick={(event) => event.stopPropagation()} size="small" title={t("companyFiles.actions")} />
                  </Dropdown>
                </Flexbox>
                <Flexbox gap={5}>
                  <span className={styles.title}>{item.name}</span>
                  <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>
                    {item.kind === "file" ? `${formatBytes(item.sizeBytes ?? 0)} · ` : ""}{item.uploader}
                  </span>
                </Flexbox>
              </article>
            ))}
          </div>
        ) : null}
      </main>
    </Flexbox>
  );
});

ResourceExplorer.displayName = "ResourceExplorer";

function ResourceThumbnail({ item, onVisible }: { item: ResourceExplorerItem; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || item.kind !== "file" || !item.mimeType?.startsWith("image/")) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      onVisible();
      observer.disconnect();
    }, { rootMargin: "120px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.kind, item.mimeType, onVisible]);

  if (item.kind === "folder") return <Icon icon={Folder} size={28} />;
  if (!item.mimeType?.startsWith("image/")) return <Icon icon={FileIcon} size={28} />;
  return (
    <div ref={ref} style={{ height: 88, margin: "-4px -4px 4px", overflow: "hidden", borderRadius: 8 }}>
      {item.thumbnailUrl ? (
        <img alt="" onError={onVisible} src={item.thumbnailUrl} style={{ height: "100%", objectFit: "cover", width: "100%" }} />
      ) : <CenterThumbnail />}
    </div>
  );
}

function CenterThumbnail() {
  return <Flexbox align="center" height="100%" justify="center"><Icon icon={FileIcon} size={28} /></Flexbox>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
