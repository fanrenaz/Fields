import type {
  ExecutorSafeSummary,
  MemberExecutorAssignment,
} from "@fields/contracts/public/executor";
import { Flexbox, Icon, Text } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import {
  ArrowRight,
  Building2,
  KeyRound,
  LoaderCircle,
  RotateCw,
  Settings,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { workspaceTelemetry } from "../../data/observability/workspace-telemetry";

const EXECUTOR_ACCESS_POLL_INTERVAL_MS = 3_000;

export type ExecutorAccessStatus =
  | "loading"
  | "active"
  | "required"
  | "transitioning"
  | "error";

export type ExecutorAccessController = {
  status: ExecutorAccessStatus;
  assignment: MemberExecutorAssignment | null;
  options: readonly ExecutorSafeSummary[];
  active: boolean;
  bind: (executorId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useExecutorAccess(): ExecutorAccessController {
  const [assignment, setAssignment] = useState<MemberExecutorAssignment | null>(null);
  const [options, setOptions] = useState<ExecutorSafeSummary[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [current, available] = await Promise.all([
        observedExecutorRead(
          () => backendTrpc.member.executor.current.query(),
          "executor_access_assignment",
        ),
        observedExecutorRead(
          () => backendTrpc.member.executor.options.query(),
          "executor_access_options",
        ),
      ]);
      setAssignment(current);
      setOptions(available.items);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void backendTrpc.member.executor.current.query()
        .then((current) => {
          setAssignment(current);
          setError(false);
        })
        .catch(() => {
          workspaceTelemetry.recordError("executor_access_assignment");
          setError(true);
        });
    }, EXECUTOR_ACCESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const bind = useCallback(async (executorId: string): Promise<void> => {
    if (binding) return;
    setBinding(true);
    setError(false);
    try {
      const current = await backendTrpc.member.executor.set.mutate({ executor_id: executorId });
      setAssignment(current);
    } catch (cause) {
      workspaceTelemetry.recordError("executor_access_binding");
      setError(true);
      throw cause;
    } finally {
      setBinding(false);
    }
  }, [binding]);

  const active = isActiveAssignment(assignment);
  const transitioning = binding
    || assignment?.session_state === "preparing"
    || assignment?.session_state === "switching";
  const status: ExecutorAccessStatus = !initialized
    ? "loading"
    : transitioning
      ? "transitioning"
      : error
        ? "error"
        : active
          ? "active"
          : "required";

  return useMemo(() => ({
    status,
    assignment,
    options,
    active,
    bind,
    refresh,
  }), [active, assignment, bind, options, refresh, status]);
}

export function ExecutorAccessGate({
  actorId,
  controller,
  onCreate,
  onManage,
  onResume,
}: {
  actorId: string;
  controller: ExecutorAccessController;
  onCreate: () => void;
  onManage: () => void;
  onResume: (executorId: string) => void;
}) {
  const { t } = useTranslation();
  const available = controller.options.filter((executor) => executor.availability === "available");
  const owned = controller.options.filter((executor) => executor.owner_actor_id === actorId);
  const personal = available.filter((executor) => executor.owner_actor_id === actorId);
  const shared = available.filter((executor) => executor.owner_actor_id !== actorId);
  const incomplete = owned.filter((executor) => (
    executor.availability === "pending_auth"
    || executor.availability === "configuration_required"
  ));
  const unavailable = owned.filter((executor) => (
    executor.availability === "unavailable"
    || executor.availability === "disconnected"
  ));
  const working = controller.status === "loading" || controller.status === "transitioning";

  return (
    <section
      aria-labelledby="executor-access-title"
      className="executor-access"
    >
      <div className="executor-access__content">
        <header className="executor-access__header">
          <span aria-hidden="true" className="executor-access__mark">
            <KeyRound size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h1 id="executor-access-title">{t("executor.homeUnavailableTitle")}</h1>
            <p>{t("executor.homeUnavailableDescription")}</p>
          </div>
        </header>

        {working ? (
          <div aria-live="polite" className="executor-access__status">
            <Icon icon={LoaderCircle} size="small" spin />
            <Text type="secondary">{t("executor.accessChecking")}</Text>
          </div>
        ) : controller.status === "error" ? (
          <div className="executor-access__status executor-access__status--error">
            <Text>{t("executor.unavailable")}</Text>
            <Button icon={<RotateCw size={14} />} onClick={() => void controller.refresh()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <div className="executor-access__sources">
            <ExecutorSource
              description={t("executor.personalAccessDescription")}
              icon={<UserRound size={18} strokeWidth={1.8} />}
              title={t("executor.personalTitle")}
            >
              {personal.length > 0 ? (
                <ExecutorOptionGroup items={personal} onBind={controller.bind} />
              ) : incomplete.length > 0 ? (
                <Button
                  block
                  icon={<KeyRound size={15} />}
                  onClick={() => onResume(incomplete[0]!.executor_id)}
                  type="primary"
                >
                  {t("shell.completeExecutorSetup")}
                </Button>
              ) : unavailable.length > 0 ? (
                <Flexbox gap={8}>
                  <Text type="secondary">
                    {t("executor.existingUnavailableDescription")}
                  </Text>
                  <Flexbox gap={8} horizontal wrap="wrap">
                    <Button icon={<Settings size={15} />} onClick={onManage}>
                      {t("executor.manage")}
                    </Button>
                    <Button icon={<KeyRound size={15} />} onClick={onCreate} type="primary">
                      {t("executor.createTitle")}
                    </Button>
                  </Flexbox>
                </Flexbox>
              ) : (
                <Button
                  block
                  icon={<KeyRound size={15} />}
                  onClick={onCreate}
                  type="primary"
                >
                  {t("executor.setupPersonal")}
                </Button>
              )}
            </ExecutorSource>
            <ExecutorSource
              description={t("executor.sharedAccessDescription")}
              icon={<Building2 size={18} strokeWidth={1.8} />}
              title={t("executor.sharedPool")}
            >
              {shared.length > 0 ? (
                <ExecutorOptionGroup items={shared} onBind={controller.bind} />
              ) : (
                <p className="executor-access__empty">
                  {t("executor.noSharedAvailable")}
                </p>
              )}
            </ExecutorSource>
          </div>
        )}
      </div>
    </section>
  );
}

function ExecutorSource({
  children,
  description,
  icon,
  title,
}: {
  children: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <article className="executor-access__source">
      <div className="executor-access__source-heading">
        <span aria-hidden="true" className="executor-access__source-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="executor-access__source-actions">{children}</div>
    </article>
  );
}

function ExecutorOptionGroup({
  items,
  onBind,
}: {
  items: readonly ExecutorSafeSummary[];
  onBind: (executorId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="executor-access__options">
      {items.map((executor) => (
        <Button
          block
          className="executor-access__option"
          key={executor.executor_id}
          onClick={() => void onBind(executor.executor_id).catch(() => undefined)}
          type="text"
        >
          <span className="executor-access__option-copy">
            <Text strong>{executor.name}</Text>
            <Text fontSize={12} type="secondary">{executor.owner_display_name}</Text>
          </span>
          <span className="executor-access__option-action">
            {t("executor.useExecutor")}
            <ArrowRight aria-hidden="true" size={14} />
          </span>
        </Button>
      ))}
    </div>
  );
}

function isActiveAssignment(assignment: MemberExecutorAssignment | null): boolean {
  return assignment?.executor?.availability === "available"
    && (assignment.session_state === "ready" || assignment.session_state === "stopped");
}

async function observedExecutorRead<T>(
  read: () => Promise<T>,
  errorClass: "executor_access_assignment" | "executor_access_options",
): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    workspaceTelemetry.recordError(errorClass);
    throw cause;
  }
}
