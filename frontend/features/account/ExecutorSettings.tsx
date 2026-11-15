import type {
  CompanySharedPoolExecutorSummary,
  ExecutorDeviceAuthorizationStartResult,
  ExecutorSafeSummary,
  ExecutorUsageTarget,
  PersonalExecutorSummary,
} from "@fields/contracts/public/executor";
import { Alert, Block, copyToClipboard, Flexbox, Text } from "@lobehub/ui";
import { Button, Input, Tooltip } from "@lobehub/ui/base-ui";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { authServiceErrorMessage } from "../../data/auth/auth-machine-services";
import { ONBOARDING_POLL_INTERVAL_MS } from "../../data/auth/entry-state";
import { backendTrpc } from "../../data/boundary/backend-trpc";
import { openExternalUrl } from "../../shared/platform/external-navigation";
import { CompanyProxySettings } from "./CompanyProxySettings";
import { DesktopBrowserSettings } from "./DesktopBrowserSettings";
import { DesktopBrowserStage } from "../desktop-browser/DesktopBrowserStage";

type PendingAction = "disconnect" | "unshare" | "delete";

export function ExecutorSettings({
  actorId,
  companyId,
  canGovern = false,
  onCreate,
  onConfigureModels,
}: {
  actorId: string;
  companyId: string;
  canGovern?: boolean;
  onCreate: () => void;
  onConfigureModels: (executor: PersonalExecutorSummary) => void;
}) {
  const { t } = useTranslation();
  const [executors, setExecutors] = useState<PersonalExecutorSummary[]>([]);
  const [sharedPool, setSharedPool] = useState<
    CompanySharedPoolExecutorSummary[]
  >([]);
  const [usageByExecutor, setUsageByExecutor] = useState<
    Record<string, ExecutorUsageTarget[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [authorization, setAuthorization] =
    useState<ExecutorDeviceAuthorizationStartResult | null>(null);
  const [pending, setPending] = useState<{
    executor: PersonalExecutorSummary;
    action: PendingAction;
    usage: ExecutorUsageTarget[];
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, pool] = await Promise.all([
        backendTrpc.account.executors.list.query(),
        canGovern
          ? backendTrpc.company.executors.sharedPool.query()
          : Promise.resolve({ items: [] }),
      ]);
      setExecutors(mine.items);
      setSharedPool(pool.items);
      const usage = await Promise.all(
        mine.items.map((executor) =>
          backendTrpc.account.executors.usage.query({
            executor_id: executor.executor_id,
          }),
        ),
      );
      setUsageByExecutor(
        Object.fromEntries(
          usage.map((result) => [result.executor_id, result.items]),
        ),
      );
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [canGovern]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!authorization) return;
    const timer = setInterval(() => {
      void backendTrpc.account.executors.authorization.status
        .query({
          executor_id: authorization.executor_id,
          attempt_id: authorization.attempt_id,
        })
        .then((status) => {
          if (status.status === "completed") {
            setAuthorization(null);
            void refresh();
          } else if (
            status.status === "cancelled" ||
            status.status === "failed"
          )
            setAuthorization(null);
        })
        .catch(setError);
    }, ONBOARDING_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [authorization, refresh]);

  async function authorize(executorId: string) {
    try {
      const result =
        await backendTrpc.account.executors.authorization.start.mutate({
          executor_id: executorId,
        });
      setAuthorization(result);
      if (!window.fieldsDesktop) openExternalUrl(result.verification_url);
    } catch (cause) {
      setError(cause);
    }
  }
  async function cancelAuthorization() {
    if (!authorization) return;
    try {
      await backendTrpc.account.executors.authorization.cancel.mutate({
        executor_id: authorization.executor_id,
        attempt_id: authorization.attempt_id,
      });
      setAuthorization(null);
    } catch (cause) {
      setError(cause);
    }
  }
  async function shareExecutor(executor: PersonalExecutorSummary) {
    setBusy(executor.executor_id);
    try {
      const result = await backendTrpc.account.executors.share.mutate({
        executor_id: executor.executor_id,
      });
      if ("executor" in result && result.executor) {
        replaceExecutor(result.executor as PersonalExecutorSummary);
      }
      await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }
  async function rename(executor: PersonalExecutorSummary, value: string) {
    const next = value.trim();
    if (!next || next === executor.name) return;
    replaceExecutor(
      (
        await backendTrpc.account.executors.rename.mutate({
          executor_id: executor.executor_id,
          name: next,
        })
      ).executor,
    );
  }
  async function inspectImpact(
    executor: PersonalExecutorSummary,
    action: PendingAction,
  ) {
    try {
      const usage = await backendTrpc.account.executors.usage.query({
        executor_id: executor.executor_id,
      });
      setPending({ executor, action, usage: usage.items });
    } catch (cause) {
      setError(cause);
    }
  }
  async function confirmPending() {
    if (!pending) return;
    setBusy(pending.executor.executor_id);
    try {
      const input = { executor_id: pending.executor.executor_id };
      if (pending.action === "disconnect")
        replaceExecutor(
          (await backendTrpc.account.executors.disconnect.mutate(input))
            .executor,
        );
      else if (pending.action === "unshare")
        replaceExecutor(
          (await backendTrpc.account.executors.unshare.mutate(input)).executor,
        );
      else {
        await backendTrpc.account.executors.delete.mutate(input);
        setExecutors((items) =>
          items.filter(
            (item) => item.executor_id !== pending.executor.executor_id,
          ),
        );
      }
      setPending(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }
  function replaceExecutor(next: PersonalExecutorSummary) {
    setExecutors((items) =>
      items.map((item) =>
        item.executor_id === next.executor_id ? next : item,
      ),
    );
  }
  async function govern(executor: CompanySharedPoolExecutorSummary) {
    try {
      const input = { executor_id: executor.executor_id };
      const result =
        executor.sharing_status === "company_shared"
          ? await backendTrpc.company.executors.blockSharing.mutate(input)
          : await backendTrpc.company.executors.unblockSharing.mutate(input);
      if (result.sharing_status === "private")
        setSharedPool((items) =>
          items.filter((item) => item.executor_id !== executor.executor_id),
        );
      else {
        const sharingStatus = result.sharing_status as
          "company_shared" | "admin_blocked";
        setSharedPool((items) =>
          items.map((item) =>
            item.executor_id === executor.executor_id
              ? {
                ...item,
                ...result.executor,
                scope: "personal",
                sharing_status: sharingStatus,
              }
              : item,
          ),
        );
      }
    } catch (cause) {
      setError(cause);
    }
  }

  if (authorization && window.fieldsDesktop) {
    return (
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <DesktopBrowserStage actorId={actorId} companyId={companyId} initialUrl={authorization.verification_url} userCode={authorization.user_code} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Flexbox
        gap={24}
        style={{ margin: "0 auto", maxWidth: 920, padding: 48 }}
      >
        {canGovern ? <><DesktopBrowserSettings /><CompanyProxySettings /></> : null}
        <Flexbox align="center" horizontal justify="space-between" width="100%">
          <h2 style={{ margin: 0 }}>{t("executor.personalTitle")}</h2>
          <Flexbox horizontal gap={8}>
            <Button icon={<Plus size={15} />} onClick={onCreate} type="primary">
              {t("executor.createTitle")}
            </Button>
            <Button
              disabled={loading}
              icon={<RefreshCw size={15} />}
              onClick={() => void refresh()}
            >
              {t("common.refresh")}
            </Button>
          </Flexbox>
        </Flexbox>
        {error ? (
          <Alert
            message={authServiceErrorMessage(error, t("executor.unavailable"))}
            showIcon
            type="error"
          />
        ) : null}
        {authorization ? (
          <Block gap={16} padding={16} variant="outlined">
            <Text strong>{t("executor.authorize")}</Text>
            <Flexbox align="center" gap={8} horizontal>
              <Text code fontSize={22}>
                {authorization.user_code}
              </Text>
              <AccessibleCopyButton
                label={t("members.copy")}
                value={authorization.user_code}
              />
            </Flexbox>
            <Flexbox gap={8} horizontal>
              <Button
                icon={<ExternalLink size={14} />}
                onClick={() => openExternalUrl(authorization.verification_url)}
              >
                {t("executor.open")}
              </Button>
              <Button onClick={() => void cancelAuthorization()}>
                {t("common.cancel")}
              </Button>
            </Flexbox>
          </Block>
        ) : null}
        {executors.map((executor) => (
          <PersonalExecutorRow
            key={executor.executor_id}
            busy={busy === executor.executor_id}
            executor={executor}
            onAuthorize={() => void authorize(executor.executor_id)}
            onConfigureModels={() => onConfigureModels(executor)}
            onConfigure={async (baseUrl, apiKey) => {
              setBusy(executor.executor_id);
              try {
                replaceExecutor(
                  (
                    await backendTrpc.account.executors.authorization.custom.configure.mutate(
                      {
                        executor_id: executor.executor_id,
                        base_url: baseUrl,
                        api_key: apiKey,
                      },
                    )
                  ).executor,
                );
              } catch (cause) {
                setError(cause);
              } finally {
                setBusy(null);
              }
            }}
            onDelete={() => void inspectImpact(executor, "delete")}
            onDisconnect={() => void inspectImpact(executor, "disconnect")}
            onRename={(value) => void rename(executor, value)}
            onShare={() => void shareExecutor(executor)}
            onUnshare={() => void inspectImpact(executor, "unshare")}
            usage={usageByExecutor[executor.executor_id] ?? []}
          />
        ))}
        {!loading && executors.length === 0 ? (
          <Text type="secondary">{t("executor.noExecutors")}</Text>
        ) : null}
        {pending ? (
          <Block gap={12} padding={16} variant="outlined">
            <Text strong>{t(`executor.${pending.action}`)}</Text>
            {pending.usage.map((usage, index) => (
              <Text key={`${usage.type}-${index}`} type="secondary">
                {usageLabel(usage, t)}
              </Text>
            ))}
            {pending.usage.length === 0 ? (
              <Text type="secondary">{t("executor.noUsage")}</Text>
            ) : null}
            <Flexbox gap={8} horizontal>
              <Button
                danger
                onClick={() => void confirmPending()}
                type="primary"
              >
                {t("common.submit")}
              </Button>
              <Button onClick={() => setPending(null)}>
                {t("common.cancel")}
              </Button>
            </Flexbox>
          </Block>
        ) : null}
        {canGovern ? (
          <section>
            <h3>{t("executor.sharedPool")}</h3>
            <Flexbox gap={12} width="100%">
              {sharedPool.map((executor) => (
                <Block
                  key={executor.executor_id}
                  padding={12}
                  variant="outlined"
                >
                  <Flexbox
                    align="center"
                    horizontal
                    justify="space-between"
                    width="100%"
                  >
                    <div>
                      <Text strong>{safeLabel(executor)}</Text>
                      <Text type="secondary">
                        {t(`executor.availability.${executor.availability}`)}
                      </Text>
                    </div>
                    <Button
                      icon={<ShieldOff size={14} />}
                      onClick={() => void govern(executor)}
                    >
                      {executor.sharing_status === "admin_blocked"
                        ? t("executor.unblock")
                        : t("executor.block")}
                    </Button>
                  </Flexbox>
                </Block>
              ))}
            </Flexbox>
          </section>
        ) : null}
      </Flexbox>
    </div>
  );
}

function PersonalExecutorRow(props: {
  executor: PersonalExecutorSummary;
  usage: ExecutorUsageTarget[];
  busy: boolean;
  onAuthorize: () => void;
  onConfigureModels: () => void;
  onConfigure: (baseUrl: string, apiKey: string) => Promise<void>;
  onRename: (value: string) => void;
  onShare: () => void;
  onUnshare: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { executor } = props;
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(executor.name);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const authorizationLabel =
    executor.authorization.method === "chatgpt"
      ? `${executor.authorization.account_id ?? t("executor.notConnected")} · ${executor.authorization.plan_type ?? "—"}`
      : (executor.authorization.endpoint_host ?? t("executor.notConnected"));
  return (
    <Block gap={12} padding={16} variant="outlined">
      <Flexbox align="center" horizontal justify="space-between" width="100%">
        <Flexbox align="center" gap={8} horizontal>
          <KeyRound size={20} />
          <div>
            <Text strong>{executor.name}</Text>
            <Text type="secondary">{authorizationLabel}</Text>
          </div>
        </Flexbox>
        <Text
          type={executor.availability === "available" ? "success" : "danger"}
        >
          {t(`executor.availability.${executor.availability}`)}
        </Text>
      </Flexbox>
      {executor.authorization.method === "custom_api_key" ? (
        <Flexbox horizontal gap={8}>
          <Input
            onChange={(event) => setCustomBaseUrl(event.target.value)}
            placeholder={t("executor.baseUrl")}
            value={customBaseUrl}
          />
          <Input
            onChange={(event) => setCustomApiKey(event.target.value)}
            placeholder={t("executor.apiKey")}
            type="password"
            value={customApiKey}
          />
          <Button
            disabled={
              props.busy || !customBaseUrl.trim() || !customApiKey.trim()
            }
            onClick={() =>
              void props
                .onConfigure(customBaseUrl.trim(), customApiKey)
                .then(() => setCustomApiKey(""))
            }
          >
            {t("executor.configure")}
          </Button>
        </Flexbox>
      ) : null}
      <Flexbox gap={8} horizontal wrap="wrap">
        {executor.authorization.method === "chatgpt" ? (
          <Button disabled={props.busy} onClick={props.onAuthorize}>
            {executor.authorization.account_id
              ? t("executor.reconnect")
              : t("executor.authorize")}
          </Button>
        ) : null}
        <Button onClick={props.onConfigureModels}>
          {executor.model_policy.status === "ready"
            ? t("executor.reconfigureModels")
            : t("executor.configureModels")}
        </Button>
        {renaming ? (
          <Flexbox horizontal>
            <Input
              onChange={(event) => setRenameDraft(event.target.value)}
              value={renameDraft}
            />
            <Button
              onClick={() => {
                props.onRename(renameDraft);
                setRenaming(false);
              }}
            >
              {t("common.save")}
            </Button>
          </Flexbox>
        ) : (
          <Button onClick={() => setRenaming(true)}>
            {t("workspace.rename")}
          </Button>
        )}
        {executor.sharing_status === "private" ? (
          <Button onClick={props.onShare}>{t("executor.share")}</Button>
        ) : executor.sharing_status === "company_shared" ? (
          <Button onClick={props.onUnshare}>{t("executor.unshare")}</Button>
        ) : (
          <Text type="danger">{t("executor.adminBlocked")}</Text>
        )}
        <Button icon={<ShieldOff size={13} />} onClick={props.onDisconnect}>
          {t("executor.disconnect")}
        </Button>
        <Button danger icon={<Trash2 size={13} />} onClick={props.onDelete}>
          {t("common.delete")}
        </Button>
      </Flexbox>
      {props.usage.map((usage, index) => (
        <Text key={`${usage.type}-${index}`} type="secondary">
          {usageLabel(usage, t)}
        </Text>
      ))}
    </Block>
  );
}

function safeLabel(executor: ExecutorSafeSummary): string {
  const planType =
    executor.authorization.method === "chatgpt"
      ? executor.authorization.plan_type
      : null;
  return `${executor.owner_display_name ? `${executor.owner_display_name} · ` : ""}${executor.name}${planType ? ` · ${planType}` : ""}`;
}
function usageLabel(
  usage: ExecutorUsageTarget,
  t: (key: string) => string,
): string {
  return `${t(usage.member_type === "human" ? "account.member" : "timeline.agent")} · ${usage.member_name}`;
}

function AccessibleCopyButton({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        aria-pressed={copied}
        icon={copied ? <Check size={15} /> : <Copy size={15} />}
        onClick={() => {
          void copyToClipboard(value).then(() => setCopied(true));
        }}
        shape="circle"
        size="small"
        type="text"
      />
    </Tooltip>
  );
}
