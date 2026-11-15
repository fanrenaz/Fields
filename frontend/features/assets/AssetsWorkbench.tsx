import type {
  AssetCapabilityEntry,
  AssetContent,
  AssetDetail,
  AssetDraft,
  AssetKind,
  AssetLifecycle,
  AssetSource,
  AssetSummary,
} from "@fields/contracts/public/asset";
import type { AssetBuilderTarget } from "@fields/contracts/public/asset-builder";
import {
  Button,
  Empty,
  Input,
  InputPassword,
  Modal,
  Popover,
  SearchBar,
  Segmented,
  Select,
  Skeleton,
  Tabs,
  Tag,
  Text,
  TextArea,
  Tooltip,
  useToast,
} from "@lobehub/ui";
import {
  Archive,
  FileArchive,
  GitBranch,
  KeyRound,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { authFetch } from "../../data/boundary/auth-client";
import { backendApiUrl } from "../../data/boundary/backend-url";
import { backendTrpc } from "../../data/boundary/backend-trpc";
import { FilePickButton } from "../../shared/platform/file-pick-button";
import { openExternalUrl } from "../../shared/platform/external-navigation";

import {
  allowedAssetImportModes,
  appendUniqueAssetItems,
  assetLifecycleIsReadOnly,
  assetMutationFingerprint,
  assetValidationIssueMessageKey,
  beginAssetPreview,
  draftDeletionRemovesAsset,
  formatAssetBytes,
  GITHUB_MCP_PRESET,
  githubFineGrainedPatUrl,
  isOfficialGitHubMcpSource,
  reconcileAssetSelection,
  resolveDraftSelection,
  resolveVersionSelection,
  reuseOrCreateAssetMutationAttempt,
  reuseOrCreateZipUploadAttempt,
  settleAssetPreview,
  zipAttemptFingerprint,
  type AssetImportMode,
  type AssetMutationAttempt,
  type AssetPreviewState,
  type ZipUploadAttempt,
} from "./asset-workbench-state";

type ImportMode = AssetImportMode;
type PackageAssetKind = "plugin" | "skill";
const ZIP_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const CAPABILITY_KIND_MESSAGE_KEYS = {
  skill: "assets.capabilityKinds.skill",
  mcp: "assets.capabilityKinds.mcp",
  app: "assets.capabilityKinds.app",
  hook: "assets.capabilityKinds.hook",
  task_template: "assets.capabilityKinds.taskTemplate",
  tool: "assets.capabilityKinds.tool",
  resource: "assets.capabilityKinds.resource",
  prompt: "assets.capabilityKinds.prompt",
} satisfies Record<AssetCapabilityEntry["kind"], string>;
type AssetImportPreset = {
  kind: AssetKind;
  name: string;
  slug: string;
  description: string;
  source: AssetSource;
};
type AssetConfirmation =
  | { type: "archive" }
  | { type: "delete"; draft: AssetDraft; deletesAsset: boolean }
  | { type: "publish"; draft: AssetDraft };
type GitHubSetupTarget =
  | { type: "create" }
  | { type: "draft"; assetId: string; draft: AssetDraft }
  | { type: "version"; assetId: string; versionId: string; revision: number };

export function AssetsWorkbench({
  canManageCredentials = false,
  initialAssetId = null,
  initialKind = "plugin",
  initialLifecycle = "published",
  onTargetChange,
  onLocationChange,
  onBuilderTargetChange,
}: {
  canManageCredentials?: boolean;
  initialAssetId?: string | null;
  initialKind?: AssetKind;
  initialLifecycle?: AssetLifecycle;
  onTargetChange: (target: {
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  }) => void;
  onLocationChange?: (target: {
    assetId: string | null;
    kind: AssetKind;
    lifecycle: AssetLifecycle;
  }) => void;
  onBuilderTargetChange?: (target: AssetBuilderTarget) => void;
}) {
  const { t } = useTranslation();
  const toast = useAssetToast();
  const kind = initialKind;
  const [lifecycle, setLifecycle] = useState<AssetLifecycle>(initialLifecycle);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<AssetSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialAssetId);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [working, setWorking] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
  const [importPreset, setImportPreset] = useState<AssetImportPreset | null>(null);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [githubSetup, setGithubSetup] = useState<{
    sessionId: string;
    target: GitHubSetupTarget;
  } | null>(null);
  const [githubDiscovering, setGithubDiscovering] = useState(false);
  const [editingDraft, setEditingDraft] = useState<AssetDraft | null>(null);
  const [confirmation, setConfirmation] = useState<AssetConfirmation | null>(null);
  const request = useRef(0);
  const detailRequest = useRef(0);
  const paginationRequest = useRef(0);
  const loadingMoreRef = useRef(false);
  const refreshingRef = useRef(false);
  const successfulScope = useRef<string | null>(null);
  const mutationAttempts = useRef(new Map<string, AssetMutationAttempt>());

  useEffect(() => {
    onLocationChange?.({ assetId: selectedId, kind, lifecycle });
  }, [kind, lifecycle, onLocationChange, selectedId]);

  const refresh = useCallback(async () => {
    const scope = `${kind}:${lifecycle}:${searchTerm}`;
    const requestId = ++request.current;
    ++paginationRequest.current;
    refreshingRef.current = true;
    loadingMoreRef.current = false;
    setListError(false);
    setLoading(true);
    setLoadingMore(false);
    setNextCursor(null);
    if (successfulScope.current !== scope) setItems([]);
    try {
      const result = await backendTrpc.assets.list.query({
        kind,
        lifecycle,
        search_term: searchTerm || undefined,
        limit: 100,
      });
      if (request.current !== requestId) return;
      successfulScope.current = scope;
      setItems(result.items);
      setNextCursor(result.page.next_cursor);
      setSelectedId((current) => reconcileAssetSelection({
        currentId: current,
        initialTargetId: initialAssetId,
        initialTargetScopeActive: (
          kind === initialKind
          && lifecycle === initialLifecycle
          && searchTerm.length === 0
        ),
        items: result.items,
      }));
    } catch {
      if (request.current === requestId) setListError(true);
    } finally {
      if (request.current === requestId) {
        refreshingRef.current = false;
        setLoading(false);
      }
    }
  }, [
    initialAssetId,
    initialKind,
    initialLifecycle,
    kind,
    lifecycle,
    searchTerm,
    t,
    toast,
  ]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || refreshingRef.current || loadingMoreRef.current) return;
    const requestId = ++paginationRequest.current;
    const listRequestId = request.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await backendTrpc.assets.list.query({
        kind,
        lifecycle,
        search_term: searchTerm || undefined,
        cursor: nextCursor,
        limit: 100,
      });
      if (
        paginationRequest.current !== requestId
        || request.current !== listRequestId
      ) {
        return;
      }
      setItems((current) => appendUniqueAssetItems(current, result.items));
      setNextCursor(result.page.next_cursor);
    } catch {
      if (paginationRequest.current === requestId) {
        toast.error(t("assets.loadFailed"));
      }
    } finally {
      if (paginationRequest.current === requestId) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [kind, lifecycle, nextCursor, searchTerm, t, toast]);

  const refreshDetail = useCallback(async () => {
    const requestId = ++detailRequest.current;
    setDetailError(false);
    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    try {
      const result = await backendTrpc.assets.read.query({ asset_id: selectedId });
      if (detailRequest.current === requestId) setDetail(result);
    } catch {
      if (detailRequest.current === requestId) {
        setDetail(null);
        setDetailError(true);
      }
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }, [selectedId, t, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  useEffect(() => {
    if (!detail || !onBuilderTargetChange) return;
    onBuilderTargetChange({
      kind: detail.summary.kind,
      asset_id: detail.summary.asset_id,
      draft_id: detail.drafts[0]?.draft_id ?? null,
    });
  }, [detail, onBuilderTargetChange]);

  async function run({
    action,
    attemptSlot,
    fingerprint,
    success,
    nextLifecycle,
  }: {
    action: (idempotencyKey: string) => Promise<unknown>;
    attemptSlot: string;
    fingerprint: string;
    success: string;
    nextLifecycle?: AssetLifecycle;
  }) {
    const attempt = reuseOrCreateAssetMutationAttempt(
      mutationAttempts.current.get(attemptSlot) ?? null,
      fingerprint,
      idempotencyKey,
    );
    mutationAttempts.current.set(attemptSlot, attempt);
    setWorking(true);
    try {
      await action(attempt.idempotencyKey);
      mutationAttempts.current.delete(attemptSlot);
      toast.success(success);
      if (nextLifecycle) setLifecycle(nextLifecycle);
      else await refresh();
      await refreshDetail();
    } catch {
      toast.error(t("assets.actionFailed"));
    } finally {
      setWorking(false);
    }
  }

  async function deleteDraft(draft: AssetDraft) {
    const deletesUnpublishedAsset = (
      detail?.summary.asset_id === draft.asset_id
      && draftDeletionRemovesAsset({
        hasCurrentVersion: detail.current !== null,
        draftCount: detail.drafts.length,
      })
    );
    const attemptSlot = `draft:${draft.draft_id}:action`;
    const fingerprint = assetMutationFingerprint("draft.delete", {
      draft_id: draft.draft_id,
      expected_revision: draft.revision,
    });
    const attempt = reuseOrCreateAssetMutationAttempt(
      mutationAttempts.current.get(attemptSlot) ?? null,
      fingerprint,
      idempotencyKey,
    );
    mutationAttempts.current.set(attemptSlot, attempt);
    setWorking(true);
    try {
      await backendTrpc.assets.draft.delete.mutate({
        draft_id: draft.draft_id,
        expected_revision: draft.revision,
        idempotency_key: attempt.idempotencyKey,
      });
      mutationAttempts.current.delete(attemptSlot);
      toast.success(t("assets.draftDeleted"));
      if (deletesUnpublishedAsset) {
        setDetail(null);
        setSelectedId(null);
        await refresh();
      } else {
        await refresh();
        await refreshDetail();
      }
    } catch {
      toast.error(t("assets.actionFailed"));
    } finally {
      setWorking(false);
    }
  }

  function requestDeleteDraft(draft: AssetDraft) {
    setConfirmation({
      type: "delete",
      draft,
      deletesAsset: (
        detail?.summary.asset_id === draft.asset_id
        && draftDeletionRemovesAsset({
          hasCurrentVersion: detail.current !== null,
          draftCount: detail.drafts.length,
        })
      ),
    });
  }

  async function confirmAssetAction() {
    const action = confirmation;
    if (!action) return;
    setConfirmation(null);
    if (action.type === "delete") {
      await deleteDraft(action.draft);
      return;
    }
    if (!detail) return;
    if (action.type === "archive") {
      await run({
        action: (key) => backendTrpc.assets.archive.mutate({
          asset_id: detail.summary.asset_id,
          expected_revision: detail.summary.revision,
          idempotency_key: key,
        }),
        attemptSlot: `asset:${detail.summary.asset_id}:lifecycle`,
        fingerprint: assetMutationFingerprint("archive", {
          asset_id: detail.summary.asset_id,
          expected_revision: detail.summary.revision,
        }),
        success: t("assets.archived"),
        nextLifecycle: "archived",
      });
      return;
    }
    await run({
      action: (key) => backendTrpc.assets.publish.mutate({
        draft_id: action.draft.draft_id,
        expected_revision: action.draft.revision,
        idempotency_key: key,
      }),
      attemptSlot: `draft:${action.draft.draft_id}:action`,
      fingerprint: assetMutationFingerprint("publish", {
        draft_id: action.draft.draft_id,
        expected_revision: action.draft.revision,
      }),
      success: t("assets.published"),
      nextLifecycle: "published",
    });
  }

  function closeImport() {
    setImportMode(null);
    setImportPreset(null);
  }

  function openNewVersionDraft(asset: AssetDetail) {
    if (!asset.current || asset.summary.lifecycle === "archived") return;
    setImportPreset({
      kind: asset.summary.kind,
      name: asset.summary.name,
      slug: asset.summary.slug,
      description: asset.summary.description,
      source: asset.current.source,
    });
    setImportMode(asset.current.source.type);
  }

  async function openGitHubSetup() {
    if (!canManageCredentials) return;
    setGithubDiscovering(true);
    try {
      const results = await Promise.all(([
        "published",
        "draft",
        "archived",
      ] as const).map((assetLifecycle) => backendTrpc.assets.list.query({
        kind: "mcp",
        lifecycle: assetLifecycle,
        search_term: GITHUB_MCP_PRESET.slug,
        limit: 100,
      })));
      const matches = new Map<string, AssetSummary>();
      for (const result of results) {
        for (const asset of result.items) {
          if (asset.slug === GITHUB_MCP_PRESET.slug) matches.set(asset.asset_id, asset);
        }
      }
      if (matches.size === 0) {
        setGithubSetup({ sessionId: idempotencyKey(), target: { type: "create" } });
        return;
      }
      if (matches.size !== 1) throw new Error("github asset identity conflict");
      const summary = [...matches.values()][0];
      if (!summary || summary.lifecycle === "archived") {
        throw new Error("github asset identity conflict");
      }
      const asset = await backendTrpc.assets.read.query({ asset_id: summary.asset_id });
      const current = asset.current;
      if (current && isOfficialGitHubMcpSource(current.source)) {
        setGithubSetup({
          sessionId: idempotencyKey(),
          target: {
            type: "version",
            assetId: asset.summary.asset_id,
            versionId: current.version_id,
            revision: current.revision,
          },
        });
        return;
      }
      const draft = asset.drafts.find((candidate) => (
        isOfficialGitHubMcpSource(candidate.source)
      ));
      if (draft) {
        setGithubSetup({
          sessionId: idempotencyKey(),
          target: { type: "draft", assetId: asset.summary.asset_id, draft },
        });
        return;
      }
      throw new Error("github asset identity conflict");
    } catch {
      toast.error(t("assets.githubIdentityConflict"));
    } finally {
      setGithubDiscovering(false);
    }
  }

  async function submitGitHubToken(token: string) {
    const setup = githubSetup;
    if (!setup) return;
    setWorking(true);
    try {
      if (setup.target.type === "version") {
        const fingerprint = assetMutationFingerprint("mcp.credential.replace", {
          asset_id: setup.target.assetId,
          target: { type: "version", version_id: setup.target.versionId },
          setup_session_id: setup.sessionId,
        });
        const slot = `github:${setup.target.assetId}:version`;
        const attempt = reuseOrCreateAssetMutationAttempt(
          mutationAttempts.current.get(slot) ?? null,
          fingerprint,
          idempotencyKey,
        );
        mutationAttempts.current.set(slot, attempt);
        await backendTrpc.assets.mcp.credential.replace.mutate({
          asset_id: setup.target.assetId,
          target: {
            type: "version",
            version_id: setup.target.versionId,
            expected_revision: setup.target.revision,
          },
          bearer_token: token,
          idempotency_key: attempt.idempotencyKey,
        });
        mutationAttempts.current.delete(slot);
        setGithubSetup(null);
        setSelectedId(setup.target.assetId);
        setLifecycle("published");
        toast.success(t("assets.githubCredentialUpdated"));
        await Promise.all([refresh(), refreshDetail()]);
        return;
      }

      let draft: AssetDraft;
      let assetId: string;
      if (setup.target.type === "create") {
        const fingerprint = assetMutationFingerprint("draft.createMcp", {
          ...GITHUB_MCP_PRESET,
          setup_session_id: setup.sessionId,
        });
        const slot = "github:create";
        const attempt = reuseOrCreateAssetMutationAttempt(
          mutationAttempts.current.get(slot) ?? null,
          fingerprint,
          idempotencyKey,
        );
        mutationAttempts.current.set(slot, attempt);
        const created = await backendTrpc.assets.draft.createMcp.mutate({
          name: GITHUB_MCP_PRESET.name,
          slug: GITHUB_MCP_PRESET.slug,
          version: GITHUB_MCP_PRESET.version,
          description: "GitHub MCP",
          endpoint_url: GITHUB_MCP_PRESET.endpointUrl,
          authentication: "bearer",
          bearer_token: token,
          idempotency_key: attempt.idempotencyKey,
        });
        mutationAttempts.current.delete(slot);
        draft = created.draft;
        assetId = draft.asset_id;
        setGithubSetup({
          sessionId: setup.sessionId,
          target: {
            type: "draft",
            assetId,
            draft,
          },
        });
      } else {
        assetId = setup.target.assetId;
        const targetDraft = setup.target.draft;
        const fingerprint = assetMutationFingerprint("mcp.credential.replace", {
          asset_id: assetId,
          target: { type: "draft", draft_id: targetDraft.draft_id },
          setup_session_id: setup.sessionId,
        });
        const slot = `github:${assetId}:draft-credential`;
        const attempt = reuseOrCreateAssetMutationAttempt(
          mutationAttempts.current.get(slot) ?? null,
          fingerprint,
          idempotencyKey,
        );
        mutationAttempts.current.set(slot, attempt);
        const replaced = await backendTrpc.assets.mcp.credential.replace.mutate({
          asset_id: assetId,
          target: {
            type: "draft",
            draft_id: targetDraft.draft_id,
            expected_revision: targetDraft.revision,
          },
          bearer_token: token,
          idempotency_key: attempt.idempotencyKey,
        });
        mutationAttempts.current.delete(slot);
        const replacedDraft = replaced.asset.drafts.find((candidate) => (
          candidate.draft_id === targetDraft.draft_id
        ));
        if (!replacedDraft) throw new Error("GitHub MCP draft missing after credential update");
        draft = replacedDraft;
        setGithubSetup({
          sessionId: setup.sessionId,
          target: { type: "draft", assetId, draft },
        });
      }

      setSelectedId(assetId);
      setLifecycle("draft");
      const validateSlot = `github:${assetId}:validate`;
      const validateFingerprint = assetMutationFingerprint("draft.validate", {
        draft_id: draft.draft_id,
        expected_revision: draft.revision,
      });
      const validateAttempt = reuseOrCreateAssetMutationAttempt(
        mutationAttempts.current.get(validateSlot) ?? null,
        validateFingerprint,
        idempotencyKey,
      );
      mutationAttempts.current.set(validateSlot, validateAttempt);
      const validated = await backendTrpc.assets.draft.validate.mutate({
        draft_id: draft.draft_id,
        expected_revision: draft.revision,
        idempotency_key: validateAttempt.idempotencyKey,
      });
      mutationAttempts.current.delete(validateSlot);
      setGithubSetup({
        sessionId: setup.sessionId,
        target: { type: "draft", assetId, draft: validated.draft },
      });

      const publishSlot = `github:${assetId}:publish`;
      const publishFingerprint = assetMutationFingerprint("publish", {
        draft_id: validated.draft.draft_id,
        expected_revision: validated.draft.revision,
      });
      const publishAttempt = reuseOrCreateAssetMutationAttempt(
        mutationAttempts.current.get(publishSlot) ?? null,
        publishFingerprint,
        idempotencyKey,
      );
      mutationAttempts.current.set(publishSlot, publishAttempt);
      await backendTrpc.assets.publish.mutate({
        draft_id: validated.draft.draft_id,
        expected_revision: validated.draft.revision,
        idempotency_key: publishAttempt.idempotencyKey,
      });
      mutationAttempts.current.delete(publishSlot);
      setGithubSetup(null);
      setLifecycle("published");
      toast.success(t("assets.githubConnected"));
      await Promise.all([refresh(), refreshDetail()]);
    } catch {
      toast.error(t("assets.githubSetupFailed"));
      await Promise.all([refresh(), refreshDetail()]);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      aria-label={t("assets.title")}
      style={{
        background: "var(--ant-color-bg-layout)",
        display: "grid",
        flex: 1,
        gridTemplateColumns: "minmax(280px, 34%) minmax(0, 1fr)",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <aside style={{ background: "var(--ant-color-bg-container)", borderRight: "1px solid var(--ant-color-border-secondary)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <header style={{ alignItems: "center", display: "flex", gap: 8, padding: 16 }}>
          <h4 style={{ flex: 1, margin: 0 }}>{t(`assets.kinds.${kind}`)}</h4>
          <Popover
            content={(
              <SearchBar
                aria-label={t("assets.search")}
                autoFocus
                onInputChange={(value) => {
                  setSearchDraft(value);
                  if (!value) setSearchTerm("");
                }}
                onSearch={(value) => {
                  setSearchTerm(value.trim());
                  setSearchOpen(false);
                }}
                placeholder={t("assets.search")}
                style={{ width: 280 }}
                value={searchDraft}
              />
            )}
            onOpenChange={(open) => {
              setSearchOpen(open);
              if (open) setFilterOpen(false);
            }}
            open={searchOpen}
            placement="bottomRight"
            trigger="click"
          >
            <Tooltip title={t("assets.search")}>
              <Button
                aria-label={t("assets.search")}
                icon={<Search size={15} />}
                shape="circle"
                size="small"
                style={searchTerm ? {
                  background: "var(--ant-color-primary-bg)",
                  color: "var(--fields-color-primary)",
                } : undefined}
                type="text"
              />
            </Tooltip>
          </Popover>
          <Popover
            content={(
              <Segmented
                aria-label={t("assets.lifecycle")}
                block
                onChange={(value) => {
                  setLifecycle(value as AssetLifecycle);
                  setFilterOpen(false);
                }}
                options={[
                  { label: t("assets.states.published"), value: "published" },
                  { label: t("assets.states.draft"), value: "draft" },
                  { label: t("assets.states.archived"), value: "archived" },
                ]}
                style={{ width: 280 }}
                value={lifecycle}
              />
            )}
            onOpenChange={(open) => {
              setFilterOpen(open);
              if (open) setSearchOpen(false);
            }}
            open={filterOpen}
            placement="bottomRight"
            trigger="click"
          >
            <Tooltip title={`${t("assets.lifecycle")}: ${t(`assets.states.${lifecycle}`)}`}>
              <Button
                aria-label={`${t("assets.lifecycle")}: ${t(`assets.states.${lifecycle}`)}`}
                icon={<ListFilter size={15} />}
                shape="circle"
                size="small"
                style={lifecycle !== "published" ? {
                  background: "var(--ant-color-primary-bg)",
                  color: "var(--fields-color-primary)",
                } : undefined}
                type="text"
              />
            </Tooltip>
          </Popover>
          <Tooltip title={t("common.refresh")}>
            <Button
              aria-label={t("common.refresh")}
              icon={<RefreshCw size={15} />}
              loading={loading}
              onClick={() => void Promise.all([refresh(), refreshDetail()])}
              shape="circle"
              size="small"
              type="text"
            />
          </Tooltip>
          <Button
            icon={<Plus size={15} />}
            onClick={() => {
              setImportPreset(null);
              setImportMode(kind === "mcp" ? "mcp" : "zip");
            }}
            type="primary"
          >
            {t(`assets.importActions.${kind}`)}
          </Button>
          {kind === "mcp" && canManageCredentials ? (
            <Button
              icon={<GitBranch size={15} />}
              loading={githubDiscovering}
              onClick={() => void openGitHubSetup()}
            >
              {t("assets.connectGitHub")}
            </Button>
          ) : null}
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 10px 16px" }}>
          {loading && items.length === 0 ? <Centered><Skeleton active paragraph={{ rows: 2 }} /></Centered> : listError && items.length === 0 ? (
            <Centered>
              <Empty
                action={<Button onClick={() => void refresh()}>{t("common.retry")}</Button>}
                description={t("assets.loadFailed")}
              />
            </Centered>
          ) : items.length === 0 ? (
            <Centered>
              <Empty
                action={(
                  <Button
                    icon={<Plus size={15} />}
                    onClick={() => {
                      setImportPreset(null);
                      setImportMode(kind === "mcp" ? "mcp" : "zip");
                    }}
                    type="primary"
                  >
                    {t(`assets.importActions.${kind}`)}
                  </Button>
                )}
                description={t("assets.empty")}
              />
            </Centered>
          ) : items.map((asset) => (
            <button
              aria-current={selectedId === asset.asset_id ? "page" : undefined}
              key={asset.asset_id}
              onClick={() => setSelectedId(asset.asset_id)}
              style={{
                background: selectedId === asset.asset_id ? "var(--ant-color-primary-bg)" : "transparent",
                border: "1px solid transparent",
                borderRadius: 8,
                color: "inherit",
                cursor: "pointer",
                display: "grid",
                gap: 5,
                marginBottom: 4,
                padding: "10px 12px",
                textAlign: "left",
                width: "100%",
              }}
              type="button"
            >
              <strong>{asset.name}</strong>
              <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>
                {asset.current_version ?? t("assets.unpublished")}
                {asset.draft_count > 0 ? ` · ${t("assets.draftCount", { count: asset.draft_count })}` : ""}
              </span>
            </button>
          ))}
          {listError && items.length > 0 ? (
            <div
              role="alert"
              style={{
                alignItems: "center",
                background: "var(--ant-color-error-bg)",
                border: "1px solid var(--ant-color-error-border)",
                borderRadius: 8,
                display: "flex",
                gap: 8,
                margin: "8px 2px",
                padding: "8px 10px",
              }}
            >
              <Text style={{ flex: 1 }} type="danger">{t("assets.loadFailed")}</Text>
              <Button onClick={() => void refresh()} size="small">{t("common.retry")}</Button>
            </div>
          ) : null}
          {nextCursor ? (
            <Button
              block
              loading={loadingMore}
              onClick={() => void loadMore()}
            >
              {t("assets.loadMore")}
            </Button>
          ) : null}
        </div>
      </aside>
      <main style={{ minHeight: 0, overflow: "auto" }}>
        {detailLoading && !detail ? <Centered><Skeleton active paragraph={{ rows: 3 }} /></Centered> : detailError ? (
          <Centered>
            <Empty
              action={<Button onClick={() => void refreshDetail()}>{t("common.retry")}</Button>}
              description={t("assets.readFailed")}
            />
          </Centered>
        ) : detail ? (
          <AssetDetailView
            canManageCredentials={canManageCredentials}
            detail={detail}
            viewLifecycle={lifecycle}
            working={working}
            onArchive={() => setConfirmation({ type: "archive" })}
            onCredential={() => setCredentialOpen(true)}
            onDelete={requestDeleteDraft}
            onEdit={setEditingDraft}
            onNewDraft={() => openNewVersionDraft(detail)}
            onPublish={(draft) => setConfirmation({ type: "publish", draft })}
            onRestore={() => void run({
              action: (key) => backendTrpc.assets.restore.mutate({
                asset_id: detail.summary.asset_id,
                expected_revision: detail.summary.revision,
                idempotency_key: key,
              }),
              attemptSlot: `asset:${detail.summary.asset_id}:lifecycle`,
              fingerprint: assetMutationFingerprint("restore", {
                asset_id: detail.summary.asset_id,
                expected_revision: detail.summary.revision,
              }),
              success: t("assets.restored"),
              nextLifecycle: "published",
            })}
            onValidate={(draft) => void run({
              action: (key) => backendTrpc.assets.draft.validate.mutate({
                draft_id: draft.draft_id,
                expected_revision: draft.revision,
                idempotency_key: key,
              }),
              attemptSlot: `draft:${draft.draft_id}:action`,
              fingerprint: assetMutationFingerprint("draft.validate", {
                draft_id: draft.draft_id,
                expected_revision: draft.revision,
              }),
              success: t("assets.validated"),
            })}
          />
        ) : (
          <Centered><Empty description={t("assets.select")} /></Centered>
        )}
      </main>
      <ImportAssetModal
        canManageCredentials={canManageCredentials}
        kind={kind}
        mode={importMode}
        preset={importPreset}
        onClose={closeImport}
        onCreated={async (draft) => {
          closeImport();
          onTargetChange({
            assetId: draft.asset_id,
            kind: draft.kind,
            lifecycle: "draft",
          });
        }}
        onMode={setImportMode}
      />
      <CredentialModal
        detail={detail}
        open={canManageCredentials && credentialOpen && detail?.summary.lifecycle !== "archived"}
        onClose={() => setCredentialOpen(false)}
        onSaved={() => {
          setCredentialOpen(false);
          void refreshDetail();
        }}
      />
      <GitHubTokenModal
        mode={githubSetup?.target.type ?? null}
        open={githubSetup !== null}
        working={working}
        onClose={() => setGithubSetup(null)}
        onSubmit={(token) => void submitGitHubToken(token)}
      />
      <EditDraftModal
        canManageCredentials={canManageCredentials}
        draft={editingDraft}
        onClose={() => setEditingDraft(null)}
        onSaved={() => {
          setEditingDraft(null);
          void refresh();
          void refreshDetail();
        }}
      />
      <ConfirmAssetActionModal
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAssetAction()}
        working={working}
      />
    </section>
  );
}

function AssetDetailView({
  canManageCredentials,
  detail,
  viewLifecycle,
  working,
  onArchive,
  onCredential,
  onDelete,
  onEdit,
  onNewDraft,
  onPublish,
  onRestore,
  onValidate,
}: {
  canManageCredentials: boolean;
  detail: AssetDetail;
  viewLifecycle: AssetLifecycle;
  working: boolean;
  onArchive: () => void;
  onCredential: () => void;
  onDelete: (draft: AssetDraft) => void;
  onEdit: (draft: AssetDraft) => void;
  onNewDraft: () => void;
  onPublish: (draft: AssetDraft) => void;
  onRestore: () => void;
  onValidate: (draft: AssetDraft) => void;
}) {
  const { t } = useTranslation();
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const previewContext = useRef<string | null>(null);
  const [preview, setPreview] = useState<AssetPreviewState<AssetContent>>({
    status: "idle",
    requestId: 0,
  });
  const draftIdentity = detail.drafts
    .map((draft) => `${draft.draft_id}:${draft.revision}`)
    .join("|");
  const viewedDraft = viewLifecycle === "draft"
    ? resolveDraftSelection(detail.drafts, selectedDraftId)
    : null;
  const viewedVersion = viewedDraft
    ? null
    : resolveVersionSelection(
      detail.versions,
      detail.current?.version_id ?? null,
      selectedVersionId,
    );
  const currentSource = viewedDraft?.source ?? viewedVersion?.source ?? null;
  const viewedFiles = viewedDraft?.files ?? viewedVersion?.files ?? [];
  const viewedValidation = viewedDraft?.validation ?? viewedVersion?.validation ?? null;
  const readOnly = assetLifecycleIsReadOnly(detail.summary.lifecycle);
  const hasBearerCredentialTarget = (
    detail.drafts.some((draft) => (
      draft.source?.type === "mcp" && draft.source.authentication === "bearer"
    ))
    || detail.versions.some((version) => (
      version.source.type === "mcp" && version.source.authentication === "bearer"
    ))
  );
  const canCreateNewVersion = !readOnly
    && viewLifecycle === "published"
    && detail.current !== null
    && (detail.current.source.type !== "mcp"
      || detail.current.source.authentication !== "bearer"
      || canManageCredentials);
  const previewContextKey = viewedDraft
    ? `draft:${viewedDraft.draft_id}:${viewedDraft.revision}`
    : viewedVersion
      ? `version:${viewedVersion.version_id}:${viewedVersion.revision}`
      : null;
  previewContext.current = previewContextKey;
  const previewPath = preview.status === "loading"
    ? preview.path
    : preview.status === "ready"
      ? preview.content.path
      : preview.status === "error"
        ? preview.path
        : null;

  useEffect(() => {
    if (viewLifecycle !== "draft") return;
    setSelectedDraftId((current) => (
      resolveDraftSelection(detail.drafts, current)?.draft_id ?? null
    ));
  }, [detail.summary.asset_id, draftIdentity, viewLifecycle]);

  useEffect(() => {
    if (viewLifecycle === "draft") return;
    setSelectedVersionId((current) => (
      resolveVersionSelection(
        detail.versions,
        detail.current?.version_id ?? null,
        current,
      )?.version_id ?? null
    ));
  }, [
    detail.current?.version_id,
    detail.summary.asset_id,
    detail.versions,
    viewLifecycle,
  ]);

  useEffect(() => {
    const requestId = ++previewRequest.current;
    setPreview({ status: "idle", requestId });
  }, [
    detail.summary.asset_id,
    viewedDraft?.draft_id,
    viewedDraft?.revision,
    viewedVersion?.version_id,
    viewedVersion?.revision,
  ]);

  async function openFile(path: string) {
    const draft = viewedDraft;
    const version = viewedVersion?.version;
    if (!draft && !version) return;
    const contextKey = previewContextKey;
    const requestId = ++previewRequest.current;
    setPreview(beginAssetPreview(requestId, path));
    try {
      const content = await backendTrpc.assets.content.read.query({
        asset_id: detail.summary.asset_id,
        path,
        ...(version ? { version } : { draft_id: draft!.draft_id }),
      });
      if (previewContext.current !== contextKey) return;
      setPreview((current) => settleAssetPreview(current, requestId, {
        ok: true,
        content,
      }));
    } catch {
      if (previewContext.current !== contextKey) return;
      setPreview((current) => settleAssetPreview(current, requestId, {
        ok: false,
        path,
      }));
    }
  }
  return (
    <div style={{ margin: "0 auto", maxWidth: 1040, padding: 28 }}>
      <header style={{ alignItems: "flex-start", display: "flex", gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{detail.summary.name}</h2>
          <Text type="secondary">{detail.summary.slug}</Text>
        </div>
        {canCreateNewVersion ? (
          <Button icon={<Plus size={15} />} onClick={onNewDraft}>
            {t("assets.newVersionDraft")}
          </Button>
        ) : null}
        {!readOnly && canManageCredentials && detail.summary.kind === "mcp" && hasBearerCredentialTarget ? <Button icon={<KeyRound size={15} />} onClick={onCredential}>{t("assets.replaceCredential")}</Button> : null}
        {readOnly
          ? <Button disabled={working} icon={<RotateCcw size={15} />} onClick={onRestore}>{t("assets.restore")}</Button>
          : detail.current
            ? <Button disabled={working} icon={<Archive size={15} />} onClick={onArchive}>{t("assets.archive")}</Button>
            : null}
      </header>
      <Text as="p">{detail.summary.description || t("assets.noDescription")}</Text>
      {viewLifecycle === "draft" && detail.drafts.length > 0 ? (
        <Select
          aria-label={t("assets.draftSelector")}
          onChange={(draftId) => {
            const requestId = ++previewRequest.current;
            setPreview({ status: "idle", requestId });
            setSelectedDraftId(draftId);
          }}
          options={detail.drafts.map((draft) => ({
            label: `${t("assets.draftVersion", { version: draft.version ?? t("assets.versionPending") })} · ${t(`assets.validation.${draft.validation.status}`)}`,
            value: draft.draft_id,
          }))}
          style={{ marginBottom: 18, minWidth: 260 }}
          value={viewedDraft?.draft_id}
        />
      ) : null}
      {viewLifecycle !== "draft" && detail.versions.length > 0 ? (
        <Select
          aria-label={t("assets.versionSelector")}
          onChange={(versionId) => {
            const requestId = ++previewRequest.current;
            setPreview({ status: "idle", requestId });
            setSelectedVersionId(versionId);
          }}
          options={detail.versions.map((version) => ({
            label: `${t("assets.version")} ${version.version} · ${new Date(version.published_at_ms).toLocaleString()}`,
            value: version.version_id,
          }))}
          style={{ marginBottom: 18, minWidth: 260 }}
          value={viewedVersion?.version_id}
        />
      ) : null}
      <Tabs
        items={[
          {
            key: "overview",
            label: t("assets.tabs.overview"),
            children: (
              <div style={{ display: "grid", gap: 18 }}>
                <Section title={t("assets.source")}>
                  <Text>{sourceLabel(currentSource, t)}</Text>
                </Section>
                <Section title={t("assets.capabilities")}>
                  {(viewedValidation?.capabilities.entries.length ?? 0) > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {viewedValidation!.capabilities.entries.map((capability) => (
                        <Tag key={`${capability.kind}:${capability.name}`}>
                          {t(CAPABILITY_KIND_MESSAGE_KEYS[capability.kind])} · {capability.name}
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary">{t("assets.noCapabilities")}</Text>
                  )}
                  {currentSource?.type === "mcp" && viewedValidation ? (
                    <Text style={{ display: "block", marginTop: 8 }} type="secondary">
                      {t(viewedValidation.capabilities.credential_configured
                        ? "assets.credentialConfigured"
                        : "assets.credentialMissing")}
                    </Text>
                  ) : null}
                </Section>
              </div>
            ),
          },
          {
            key: "versions",
            label: t("assets.tabs.versions"),
            children: detail.versions.length === 0
              ? <Empty description={t("assets.noVersions")} />
              : detail.versions.map((version) => (
                <button
                  key={version.version_id}
                  onClick={() => setSelectedVersionId(version.version_id)}
                  style={{
                    background: viewedVersion?.version_id === version.version_id
                      ? "var(--ant-color-fill-tertiary)"
                      : "transparent",
                    border: 0,
                    borderBottom: "1px solid var(--ant-color-border-secondary)",
                    color: "inherit",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 8px",
                    textAlign: "start",
                    width: "100%",
                  }}
                  type="button"
                >
                  <strong>{version.version}</strong>
                  <Text type="secondary">{new Date(version.published_at_ms).toLocaleString()}</Text>
                </button>
              )),
          },
          {
            key: "files",
            label: t("assets.tabs.files"),
            children: (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: viewedFiles.length > 0 ? "minmax(220px, 36%) 1fr" : "1fr",
                  minHeight: 240,
                }}
              >
                {viewedFiles.length === 0 ? (
                  <Empty description={t("assets.noFiles")} />
                ) : (
                  <>
                    <div>{viewedFiles.map((file) => file.type === "file" ? (
                      <Button
                        block
                        key={file.path}
                        onClick={() => void openFile(file.path)}
                        style={{ justifyContent: "flex-start" }}
                        type={previewPath === file.path ? "primary" : "text"}
                      >
                        {file.path}
                      </Button>
                    ) : (
                      <Text key={file.path} style={{ display: "block", padding: "6px 15px" }} type="secondary">
                        {file.path}/
                      </Text>
                    ))}</div>
                    <div aria-live="polite" style={{ minWidth: 0 }}>
                      {preview.status === "idle" ? (
                        <Centered><Empty description={t("assets.selectFile")} /></Centered>
                      ) : preview.status === "loading" ? (
                        <Centered><Skeleton active paragraph={{ rows: 2 }} /></Centered>
                      ) : preview.status === "error" ? (
                        <Centered>
                          <Text role="alert" type="danger">{t("assets.previewFailed")}</Text>
                        </Centered>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <Text strong>{preview.content.path}</Text>
                            <Text type="secondary">
                              {preview.content.mime_type} · {formatAssetBytes(preview.content.size_bytes)} · SHA-256 {preview.content.sha256.slice(0, 12)}
                            </Text>
                            {preview.content.preview_truncated ? <Tag color="warning">{t("assets.previewTruncated")}</Tag> : null}
                          </div>
                          <pre style={{ background: "var(--ant-color-fill-quaternary)", borderRadius: 8, margin: 0, overflow: "auto", padding: 14, whiteSpace: "pre-wrap" }}>
                            {preview.content.text ?? t("assets.binaryPreview")}
                          </pre>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ),
          },
          {
            key: "validation",
            label: t("assets.tabs.validation"),
            children: !viewedValidation ? (
              <Empty description={t("assets.noValidation")} />
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Tag color={viewedValidation.status === "valid" ? "success" : viewedValidation.status === "invalid" ? "error" : "default"}>
                    {t(`assets.validation.${viewedValidation.status}`)}
                  </Tag>
                  {viewedValidation.validator ? (
                    <Text type="secondary">
                      {t("assets.validator", { validator: viewedValidation.validator })}
                    </Text>
                  ) : null}
                  {viewedValidation.validated_at_ms !== null ? (
                    <Text type="secondary">
                      {new Date(viewedValidation.validated_at_ms).toLocaleString()}
                    </Text>
                  ) : null}
                </div>
                {viewedValidation.issues.length === 0 ? (
                  <Empty description={t("assets.noValidationIssues")} />
                ) : viewedValidation.issues.map((issue, index) => (
                  <div key={`${issue.code}:${issue.path ?? ""}:${index}`} style={{ display: "grid", gap: 6, borderBottom: "1px solid var(--ant-color-border-secondary)", padding: "10px 0" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                      <Tag color={issue.severity === "error" ? "error" : "warning"}>
                        {t(`assets.issueSeverity.${issue.severity}`)}
                      </Tag>
                      <Text>{t(assetValidationIssueMessageKey(issue.code))}</Text>
                    </div>
                    {issue.path ? (
                      <Text
                        code
                        style={{ overflowWrap: "anywhere" }}
                        type="secondary"
                      >
                        {issue.path}
                      </Text>
                    ) : null}
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />
      {detail.drafts.map((draft) => (
        <section
          key={draft.draft_id}
          style={{
            background: "var(--ant-color-bg-container)",
            border: `1px solid ${viewedDraft?.draft_id === draft.draft_id ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)"}`,
            borderRadius: 10,
            marginTop: 18,
            padding: 16,
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <strong style={{ flex: 1 }}>{t("assets.draftVersion", { version: draft.version ?? t("assets.versionPending") })}</strong>
            <Tag color={draft.validation.status === "valid" ? "success" : draft.validation.status === "invalid" ? "error" : "default"}>{t(`assets.validation.${draft.validation.status}`)}</Tag>
            {readOnly ? null : (
              <>
                <Tooltip title={t("assets.editDraft")}>
                  <Button aria-label={t("assets.editDraft")} disabled={working} icon={<Pencil size={15} />} onClick={() => onEdit(draft)} />
                </Tooltip>
                <Button disabled={working} onClick={() => onValidate(draft)}>{t("assets.validate")}</Button>
                <Button disabled={working || draft.validation.status !== "valid"} onClick={() => onPublish(draft)} type="primary">{t("assets.publish")}</Button>
                <Tooltip title={t("assets.deleteDraft")}>
                  <Button aria-label={t("assets.deleteDraft")} danger disabled={working} icon={<Trash2 size={15} />} onClick={() => onDelete(draft)} />
                </Tooltip>
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ImportAssetModal({
  canManageCredentials,
  kind,
  mode,
  preset,
  onClose,
  onCreated,
  onMode,
}: {
  canManageCredentials: boolean;
  kind: AssetKind;
  mode: ImportMode | null;
  preset: AssetImportPreset | null;
  onClose: () => void;
  onCreated: (draft: AssetDraft) => Promise<void>;
  onMode: (mode: ImportMode) => void;
}) {
  const { t } = useTranslation();
  const toast = useAssetToast();
  const packageKind: PackageAssetKind = kind === "skill" ? "skill" : "plugin";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [subdirectory, setSubdirectory] = useState("");
  const [authentication, setAuthentication] = useState<"none" | "bearer">("none");
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileRejected, setFileRejected] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const createAttempt = useRef<AssetMutationAttempt | null>(null);
  const zipAttempt = useRef<ZipUploadAttempt<AssetDraft> | null>(null);
  const requiresVersion = mode === "mcp" || packageKind === "skill";
  const bearerTokenMissing = mode === "mcp"
    && authentication === "bearer"
    && (!canManageCredentials || !token);
  const modePresentation: Record<ImportMode, { icon: React.ReactNode; label: string }> = {
    zip: { icon: <FileArchive size={14} />, label: "ZIP" },
    git: { icon: <GitBranch size={14} />, label: "Git" },
    mcp: { icon: <Server size={14} />, label: "MCP" },
  };
  const modeOptions = allowedAssetImportModes(kind).map((value) => ({
    ...modePresentation[value],
    value,
  }));

  useEffect(() => {
    if (mode !== null) return;
    setName("");
    setSlug("");
    setVersion("");
    setDescription("");
    setUrl("");
    setSubdirectory("");
    setAuthentication("none");
    setToken("");
    setFile(null);
    setFileRejected(false);
    setSubmitted(false);
    setSubmitFailed(false);
    createAttempt.current = null;
    zipAttempt.current = null;
  }, [mode]);

  useEffect(() => {
    if (!preset) return;
    setName(preset.name);
    setSlug(preset.slug);
    setVersion("");
    setDescription(preset.description);
    setFile(null);
    setFileRejected(false);
    setSubmitted(false);
    setSubmitFailed(false);
    setToken("");
    if (preset.source.type === "git") {
      setUrl(preset.source.repository_url);
      setSubdirectory(preset.source.subdirectory ?? "");
      setAuthentication("none");
    } else if (preset.source.type === "mcp") {
      setUrl(preset.source.endpoint_url);
      setSubdirectory("");
      setAuthentication(preset.source.authentication);
    } else {
      setUrl("");
      setSubdirectory("");
      setAuthentication("none");
    }
    zipAttempt.current = null;
  }, [preset]);

  async function submit() {
    setSubmitted(true);
    setSubmitFailed(false);
    if (
      !mode
      || !name
      || !slug
      || (requiresVersion && !version)
      || (mode === "zip" && !file)
      || ((mode === "git" || mode === "mcp") && !url)
      || bearerTokenMissing
    ) return;
    setWorking(true);
    try {
      let draft: AssetDraft;
      if (mode === "git") {
        const fingerprint = assetMutationFingerprint("draft.importGit", {
          kind: packageKind,
          repository_url: url,
          subdirectory: subdirectory || null,
          name,
          slug,
          version: packageKind === "skill" ? version : null,
          description,
        });
        const attempt = reuseOrCreateAssetMutationAttempt(
          createAttempt.current,
          fingerprint,
          idempotencyKey,
        );
        createAttempt.current = attempt;
        const result = await backendTrpc.assets.draft.importGit.mutate(
          packageKind === "skill"
            ? {
              kind: "skill",
              repository_url: url,
              subdirectory: subdirectory || null,
              name,
              slug,
              version,
              description,
              idempotency_key: attempt.idempotencyKey,
            }
            : {
              kind: "plugin",
              repository_url: url,
              subdirectory: subdirectory || null,
              name,
              slug,
              version: null,
              description,
              idempotency_key: attempt.idempotencyKey,
            },
        );
        createAttempt.current = null;
        draft = result.draft;
      } else if (mode === "mcp") {
        const fingerprint = assetMutationFingerprint("draft.createMcp", {
          name,
          slug,
          version,
          description,
          endpoint_url: url,
          authentication,
          bearer_token: authentication === "bearer" ? token : undefined,
        });
        const attempt = reuseOrCreateAssetMutationAttempt(
          createAttempt.current,
          fingerprint,
          idempotencyKey,
        );
        createAttempt.current = attempt;
        const result = await backendTrpc.assets.draft.createMcp.mutate({
          name,
          slug,
          version,
          description,
          endpoint_url: url,
          authentication,
          ...(authentication === "bearer" ? { bearer_token: token } : {}),
          idempotency_key: attempt.idempotencyKey,
        });
        createAttempt.current = null;
        draft = result.draft;
      } else {
        if (!file) return;
        const fingerprint = zipAttemptFingerprint({
          kind: packageKind,
          name,
          slug,
          version: packageKind === "skill" ? version : null,
          description,
          file: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          },
        });
        let attempt = reuseOrCreateZipUploadAttempt(
          zipAttempt.current,
          fingerprint,
          idempotencyKey,
        );
        zipAttempt.current = attempt;
        if (!attempt.begunDraft) {
          const begun = await backendTrpc.assets.draft.beginZip.mutate(
            packageKind === "skill"
              ? {
                kind: "skill",
                name,
                slug,
                version,
                description,
                file_name: file.name,
                idempotency_key: attempt.beginIdempotencyKey,
              }
              : {
                kind: "plugin",
                name,
                slug,
                version: null,
                description,
                file_name: file.name,
                idempotency_key: attempt.beginIdempotencyKey,
              },
          );
          attempt = { ...attempt, begunDraft: begun.draft };
          zipAttempt.current = attempt;
        }
        const begunDraft = attempt.begunDraft;
        if (!begunDraft) throw new Error("asset ZIP draft was not begun");
        const response = await authFetch(
          backendApiUrl(`/api/v1/assets/drafts/${encodeURIComponent(begunDraft.draft_id)}/package`),
          {
            method: "POST",
            headers: {
              "content-type": "application/octet-stream",
              "x-fields-expected-revision": String(begunDraft.revision),
              "x-fields-idempotency-key": attempt.uploadIdempotencyKey,
            },
            body: file,
          },
        );
        if (!response.ok) throw new Error("asset package upload failed");
        const uploaded = await response.json() as { draft: AssetDraft };
        draft = uploaded.draft;
        zipAttempt.current = null;
      }
      toast.success(t("assets.draftCreated"));
      await onCreated(draft);
    } catch {
      setSubmitFailed(true);
      toast.error(t("assets.importFailed"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>{t("common.cancel")}</Button>,
        <Button
          disabled={
            !name
            || !slug
            || (requiresVersion && !version)
            || (mode === "zip" && !file)
            || ((mode === "git" || mode === "mcp") && !url)
            || bearerTokenMissing
          }
          key="submit"
          loading={working}
          onClick={() => void submit()}
          type="primary"
        >
          {t("assets.createDraft")}
        </Button>,
      ]}
      onCancel={onClose}
      open={mode !== null}
      title={t(preset ? "assets.newVersionDraft" : `assets.importActions.${kind}`)}
    >
      {modeOptions.length > 1 ? (
        <Segmented
          aria-label={t("assets.importSource")}
          block
          onChange={(value) => onMode(value as ImportMode)}
          options={modeOptions}
          value={mode ?? modeOptions[0]?.value}
        />
      ) : null}
      <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
        {submitFailed ? <Text role="alert" type="danger">{t("assets.importFailed")}</Text> : null}
        <AssetField
          error={submitted && !name ? t("assets.fieldRequired") : undefined}
          label={t("assets.name")}
          required
        >
          <Input
            aria-label={t("assets.name")}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("assets.namePlaceholder")}
            status={submitted && !name ? "error" : undefined}
            value={name}
          />
        </AssetField>
        <AssetField
          error={submitted && !slug ? t("assets.fieldRequired") : undefined}
          hint={t("assets.slugHint")}
          label={t("assets.slug")}
          required
        >
          <Input
            aria-label={t("assets.slug")}
            disabled={preset !== null}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={t("assets.slugPlaceholder")}
            status={submitted && !slug ? "error" : undefined}
            value={slug}
          />
        </AssetField>
        {requiresVersion ? (
          <AssetField
            error={submitted && !version ? t("assets.fieldRequired") : undefined}
            hint={t("assets.versionHint")}
            label={t("assets.version")}
            required
          >
            <Input
              aria-label={t("assets.version")}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="1.0.0"
              status={submitted && !version ? "error" : undefined}
              value={version}
            />
          </AssetField>
        ) : null}
        <AssetField label={t("assets.description")}>
          <TextArea
            aria-label={t("assets.description")}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("assets.descriptionPlaceholder")}
            value={description}
          />
        </AssetField>
        {mode === "zip" ? (
          <AssetField
            error={
              fileRejected
                ? t("assets.zipTooLarge")
                : submitted && !file
                  ? t("assets.fieldRequired")
                  : undefined
            }
            hint={t("assets.zipHint")}
            label={t("assets.packageFile")}
            required
          >
            <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
              <FilePickButton
                accept=".zip,application/zip"
                icon={<FileArchive size={15} />}
                maxFileSizeBytes={ZIP_UPLOAD_MAX_BYTES}
                multiple={false}
                onFilesPicked={(files) => {
                  setFile(files[0]?.file ?? null);
                  setFileRejected(false);
                  zipAttempt.current = null;
                }}
                onFilesRejected={() => {
                  setFile(null);
                  setFileRejected(true);
                  zipAttempt.current = null;
                }}
              >
                {t("assets.chooseZip")}
              </FilePickButton>
              <Text ellipsis style={{ minWidth: 0 }} type={file ? undefined : "secondary"}>
                {file
                  ? `${file.name} (${formatAssetBytes(file.size)})`
                  : t("assets.noFileSelected")}
              </Text>
            </div>
          </AssetField>
        ) : null}
        {mode === "git" ? (
          <>
            <AssetField
              error={submitted && !url ? t("assets.fieldRequired") : undefined}
              label={t("assets.gitUrl")}
              required
            >
              <Input
                aria-label={t("assets.gitUrl")}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/company/repository"
                status={submitted && !url ? "error" : undefined}
                value={url}
              />
            </AssetField>
            <AssetField hint={t("assets.subdirectoryHint")} label={t("assets.subdirectory")}>
              <Input
                aria-label={t("assets.subdirectory")}
                onChange={(event) => setSubdirectory(event.target.value)}
                placeholder={t("assets.subdirectoryPlaceholder")}
                value={subdirectory}
              />
            </AssetField>
          </>
        ) : null}
        {mode === "mcp" ? (
          <>
            <AssetField
              error={submitted && !url ? t("assets.fieldRequired") : undefined}
              label={t("assets.endpoint")}
              required
            >
              <Input
                aria-label={t("assets.endpoint")}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
                status={submitted && !url ? "error" : undefined}
                value={url}
              />
            </AssetField>
            <AssetField label={t("assets.authentication")} required>
              <Select
                aria-label={t("assets.authentication")}
                onChange={setAuthentication}
                options={[
                  { label: t("assets.noAuthentication"), value: "none" },
                  ...(canManageCredentials
                    ? [{ label: t("assets.bearer"), value: "bearer" as const }]
                    : []),
                ]}
                value={authentication}
              />
            </AssetField>
            {authentication === "bearer" && canManageCredentials ? (
              <AssetField
                error={bearerTokenMissing && submitted ? t("assets.bearerRequired") : undefined}
                label={t("assets.bearerToken")}
                required
              >
                <InputPassword
                  aria-label={t("assets.bearerToken")}
                  status={bearerTokenMissing && submitted ? "error" : undefined}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={t("assets.bearerTokenPlaceholder")}
                  value={token}
                />
              </AssetField>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function EditDraftModal({
  canManageCredentials,
  draft,
  onClose,
  onSaved,
}: {
  canManageCredentials: boolean;
  draft: AssetDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useAssetToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [authentication, setAuthentication] = useState<"none" | "bearer">("none");
  const [submitted, setSubmitted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const updateAttempt = useRef<AssetMutationAttempt | null>(null);

  useEffect(() => {
    setName(draft?.name ?? "");
    setSlug(draft?.slug ?? "");
    setVersion(draft?.version ?? "");
    setDescription(draft?.description ?? "");
    setEndpoint(draft?.source?.type === "mcp" ? draft.source.endpoint_url : "");
    setAuthentication(draft?.source?.type === "mcp" ? draft.source.authentication : "none");
    setSubmitted(false);
    setSaveFailed(false);
    updateAttempt.current = null;
  }, [draft]);

  if (!draft) return null;
  const currentDraft = draft;
  const versionMissing = currentDraft.kind !== "plugin" && !version;

  async function save() {
    setSubmitted(true);
    setSaveFailed(false);
    if (
      !name
      || !slug
      || versionMissing
      || (currentDraft.kind === "mcp" && !endpoint)
    ) return;
    const fingerprint = assetMutationFingerprint("draft.update", {
      draft_id: currentDraft.draft_id,
      expected_revision: currentDraft.revision,
      name,
      slug,
      description,
      version: currentDraft.kind === "plugin" ? undefined : version,
      endpoint_url: currentDraft.kind === "mcp" && canManageCredentials
        ? endpoint
        : undefined,
      authentication: currentDraft.kind === "mcp" && canManageCredentials
        ? authentication
        : undefined,
    });
    const attempt = reuseOrCreateAssetMutationAttempt(
      updateAttempt.current,
      fingerprint,
      idempotencyKey,
    );
    updateAttempt.current = attempt;
    setWorking(true);
    try {
      await backendTrpc.assets.draft.update.mutate({
        draft_id: currentDraft.draft_id,
        expected_revision: currentDraft.revision,
        name,
        slug,
        description,
        ...(currentDraft.kind === "plugin" ? {} : { version }),
        ...(currentDraft.kind === "mcp" && canManageCredentials ? {
          endpoint_url: endpoint,
          authentication,
        } : {}),
        idempotency_key: attempt.idempotencyKey,
      });
      updateAttempt.current = null;
      toast.success(t("assets.draftUpdated"));
      onSaved();
    } catch {
      setSaveFailed(true);
      toast.error(t("assets.actionFailed"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>{t("common.cancel")}</Button>,
        <Button
          disabled={!name || !slug || versionMissing || (draft.kind === "mcp" && !endpoint)}
          key="save"
          loading={working}
          onClick={() => void save()}
          type="primary"
        >
          {t("common.save")}
        </Button>,
      ]}
      onCancel={onClose}
      open
      title={t("assets.editDraft")}
    >
      <div style={{ display: "grid", gap: 16 }}>
        {saveFailed ? <Text role="alert" type="danger">{t("assets.actionFailed")}</Text> : null}
        <AssetField
          error={submitted && !name ? t("assets.fieldRequired") : undefined}
          label={t("assets.name")}
          required
        >
          <Input
            aria-label={t("assets.name")}
            onChange={(event) => setName(event.target.value)}
            status={submitted && !name ? "error" : undefined}
            value={name}
          />
        </AssetField>
        <AssetField
          error={submitted && !slug ? t("assets.fieldRequired") : undefined}
          hint={t("assets.slugHint")}
          label={t("assets.slug")}
          required
        >
          <Input
            aria-label={t("assets.slug")}
            onChange={(event) => setSlug(event.target.value)}
            status={submitted && !slug ? "error" : undefined}
            value={slug}
          />
        </AssetField>
        {draft.kind !== "plugin" ? (
          <AssetField
            error={submitted && !version ? t("assets.fieldRequired") : undefined}
            hint={t("assets.versionHint")}
            label={t("assets.version")}
            required
          >
            <Input
              aria-label={t("assets.version")}
              onChange={(event) => setVersion(event.target.value)}
              status={submitted && !version ? "error" : undefined}
              value={version}
            />
          </AssetField>
        ) : null}
        <AssetField label={t("assets.description")}>
          <TextArea
            aria-label={t("assets.description")}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </AssetField>
        {draft.kind === "mcp" ? (
          <>
            <AssetField
              error={submitted && !endpoint ? t("assets.fieldRequired") : undefined}
              label={t("assets.endpoint")}
              required
            >
              <Input
                aria-label={t("assets.endpoint")}
                disabled={!canManageCredentials}
                onChange={(event) => setEndpoint(event.target.value)}
                status={submitted && !endpoint ? "error" : undefined}
                value={endpoint}
              />
            </AssetField>
            <AssetField label={t("assets.authentication")} required>
              <Select
                aria-label={t("assets.authentication")}
                disabled={!canManageCredentials}
                onChange={setAuthentication}
                options={[
                  { label: t("assets.noAuthentication"), value: "none" },
                  { label: t("assets.bearer"), value: "bearer" },
                ]}
                value={authentication}
              />
            </AssetField>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function GitHubTokenModal({
  mode,
  open,
  working,
  onClose,
  onSubmit,
}: {
  mode: GitHubSetupTarget["type"] | null;
  open: boolean;
  working: boolean;
  onClose: () => void;
  onSubmit: (token: string) => void;
}) {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken("");
  }, [mode, open]);
  return (
    <Modal
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>{t("common.cancel")}</Button>,
        <Button
          disabled={!token}
          key="connect"
          loading={working}
          onClick={() => onSubmit(token)}
          type="primary"
        >
          {t(mode === "version" ? "assets.updateGitHubToken" : "assets.connectGitHub")}
        </Button>,
      ]}
      onCancel={onClose}
      open={open}
      title={t(mode === "version" ? "assets.updateGitHubToken" : "assets.connectGitHub")}
    >
      <div style={{ display: "grid", gap: 16 }}>
        <Text>{t("assets.githubTokenInstructions")}</Text>
        <Button
          icon={<GitBranch size={15} />}
          onClick={() => openExternalUrl(githubFineGrainedPatUrl())}
        >
          {t("assets.createGitHubToken")}
        </Button>
        <AssetField
          hint={t("assets.githubTokenPermissions")}
          label={t("assets.bearerToken")}
          required
        >
          <InputPassword
            aria-label={t("assets.bearerToken")}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t("assets.bearerTokenPlaceholder")}
            value={token}
          />
        </AssetField>
      </div>
    </Modal>
  );
}

function CredentialModal({
  detail,
  open,
  onClose,
  onSaved,
}: {
  detail: AssetDetail | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useAssetToast();
  const [token, setToken] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [working, setWorking] = useState(false);
  const credentialAttempt = useRef<AssetMutationAttempt | null>(null);
  const targets = detail ? [
    ...detail.drafts.filter((draft) => (
      draft.source?.type === "mcp" && draft.source.authentication === "bearer"
    )).map((draft) => ({
      key: `draft:${draft.draft_id}`,
      configured: draft.source?.type === "mcp" && draft.source.credential_configured,
      label: t("assets.draftVersion", { version: draft.version ?? t("assets.versionPending") }),
      target: {
        type: "draft" as const,
        draft_id: draft.draft_id,
        expected_revision: draft.revision,
      },
    })),
    ...detail.versions.filter((version) => (
      version.source.type === "mcp" && version.source.authentication === "bearer"
    )).map((version) => ({
      key: `version:${version.version_id}`,
      configured: (
        version.source.type === "mcp" && version.source.credential_configured
      ),
      label: `${t("assets.version")} ${version.version}`,
      target: {
        type: "version" as const,
        version_id: version.version_id,
        expected_revision: version.revision,
      },
    })),
  ] : [];
  useEffect(() => {
    setToken("");
    setTargetKey(open ? targets[0]?.key ?? "" : "");
    setConfirmClear(false);
    credentialAttempt.current = null;
  }, [detail?.summary.asset_id, open]);
  async function save(nextToken: string | null) {
    const selected = targets.find((target) => target.key === targetKey);
    if (!detail || !selected) return;
    const fingerprint = assetMutationFingerprint("mcp.credential.replace", {
      asset_id: detail.summary.asset_id,
      target: selected.target,
      bearer_token: nextToken,
    });
    const attempt = reuseOrCreateAssetMutationAttempt(
      credentialAttempt.current,
      fingerprint,
      idempotencyKey,
    );
    credentialAttempt.current = attempt;
    setWorking(true);
    try {
      await backendTrpc.assets.mcp.credential.replace.mutate({
        asset_id: detail.summary.asset_id,
        target: selected.target,
        bearer_token: nextToken,
        idempotency_key: attempt.idempotencyKey,
      });
      credentialAttempt.current = null;
      toast.success(t("assets.credentialSaved"));
      onSaved();
    } catch {
      toast.error(t("assets.actionFailed"));
    } finally {
      setWorking(false);
    }
  }
  const selectedTarget = targets.find((target) => target.key === targetKey);
  return (
    <>
      <Modal
        footer={[
          <Button key="cancel" onClick={onClose}>{t("common.cancel")}</Button>,
          <Button
            danger
            disabled={!selectedTarget?.configured}
            key="clear"
            loading={working}
            onClick={() => setConfirmClear(true)}
          >
            {t("assets.clearCredential")}
          </Button>,
          <Button disabled={!token || !selectedTarget} key="save" loading={working} onClick={() => void save(token)} type="primary">{t("common.save")}</Button>,
        ]}
        onCancel={onClose}
        open={open}
        title={t("assets.replaceCredential")}
      >
        {targets.length === 0 ? (
          <Empty description={t("assets.noCredentialTargets")} />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <AssetField label={t("assets.credentialTarget")} required>
              <Select
                aria-label={t("assets.credentialTarget")}
                onChange={(value) => {
                  setTargetKey(value);
                  setToken("");
                  credentialAttempt.current = null;
                }}
                options={targets.map((target) => ({ label: target.label, value: target.key }))}
                style={{ width: "100%" }}
                value={targetKey || undefined}
              />
            </AssetField>
            <AssetField hint={t("assets.credentialNotDisplayed")} label={t("assets.bearerToken")} required>
              <InputPassword
                aria-label={t("assets.bearerToken")}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("assets.bearerTokenPlaceholder")}
                value={token}
              />
            </AssetField>
          </div>
        )}
      </Modal>
      <Modal
        footer={[
          <Button key="cancel" onClick={() => setConfirmClear(false)}>{t("common.cancel")}</Button>,
          <Button
            danger
            key="confirm"
            loading={working}
            onClick={() => {
              setConfirmClear(false);
              void save(null);
            }}
          >
            {t("assets.clearCredential")}
          </Button>,
        ]}
        onCancel={() => setConfirmClear(false)}
        open={confirmClear}
        title={t("assets.confirmClearCredentialTitle")}
      >
        <Text>{t("assets.confirmClearCredentialBody")}</Text>
      </Modal>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h5>{title}</h5>{children}</section>;
}

function AssetField({
  children,
  error,
  hint,
  label,
  required = false,
}: {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Text strong style={{ fontSize: 13 }}>
        {label}
        {required ? <span aria-hidden style={{ color: "var(--ant-color-error)", marginInlineStart: 4 }}>*</span> : null}
      </Text>
      {children}
      {error ? <Text role="alert" style={{ fontSize: 12 }} type="danger">{error}</Text> : hint ? (
        <Text style={{ fontSize: 12 }} type="secondary">{hint}</Text>
      ) : null}
    </div>
  );
}

function ConfirmAssetActionModal({
  confirmation,
  onCancel,
  onConfirm,
  working,
}: {
  confirmation: AssetConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
  working: boolean;
}) {
  const { t } = useTranslation();
  if (!confirmation) return null;
  const isDelete = confirmation.type === "delete";
  const danger = confirmation.type === "archive" || isDelete;
  const title = confirmation.type === "archive"
    ? t("assets.confirmArchiveTitle")
    : confirmation.type === "publish"
      ? t("assets.confirmPublishTitle")
      : confirmation.deletesAsset
        ? t("assets.confirmDeleteAssetTitle")
        : t("assets.confirmDeleteDraftTitle");
  const body = confirmation.type === "archive"
    ? t("assets.confirmArchiveBody")
    : confirmation.type === "publish"
      ? t("assets.confirmPublishBody", {
        version: confirmation.draft.version ?? t("assets.versionPending"),
      })
      : confirmation.deletesAsset
        ? t("assets.confirmDeleteAssetBody")
        : t("assets.confirmDeleteDraftBody");
  const actionLabel = confirmation.type === "archive"
    ? t("assets.archive")
    : confirmation.type === "publish"
      ? t("assets.publish")
      : confirmation.deletesAsset
        ? t("assets.deleteAsset")
        : t("assets.deleteDraft");
  return (
    <Modal
      footer={[
        <Button key="cancel" onClick={onCancel}>{t("common.cancel")}</Button>,
        <Button
          danger={danger}
          key="confirm"
          loading={working}
          onClick={onConfirm}
          type={danger ? "default" : "primary"}
        >
          {actionLabel}
        </Button>,
      ]}
      onCancel={onCancel}
      open
      title={title}
    >
      <Text>{body}</Text>
    </Modal>
  );
}

function useAssetToast() {
  const toast = useToast();
  return useMemo(() => ({
    error: (title: string) => toast.error({ title }),
    success: (title: string) => toast.success({ title }),
  }), [toast]);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ alignItems: "center", display: "flex", height: "100%", justifyContent: "center", minHeight: 240 }}>{children}</div>;
}

function sourceLabel(
  source: AssetSource | AssetDraft["source"] | null,
  t: (key: string) => string,
): string {
  if (!source) return t("assets.sourcePending");
  if (source.type === "zip") return `ZIP · ${source.file_name}`;
  if (source.type === "git") {
    return [
      "Git",
      source.repository_url,
      source.commit_sha.slice(0, 8),
      source.subdirectory,
    ].filter(Boolean).join(" · ");
  }
  return [
    "MCP",
    source.endpoint_url,
    source.authentication === "none"
      ? t("assets.noAuthentication")
      : t(source.credential_configured
        ? "assets.credentialConfigured"
        : "assets.credentialMissing"),
  ].join(" · ");
}

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
