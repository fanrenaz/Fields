import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FilePlus,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ContextMenuTrigger,
  Empty,
  Flexbox,
  ListItem,
  ScrollArea,
  Skeleton,
  Text,
  showContextMenu,
  type ContextMenuItem,
} from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";

import { translateMessage } from "../../shared/i18n/message";
import type { HomeFilesystemController } from "./use-home-machine";
import { FilePickButton } from "../../shared/platform/file-pick-button";
import type { PickedFile } from "../../shared/types/upload";

type ExplorerEntry = HomeFilesystemController["items"][string];
type ExplorerChildKind = "file" | "folder";
type HomeContextExplorerProps = { filesystem: HomeFilesystemController; showHeader?: boolean };

export function HomeContextExplorer({ filesystem, showHeader = true }: HomeContextExplorerProps) {
  const { t } = useTranslation();
  const contextUploadInputId = useId();
  const [contextUploadParent, setContextUploadParent] = useState(filesystem.rootId);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const rows = useMemo(() => visibleEntries(filesystem.items, filesystem.rootId, filesystem.expandedIds), [filesystem.expandedIds, filesystem.items, filesystem.rootId]);
  function addExplorerChild(parentId: string, kind: ExplorerChildKind) { const parent = filesystem.items[parentId]; if (!parent?.is_folder || filesystem.mutating) return; const childName = nextChildName(filesystem.items, parentId, kind, t); const nextName = window.prompt(kind === "folder" ? t("workspace.newFolder") : t("workspace.newFile"), childName)?.trim() ?? ""; if (!nextName) return; filesystem.setExpandedIds(uniquePaths([...filesystem.expandedIds, parentId])); filesystem.createEntry(parentId, kind, nextName); }
  function renameExplorerItem(itemId: string) { const currentName = filesystem.items[itemId]?.name ?? ""; const nextName = window.prompt(t("workspace.rename"), currentName)?.trim() ?? ""; if (!nextName || nextName === currentName || filesystem.mutating) return; filesystem.renameEntry(itemId, nextName); }
  const errorMessage = translateMessage(t, filesystem.error);
  async function upload(parentPath: string, files: PickedFile[]) {
    setUploading(true);
    setUploadError("");
    try {
      const result = await filesystem.uploadFiles(parentPath, files);
      if (result.failed.length > 0) {
        setUploadError(t("workspace.uploadFailed", { count: result.failed.length }));
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <Flexbox flex={1} style={{ background: "var(--ant-color-bg-layout)", minHeight: 0 }}>
      {showHeader ? (
        <Flexbox as="header" align="center" horizontal justify="space-between" style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", minHeight: 42, padding: "0 12px" }}>
          <Text strong style={{ borderBottom: "1px solid currentColor", fontSize: 13, paddingBottom: 3 }}>{t("workspace.explorer")}</Text>
          <Flexbox align="center" gap={4} horizontal>
            <FilePickButton
              aria-label={t("workspace.upload")}
              disabled={uploading || filesystem.mutating}
              icon={<Upload size={14} />}
              onFilesPicked={(files) => void upload(uploadParent(filesystem), files)}
              onFilesRejected={(files) => {
                setUploadError(t("workspace.uploadFailed", { count: files.length }));
              }}
              shape="circle"
              size="small"
              type="text"
            />
            <Button aria-label={t("common.refresh")} disabled={filesystem.loading} icon={RefreshCw} onClick={filesystem.refresh} shape="circle" size="small" type="text" />
          </Flexbox>
        </Flexbox>
      ) : null}
      <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
        <Flexbox aria-label={t("workspace.explorer")} paddingBlock="4px 12px" role="tree">
          {rows.map((row) => (
            <ExplorerRow
              depth={row.depth}
              entry={row.entry}
              filesystem={filesystem}
              key={row.id}
              onAddChild={addExplorerChild}
              onDelete={(id) => filesystem.deleteEntry(id)}
              onRename={renameExplorerItem}
              onUpload={(id) => {
                setContextUploadParent(id);
                queueMicrotask(() => {
                  const input = document.getElementById(contextUploadInputId) as HTMLInputElement | null;
                  input?.click();
                });
              }}
            />
          ))}
          {rows.length === 0 && filesystem.loading ? (
            <Skeleton active paragraph={{ rows: 3 }} style={{ padding: 12 }} title={false} />
          ) : rows.length === 0 && errorMessage ? (
            <Empty description={errorMessage} />
          ) : rows.length === 0 ? (
            <Empty description={t("search.noResults")} />
          ) : errorMessage ? (
            <Text fontSize={12} style={{ padding: "8px 12px 0" }} type="danger">{errorMessage}</Text>
          ) : null}
          {uploadError ? <Text fontSize={12} style={{ padding: "8px 12px 0" }} type="danger">{uploadError}</Text> : null}
        </Flexbox>
      </ScrollArea>
      <FilePickButton
        inputId={contextUploadInputId}
        onFilesPicked={(files) => void upload(contextUploadParent, files)}
        onFilesRejected={(files) => {
          setUploadError(t("workspace.uploadFailed", { count: files.length }));
        }}
        style={{ display: "none" }}
      />
    </Flexbox>
  );
}

function ExplorerRow({ entry, depth, filesystem, onAddChild, onDelete, onRename, onUpload }: { entry: ExplorerEntry; depth: number; filesystem: HomeFilesystemController; onAddChild: (id: string, kind: ExplorerChildKind) => void; onDelete: (id: string) => void; onRename: (id: string) => void; onUpload: (id: string) => void }) {
  const { t } = useTranslation();
  const expanded = filesystem.expandedIds.includes(entry.id);
  const selected = filesystem.selectedId === entry.id;
  const hasChildren = entry.childrenIds.length > 0;
  const ItemIcon = entry.is_folder ? (expanded && hasChildren ? FolderOpen : Folder) : FileIcon;
  const items: ContextMenuItem[] = [
    { key: "file", disabled: !entry.is_folder || filesystem.mutating, icon: FilePlus, label: t("workspace.newFileMenu"), onClick: () => onAddChild(entry.id, "file") },
    { key: "folder", disabled: !entry.is_folder || filesystem.mutating, icon: FolderPlus, label: t("workspace.newFolderMenu"), onClick: () => onAddChild(entry.id, "folder") },
    {
      key: "upload",
      disabled: !entry.is_folder || filesystem.mutating,
      icon: Upload,
      label: t("workspace.upload"),
      onClick: () => onUpload(entry.id),
    },
    {
      key: "download",
      disabled: entry.is_folder,
      icon: Download,
      label: t("workspace.download"),
      onClick: () => filesystem.downloadFile(entry.id),
    },
    { type: "divider" },
    { key: "rename", disabled: filesystem.mutating, icon: Pencil, label: t("workspace.renameMenu"), onClick: () => onRename(entry.id) },
    { key: "delete", danger: true, disabled: filesystem.mutating, icon: Trash2, label: t("common.delete"), onClick: () => onDelete(entry.id) },
  ];
  const activate = () => {
    filesystem.selectEntry(entry.id);
    if (entry.is_folder) {
      filesystem.setExpandedIds(expanded
        ? filesystem.expandedIds.filter((id) => id !== entry.id)
        : uniquePaths([...filesystem.expandedIds, entry.id]));
    }
  };

  return (
    <ContextMenuTrigger
      onContextMenu={(event) => {
        event.preventDefault();
        filesystem.selectEntry(entry.id);
        showContextMenu(items);
      }}
    >
      <ListItem
        active={selected}
        aria-expanded={entry.is_folder ? expanded : undefined}
        aria-level={depth + 1}
        aria-selected={selected}
        avatar={(
          <Flexbox align="center" horizontal>
            <Flexbox align="center" height={22} justify="center" style={{ color: "var(--ant-color-text-secondary)", opacity: entry.is_folder ? 1 : 0, width: 20 }}>
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </Flexbox>
            <ItemIcon color="var(--ant-color-text-secondary)" size={15} />
          </Flexbox>
        )}
        key={entry.id}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        role="treeitem"
        style={{ height: 28, padding: 0, paddingLeft: 8 + depth * 16, paddingRight: 8 }}
        styles={{
          container: { alignItems: "center" },
          title: { fontSize: 13, fontWeight: depth <= 1 ? 600 : 400 },
        }}
        tabIndex={0}
        title={entry.name}
      />
    </ContextMenuTrigger>
  );
}

function uploadParent(filesystem: HomeFilesystemController): string {
  const selected = filesystem.selectedId ? filesystem.items[filesystem.selectedId] : null;
  if (!selected) return filesystem.rootId;
  if (selected.is_folder) return selected.path;
  const slash = selected.path.lastIndexOf("/");
  return slash < 0 ? filesystem.rootId : selected.path.slice(0, slash);
}

function visibleEntries(items: Record<string, ExplorerEntry>, rootId: string, expandedIds: readonly string[]): { id: string; entry: ExplorerEntry; depth: number }[] { const expanded = new Set(expandedIds); const visible: { id: string; entry: ExplorerEntry; depth: number }[] = []; const append = (parentId: string, depth: number) => { const parent = items[parentId]; for (const childId of parent?.childrenIds ?? []) { const entry = items[childId]; if (!entry) continue; visible.push({ id: childId, entry, depth }); if (entry.is_folder && expanded.has(childId)) append(childId, depth + 1); } }; append(rootId, 0); return visible; }
function nextChildName(items: Record<string, ExplorerEntry>, parentId: string, kind: ExplorerChildKind, t: (key: string) => string) { const parent = items[parentId]; const baseName = kind === "folder" ? t("workspace.newFolderName") : t("workspace.newFileName"); const names = new Set((parent?.childrenIds ?? []).map((id) => items[id]?.name)); if (!names.has(baseName)) return baseName; let index = 2; while (names.has(`${baseName} ${index}`)) index += 1; return `${baseName} ${index}`; }
function uniquePaths(paths: string[]): string[] { return Array.from(new Set(paths)); }
