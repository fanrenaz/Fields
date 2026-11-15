import type {
  CompanyFile,
  CompanyFileFolder,
} from "@fields/contracts/public/company-file";
import { Drawer, Input, Modal, Select } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { workspaceTelemetry } from "../../data/observability/workspace-telemetry";
import { FileViewer } from "../../vendor/lobehub/file-viewer/FileViewer";
import type { FilePreviewKind } from "../../vendor/lobehub/file-viewer/file-preview";
import {
  ResourceExplorer,
  type ResourceExplorerBreadcrumb,
  type ResourceExplorerItem,
} from "../../vendor/lobehub/resource-manager/ResourceExplorer";

type CompanyFilesToastActions = {
  error(title: string): void;
  success(title: string): void;
};

type ExplorerEntry =
  | { item: ResourceExplorerItem; source: CompanyFileFolder }
  | { item: ResourceExplorerItem; source: CompanyFile };

export function CompanyFilesWorkbench({
  canDelete,
  toast,
}: {
  canDelete: boolean;
  toast: CompanyFilesToastActions;
}) {
  const { t } = useTranslation();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<CompanyFileFolder[]>([]);
  const [files, setFiles] = useState<CompanyFile[]>([]);
  const [allFolders, setAllFolders] = useState<CompanyFileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "masonry">(() => (
    localStorage.getItem("fields.companyFiles.viewMode") === "masonry" ? "masonry" : "list"
  ));
  const [sort, setSort] = useState<"name-asc" | "name-desc" | "updated-desc">("name-asc");
  const [thumbnails, setThumbnails] = useState<Record<string, { url: string; expiresAtMs: number }>>({});
  const [nameDialog, setNameDialog] = useState<{ kind: "create" | "rename"; entry?: ExplorerEntry } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{
    file: CompanyFile;
    previewUrl: string;
    downloadUrl: string;
    expiresAtMs: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<CompanyFile | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [visible, hierarchy] = await Promise.all([
        backendTrpc.company.files.list.query(searchTerm
          ? { folder_id: null, recursive: true, search_term: searchTerm }
          : { folder_id: folderId, recursive: false }),
        backendTrpc.company.files.list.query({ folder_id: null, recursive: true }),
      ]);
      setFolders(visible.folders);
      setFiles(visible.files);
      setAllFolders(hierarchy.folders);
      setSelectedIds([]);
    } catch {
      toast.error(t("companyFiles.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [folderId, searchTerm, t, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!preview) return;
    const delay = Math.max(5_000, preview.expiresAtMs - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      void loadPreview(preview.file).catch(() => {
        toast.error(t("companyFiles.previewFailed"));
        setPreview(null);
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [preview, t, toast]);

  const entries = useMemo<ExplorerEntry[]>(() => [
    ...folders.map((folder) => ({
      item: {
        id: folder.folder_id,
        kind: "folder" as const,
        name: folder.name,
        updatedAtMs: folder.updated_at_ms,
        uploader: folder.created_by.display_name,
      },
      source: folder,
    })),
    ...files.map((file) => ({
      item: {
        id: file.file_id,
        kind: "file" as const,
        mimeType: file.current_version.mime_type,
        name: file.name,
        sizeBytes: file.current_version.size_bytes,
        thumbnailUrl: thumbnails[file.file_id]?.url,
        updatedAtMs: file.updated_at_ms,
        uploader: file.current_version.created_by.display_name,
      },
      source: file,
    })),
  ], [files, folders, thumbnails]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.item.id, entry])), [entries]);
  const allFolderMap = useMemo(() => new Map(allFolders.map((folder) => [folder.folder_id, folder])), [allFolders]);
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(folderId, allFolderMap, t("companyFiles.title")),
    [allFolderMap, folderId, t],
  );

  async function submitName() {
    if (!nameDialog || !nameDraft.trim()) return;
    setBusy(true);
    try {
      if (nameDialog.kind === "create") {
        await backendTrpc.company.files.folders.create.mutate({
          parent_folder_id: folderId,
          name: nameDraft.trim(),
          idempotency_key: crypto.randomUUID(),
        });
      } else if (nameDialog.entry?.item.kind === "folder") {
        const folder = nameDialog.entry.source as CompanyFileFolder;
        await backendTrpc.company.files.folders.update.mutate({
          folder_id: folder.folder_id,
          expected_revision: folder.revision,
          name: nameDraft.trim(),
          idempotency_key: crypto.randomUUID(),
        });
      } else if (nameDialog.entry) {
        const file = nameDialog.entry.source as CompanyFile;
        await backendTrpc.company.files.update.mutate({
          file_id: file.file_id,
          expected_revision: file.revision,
          name: nameDraft.trim(),
          idempotency_key: crypto.randomUUID(),
        });
      }
      setNameDialog(null);
      await refresh();
    } catch {
      toast.error(t("companyFiles.renameFileFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(inputFiles: File[], target?: CompanyFile) {
    if (inputFiles.length === 0) return;
    setBusy(true);
    let completed = 0;
    try {
      const directoryIds = new Map<string, string | null>([["", folderId]]);
      for (const file of inputFiles) {
        const relative = file.webkitRelativePath || file.name;
        const segments = relative.split("/").filter(Boolean);
        const filename = segments.pop() ?? file.name;
        let path = "";
        for (const segment of segments) {
          const nextPath = path ? `${path}/${segment}` : segment;
          if (!directoryIds.has(nextPath)) {
            const parentId = directoryIds.get(path) ?? folderId;
            const existing = allFolders.find((folder) => (
              folder.parent_folder_id === parentId && folder.name === segment
            ));
            if (existing) {
              directoryIds.set(nextPath, existing.folder_id);
            } else {
              const created = await backendTrpc.company.files.folders.create.mutate({
                parent_folder_id: parentId,
                name: segment,
                idempotency_key: crypto.randomUUID(),
              });
              directoryIds.set(nextPath, created.folder_id);
            }
          }
          path = nextPath;
        }
        await uploadOne(file, filename, target ? target.folder_id : (directoryIds.get(path) ?? folderId), target);
        completed += 1;
      }
      toast.success(t("companyFiles.uploadSucceeded", { count: completed }));
    } catch {
      toast.error(t("companyFiles.uploadPartialFailed", { completed, total: inputFiles.length }));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function uploadOne(file: File, name: string, targetFolderId: string | null, target?: CompanyFile) {
    const bytes = await file.arrayBuffer();
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const operationKey = crypto.randomUUID();
    const begin = await backendTrpc.company.files.upload.begin.mutate({
      ...(target ? { file_id: target.file_id, expected_revision: target.revision } : {}),
      folder_id: targetFolderId,
      name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      sha256,
      idempotency_key: operationKey,
    });
    if (begin.upload_required) {
      if (!begin.upload_url) throw new Error("Missing upload URL");
      const response = await fetch(begin.upload_url, {
        body: file,
        headers: begin.upload_headers,
        method: "PUT",
      });
      if (!response.ok) throw new Error(`Upload failed with ${response.status}`);
    }
    await backendTrpc.company.files.upload.finalize.mutate({
      upload_id: begin.upload_id,
      idempotency_key: operationKey,
    });
  }

  async function openEntry(entry: ExplorerEntry) {
    if (entry.item.kind === "folder") {
      setFolderId((entry.source as CompanyFileFolder).folder_id);
      setSearch("");
      return;
    }
    const file = entry.source as CompanyFile;
    try {
      await loadPreview(file);
    } catch {
      toast.error(t("companyFiles.previewFailed"));
    }
  }

  async function loadPreview(file: CompanyFile) {
    const [previewResult, downloadResult] = await Promise.all([
      backendTrpc.company.files.download.query({ file_id: file.file_id, disposition: "inline" }),
      backendTrpc.company.files.download.query({ file_id: file.file_id, disposition: "attachment" }),
    ]);
    setPreview({
      file,
      previewUrl: previewResult.download_url,
      downloadUrl: downloadResult.download_url,
      expiresAtMs: Math.min(previewResult.expires_at_ms, downloadResult.expires_at_ms),
    });
  }

  async function moveEntries(ids: string[], targetFolderId: string | null) {
    setBusy(true);
    let completed = 0;
    try {
      for (const id of ids) {
        const entry = byId.get(id);
        if (!entry) continue;
        if (entry.item.kind === "folder") {
          const folder = entry.source as CompanyFileFolder;
          await backendTrpc.company.files.folders.update.mutate({
            folder_id: folder.folder_id,
            expected_revision: folder.revision,
            parent_folder_id: targetFolderId,
            idempotency_key: crypto.randomUUID(),
          });
        } else {
          const file = entry.source as CompanyFile;
          await backendTrpc.company.files.update.mutate({
            file_id: file.file_id,
            expected_revision: file.revision,
            folder_id: targetFolderId,
            idempotency_key: crypto.randomUUID(),
          });
        }
        completed += 1;
      }
      toast.success(t("companyFiles.moveSucceeded", { count: completed }));
    } catch {
      toast.error(t("companyFiles.movePartialFailed", { completed, total: ids.length }));
    } finally {
      setBusy(false);
      setMoveIds(null);
      await refresh();
    }
  }

  function confirmDelete(ids: string[]) {
    setDeleteIds(ids);
  }

  async function deleteEntries(ids: string[]) {
    setBusy(true);
    let completed = 0;
    try {
      for (const id of ids) {
        const entry = byId.get(id);
        if (!entry) continue;
        if (entry.item.kind === "folder") {
          const folder = entry.source as CompanyFileFolder;
          await backendTrpc.company.files.folders.delete.mutate({
            folder_id: folder.folder_id,
            expected_revision: folder.revision,
            idempotency_key: crypto.randomUUID(),
          });
        } else {
          const file = entry.source as CompanyFile;
          await backendTrpc.company.files.delete.mutate({
            file_id: file.file_id,
            expected_revision: file.revision,
            idempotency_key: crypto.randomUUID(),
          });
        }
        completed += 1;
      }
      toast.success(t("companyFiles.deleteSucceeded", { count: completed }));
    } catch {
      toast.error(t("companyFiles.deletePartialFailed", { completed, total: ids.length }));
    } finally {
      setBusy(false);
      setDeleteIds(null);
      await refresh();
    }
  }

  async function requestThumbnail(item: ResourceExplorerItem) {
    if (item.kind !== "file" || !item.mimeType?.startsWith("image/")) return;
    const cached = thumbnails[item.id];
    if (cached && cached.expiresAtMs > Date.now() + 30_000) return;
    try {
      const result = await backendTrpc.company.files.download.query({
        file_id: item.id,
        disposition: "inline",
      });
      setThumbnails((current) => ({
        ...current,
        [item.id]: { expiresAtMs: result.expires_at_ms, url: result.download_url },
      }));
    } catch {
      // The normal preview/download paths still surface a user-facing error.
    }
  }

  return (
    <>
      <input hidden multiple onChange={(event) => void uploadFiles([...event.target.files ?? []])} ref={fileInput} type="file" />
      <input
        hidden
        multiple
        onChange={(event) => void uploadFiles([...event.target.files ?? []])}
        ref={(node) => {
          folderInput.current = node;
          if (node) {
            node.setAttribute("webkitdirectory", "");
            node.setAttribute("directory", "");
          }
        }}
        type="file"
      />
      <input
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && versionTarget.current) void uploadFiles([file], versionTarget.current);
          event.target.value = "";
        }}
        ref={versionInput}
        type="file"
      />
      <ResourceExplorer
        breadcrumbs={breadcrumbs}
        busy={busy}
        canDelete={canDelete}
        items={entries.map((entry) => entry.item)}
        loading={loading}
        onBatchDelete={confirmDelete}
        onBatchMove={(ids) => { setMoveIds(ids); setMoveTarget(folderId); }}
        onCreateFolder={() => { setNameDraft(""); setNameDialog({ kind: "create" }); }}
        onDelete={(item) => confirmDelete([item.id])}
        onDownload={(item) => {
          const entry = byId.get(item.id);
          if (!entry || item.kind !== "file") return;
          void backendTrpc.company.files.download.query({ file_id: item.id })
            .then((result) => window.location.assign(result.download_url))
            .catch(() => toast.error(t("companyFiles.downloadFailed")));
        }}
        onDropFiles={(dropped) => void uploadFiles(dropped)}
        onMove={(ids, target) => void moveEntries(ids, target)}
        onNavigate={(target) => { setFolderId(target); setSearch(""); }}
        onOpen={(item) => {
          const entry = byId.get(item.id);
          if (entry) void openEntry(entry);
        }}
        onRefresh={() => void refresh()}
        onRename={(item) => {
          const entry = byId.get(item.id);
          if (!entry) return;
          setNameDraft(item.name);
          setNameDialog({ entry, kind: "rename" });
        }}
        onSearch={setSearch}
        onRequestThumbnail={(item) => void requestThumbnail(item)}
        onUpload={() => fileInput.current?.click()}
        onUploadFolder={() => folderInput.current?.click()}
        onUploadVersion={(item) => {
          const entry = byId.get(item.id);
          if (!entry || entry.item.kind !== "file") return;
          versionTarget.current = entry.source as CompanyFile;
          versionInput.current?.click();
        }}
        search={search}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        setSort={setSort}
        setViewMode={(mode) => {
          localStorage.setItem("fields.companyFiles.viewMode", mode);
          setViewMode(mode);
        }}
        sort={sort}
        viewMode={viewMode}
      />
      <Modal
        confirmLoading={busy}
        okButtonProps={{ disabled: !nameDraft.trim() }}
        onCancel={() => setNameDialog(null)}
        onOk={() => void submitName()}
        open={nameDialog !== null}
        title={nameDialog?.kind === "create" ? t("companyFiles.newFolder") : t("companyFiles.rename")}
      >
        <Input autoFocus maxLength={255} onChange={(event) => setNameDraft(event.target.value)} onPressEnter={() => void submitName()} value={nameDraft} />
      </Modal>
      <Modal
        confirmLoading={busy}
        onCancel={() => setMoveIds(null)}
        onOk={() => moveIds && void moveEntries(moveIds, moveTarget)}
        open={moveIds !== null}
        title={t("companyFiles.moveTo")}
      >
        <Select
          onChange={(value) => setMoveTarget(value === "__root__" ? null : value)}
          options={[
            { label: t("companyFiles.title"), value: "__root__" },
            ...allFolders
              .filter((folder) => !isFolderUnavailableAsMoveTarget(folder.folder_id, moveIds ?? [], byId, allFolderMap))
              .map((folder) => ({ label: folderPath(folder.folder_id, allFolderMap), value: folder.folder_id })),
          ]}
          style={{ width: "100%" }}
          value={moveTarget ?? "__root__"}
        />
      </Modal>
      <Modal
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        okText={t("common.delete")}
        onCancel={() => setDeleteIds(null)}
        onOk={() => deleteIds && void deleteEntries(deleteIds)}
        open={deleteIds !== null}
        title={t("common.delete")}
      >
        {t("companyFiles.deleteSelectionConfirm", { count: deleteIds?.length ?? 0 })}
      </Modal>
      <Drawer
        destroyOnHidden
        extra={preview ? <Button icon={<Download size={16} />} onClick={() => window.location.assign(preview.downloadUrl)}>{t("companyFiles.download")}</Button> : null}
        onClose={() => setPreview(null)}
        open={preview !== null}
        size="large"
        styles={{ body: { padding: 0 } }}
        title={preview?.file.name}
      >
        {preview ? (
          <FileViewer
            downloadUrl={preview.downloadUrl}
            mimeType={preview.file.current_version.mime_type}
            name={preview.file.name}
            onPreviewError={reportCompanyFilePreviewError}
            previewUrl={preview.previewUrl}
            sizeBytes={preview.file.current_version.size_bytes}
          />
        ) : null}
      </Drawer>
    </>
  );
}

const companyFilePreviewErrorClasses = {
  html: "company_file_preview_html",
  image: "company_file_preview_image",
  office: "company_file_preview_office",
  pdf: "company_file_preview_pdf",
  text: "company_file_preview_text",
  video: "company_file_preview_video",
} as const;

function reportCompanyFilePreviewError(kind: FilePreviewKind): void {
  workspaceTelemetry.recordError(companyFilePreviewErrorClasses[kind]);
}

function buildBreadcrumbs(
  folderId: string | null,
  folders: Map<string, CompanyFileFolder>,
  rootName: string,
): ResourceExplorerBreadcrumb[] {
  const result: ResourceExplorerBreadcrumb[] = [{ id: null, name: rootName }];
  const chain: CompanyFileFolder[] = [];
  let current = folderId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const folder = folders.get(current);
    if (!folder) break;
    chain.unshift(folder);
    current = folder.parent_folder_id;
  }
  return [...result, ...chain.map((folder) => ({ id: folder.folder_id, name: folder.name }))];
}

function folderPath(folderId: string, folders: Map<string, CompanyFileFolder>): string {
  return buildBreadcrumbs(folderId, folders, "").map((item) => item.name).filter(Boolean).join(" / ");
}

function isFolderUnavailableAsMoveTarget(
  candidateId: string,
  movingIds: string[],
  visibleEntries: Map<string, ExplorerEntry>,
  folders: Map<string, CompanyFileFolder>,
): boolean {
  for (const movingId of movingIds) {
    const moving = visibleEntries.get(movingId);
    if (moving?.item.kind !== "folder") continue;
    let current: string | null = candidateId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === movingId) return true;
      visited.add(current);
      current = folders.get(current)?.parent_folder_id ?? null;
    }
  }
  return false;
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
