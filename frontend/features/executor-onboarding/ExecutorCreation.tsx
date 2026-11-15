import type {
  ExecutorDeviceAuthorizationStartResult,
  ExecutorModelPolicyItem,
  PersonalExecutorSummary,
} from "@fields/contracts/public/executor";
import { ClaudeCode, Codex, OpenClaw } from "@lobehub/icons";
import { Block, CopyButton, Flexbox, Icon, Text } from "@lobehub/ui";
import { Button, Checkbox, Input } from "@lobehub/ui/base-ui";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ONBOARDING_POLL_INTERVAL_MS } from "../../data/auth/entry-state";
import { backendTrpc } from "../../data/boundary/backend-trpc";
import { openExternalUrl } from "../../shared/platform/external-navigation";
import { DesktopBrowserStage } from "../desktop-browser/DesktopBrowserStage";

type Stage =
  | "type"
  | "binding"
  | "authorize"
  | "models"
  | "validating"
  | "sharing"
  | "review"
  | "complete";
type BindingMethod = "device_code" | "api_key";
const CREATION_STAGES: Stage[] = [
  "type",
  "binding",
  "authorize",
  "models",
  "validating",
  "sharing",
  "review",
  "complete",
];
const RECONFIGURATION_STAGES: Stage[] = [
  "models",
  "validating",
  "sharing",
  "review",
  "complete",
];

export function ExecutorCreation({
  existingExecutor = null,
  companyId,
  actorId,
  onCancel,
  onComplete,
}: {
  existingExecutor?: PersonalExecutorSummary | null;
  companyId: string;
  actorId: string;
  onCancel: () => void;
  onComplete: (executor: PersonalExecutorSummary) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>(
    initialStage(existingExecutor),
  );
  const [bindingMethod, setBindingMethod] = useState<BindingMethod | null>(
    existingExecutor?.binding_method ?? null,
  );
  const [executor, setExecutor] = useState<PersonalExecutorSummary | null>(
    existingExecutor,
  );
  const [authorization, setAuthorization] =
    useState<ExecutorDeviceAuthorizationStartResult | null>(null);
  const [baseUrlMode, setBaseUrlMode] = useState<"official" | "custom">(
    "official",
  );
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ExecutorModelPolicyItem[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState("");
  const [search, setSearch] = useState("");
  const [allowedEfforts, setAllowedEfforts] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [defaultEffort, setDefaultEffort] = useState<string | null>(null);
  const [sharing, setSharing] = useState<"private" | "company_shared">(
    existingExecutor?.sharing_status === "company_shared"
      ? "company_shared"
      : "private",
  );
  const [name, setName] = useState(existingExecutor?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconfiguration = Boolean(
    existingExecutor && existingExecutor.availability !== "pending_auth",
  );

  useEffect(() => {
    if (
      existingExecutor?.availability === "available" ||
      existingExecutor?.availability === "configuration_required"
    ) {
      void loadCatalog(existingExecutor.executor_id, existingExecutor);
    }
  }, []);

  useEffect(() => {
    if (!authorization || !executor) return;
    const timer = window.setInterval(() => {
      void backendTrpc.account.executors.authorization.status
        .query({
          executor_id: executor.executor_id,
          attempt_id: authorization.attempt_id,
        })
        .then((result) => {
          if (result.status === "completed") {
            window.clearInterval(timer);
            setAuthorization(null);
            void loadCatalog(executor.executor_id, executor);
          } else if (
            result.status === "failed" ||
            result.status === "cancelled"
          ) {
            window.clearInterval(timer);
            setAuthorization(null);
            setError(t("executor.onboardingAuthorizationFailed"));
          }
        })
        .catch((cause: unknown) =>
          setError(message(cause, t("executor.onboardingAuthorizationFailed"))),
        );
    }, ONBOARDING_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [authorization, executor, t]);

  const effortOptions = useMemo(
    () => [
      ...new Set(
        models
          .filter((item) => selectedModels.includes(item.model))
          .flatMap((item) => item.supported_reasoning_efforts),
      ),
    ],
    [models, selectedModels],
  );
  const visibleModels = models.filter((item) =>
    `${item.display_name} ${item.model}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  useEffect(() => {
    setAllowedEfforts((current) =>
      current.filter((effort) => effortOptions.includes(effort)),
    );
  }, [effortOptions]);

  async function startDeviceAuthorization() {
    setBusy(true);
    setError(null);
    try {
      const created =
        executor ??
        (
          await backendTrpc.account.executors.create.mutate({
            executor_type: "codex",
            name: provisionalName(),
            authorization_method: "chatgpt",
          })
        ).executor;
      setExecutor(created);
      setName(created.name);
      const result =
        await backendTrpc.account.executors.authorization.start.mutate({
          executor_id: created.executor_id,
        });
      setAuthorization(result);
      if (!window.fieldsDesktop) openExternalUrl(result.verification_url);
    } catch (cause) {
      setError(message(cause, t("executor.startAuthorizationFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function connectApiKey() {
    if (!apiKey.trim() || (baseUrlMode === "custom" && !baseUrl.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const created =
        executor ??
        (
          await backendTrpc.account.executors.create.mutate({
            executor_type: "codex",
            name: provisionalName(),
            authorization_method: "custom_api_key",
          })
        ).executor;
      setExecutor(created);
      setName(created.name);
      const configured =
        await backendTrpc.account.executors.authorization.custom.configure.mutate(
          {
            executor_id: created.executor_id,
            base_url:
              baseUrlMode === "official"
                ? "https://api.openai.com/v1"
                : baseUrl.trim(),
            api_key: apiKey,
          },
        );
      setExecutor(configured.executor);
      setApiKey("");
      await loadCatalog(created.executor_id, configured.executor);
    } catch (cause) {
      setError(message(cause, t("executor.onboardingFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function loadCatalog(
    executorId: string,
    seedExecutor?: PersonalExecutorSummary,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await backendTrpc.account.executors.models.catalog.query({
        executor_id: executorId,
      });
      const policy = seedExecutor?.model_policy;
      const savedById = new Map(
        policy?.models.map((item) => [item.model, item]) ?? [],
      );
      const catalogIds = new Set(result.items.map((item) => item.model));
      const merged = [
        ...result.items.map((item) =>
          savedById.has(item.model)
            ? { ...item, ...savedById.get(item.model)! }
            : item,
        ),
        ...(policy?.models.filter((item) => !catalogIds.has(item.model)) ?? []),
      ];
      const selected = policy?.models.length
        ? policy.models.map((item) => item.model)
        : result.items.map((item) => item.model);
      const efforts = policy?.allowed_reasoning_efforts.length
        ? policy.allowed_reasoning_efforts
        : [
          ...new Set(
            merged
              .filter((item) => selected.includes(item.model))
              .flatMap((item) => item.supported_reasoning_efforts),
          ),
        ];
      setModels(merged);
      setSelectedModels(selected);
      setAllowedEfforts(efforts);
      setDefaultModel(policy?.default_model ?? selected[0] ?? null);
      setDefaultEffort(
        policy?.default_reasoning_effort ??
          commonEfforts(
            merged.filter((item) => selected.includes(item.model)),
            efforts,
          )[0] ??
          null,
      );
    } catch (cause) {
      const policy = seedExecutor?.model_policy;
      if (policy?.models.length) {
        setModels(policy.models);
        setSelectedModels(policy.models.map((item) => item.model));
        setAllowedEfforts(policy.allowed_reasoning_efforts);
        setDefaultModel(policy.default_model);
        setDefaultEffort(policy.default_reasoning_effort);
      }
      setError(message(cause, t("executor.modelCatalogUnavailable")));
    } finally {
      setBusy(false);
      setStage("models");
    }
  }

  function addManualModel() {
    const model = manualModel.trim();
    if (!model || models.some((item) => item.model === model)) return;
    const item: ExecutorModelPolicyItem = {
      model,
      display_name: model,
      source: "manual",
      supported_reasoning_efforts: allowedEfforts,
      validation_status: "unvalidated",
      last_validated_at_ms: null,
    };
    setModels((items) => [...items, item]);
    setSelectedModels((items) => [...items, model]);
    setDefaultModel((value) => value ?? model);
    setManualModel("");
  }

  async function validateSelectedModels(modelIds: string[] = selectedModels) {
    if (!executor || modelIds.length === 0 || !defaultModel) return;
    setStage("validating");
    setBusy(true);
    setError(null);
    try {
      const selected = models
        .filter((item) => modelIds.includes(item.model))
        .map((item) => ({
          ...item,
          supported_reasoning_efforts:
            item.source === "manual" &&
            item.supported_reasoning_efforts.length === 0
              ? allowedEfforts
              : item.supported_reasoning_efforts,
        }));
      setModels((items) =>
        items.map((item) =>
          modelIds.includes(item.model)
            ? { ...item, validation_status: "validating" }
            : item,
        ),
      );
      const validated: ExecutorModelPolicyItem[] = [];
      for (const item of selected) {
        const result =
          await backendTrpc.account.executors.models.validate.mutate({
            executor_id: executor.executor_id,
            models: [
              {
                model: item.model,
                display_name: item.display_name,
                source: item.source,
                supported_reasoning_efforts: item.supported_reasoning_efforts,
              },
            ],
          });
        const next = result.items[0] ?? {
          ...item,
          validation_status: "unavailable" as const,
          last_validated_at_ms: Date.now(),
        };
        validated.push(next);
        setModels((items) =>
          items.map((candidate) =>
            candidate.model === next.model ? next : candidate,
          ),
        );
      }
      const availableIds = validated
        .filter((item) => item.validation_status === "available")
        .map((item) => item.model);
      const nextSelected = [
        ...new Set([
          ...selectedModels.filter((id) => !modelIds.includes(id)),
          ...availableIds,
        ]),
      ];
      const validatedById = new Map(
        validated.map((item) => [item.model, item]),
      );
      const nextItems = models
        .map((item) => validatedById.get(item.model) ?? item)
        .filter((item) => nextSelected.includes(item.model));
      const nextCommonEfforts = commonEfforts(nextItems, allowedEfforts);
      setSelectedModels(nextSelected);
      setDefaultModel((current) =>
        current &&
        (!modelIds.includes(current) || availableIds.includes(current))
          ? current
          : (nextSelected[0] ?? null),
      );
      setDefaultEffort((current) =>
        current && nextCommonEfforts.includes(current)
          ? current
          : (nextCommonEfforts[0] ?? null),
      );
      if (
        availableIds.length === 0 &&
        selectedModels.every((id) => modelIds.includes(id))
      )
        setError(t("executor.noValidatedModels"));
    } catch (cause) {
      setError(message(cause, t("executor.modelValidationFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (
      !executor ||
      !name.trim() ||
      !defaultModel ||
      selectedModels.length === 0
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const selected = models.filter(
        (item) =>
          selectedModels.includes(item.model) &&
          item.validation_status === "available",
      );
      const policy =
        await backendTrpc.account.executors.models.configure.mutate({
          executor_id: executor.executor_id,
          expected_revision: executor.model_policy.revision,
          models: selected,
          allowed_reasoning_efforts: allowedEfforts,
          default_model: defaultModel,
          default_reasoning_effort: defaultEffort,
        });
      let next = (
        await backendTrpc.account.executors.rename.mutate({
          executor_id: executor.executor_id,
          name: name.trim(),
        })
      ).executor;
      if (sharing === "company_shared")
        next = (
          await backendTrpc.account.executors.share.mutate({
            executor_id: executor.executor_id,
          })
        ).executor;
      else if (executor.sharing_status === "company_shared")
        next = (
          await backendTrpc.account.executors.unshare.mutate({
            executor_id: executor.executor_id,
          })
        ).executor;
      next = { ...next, model_policy: policy.policy };
      setExecutor(next);
      setStage("complete");
    } catch (cause) {
      setError(message(cause, t("executor.onboardingFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function completeAndExit() {
    if (!executor || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onComplete(executor);
    } catch (cause) {
      setError(message(cause, t("executor.onboardingFailed")));
    } finally {
      setBusy(false);
    }
  }

  function navigateBack() {
    if (stage === "complete" && executor) void completeAndExit();
    else onCancel();
  }

  if (authorization && window.fieldsDesktop) {
    return (
      <section style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <DesktopBrowserStage
          actorId={actorId}
          companyId={companyId}
          initialUrl={authorization.verification_url}
          userCode={authorization.user_code}
        />
      </section>
    );
  }

  return (
    <section
      style={{
        background: "var(--ant-color-bg-layout)",
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <Flexbox
        gap={24}
        style={{
          margin: "0 auto",
          maxWidth: 920,
          padding: "44px 32px 72px",
          width: "100%",
        }}
      >
        <Flexbox align="center" horizontal gap={12}>
          <Button
            icon={<ArrowLeft size={16} />}
            onClick={navigateBack}
            shape="circle"
            type="text"
          />
          <div>
            <h1 style={{ letterSpacing: "-0.025em", margin: 0 }}>
              {t(
                existingExecutor
                  ? "executor.reconfigureTitle"
                  : "executor.createTitle",
              )}
            </h1>
            <Text type="secondary">{t(`executor.createStage.${stage}`)}</Text>
          </div>
        </Flexbox>
        <StageProgress
          current={stage}
          stages={reconfiguration ? RECONFIGURATION_STAGES : CREATION_STAGES}
        />
        {error ? (
          <Block padding={12} variant="outlined">
            <Text type="danger">{error}</Text>
          </Block>
        ) : null}
        {stage === "type" ? (
          <TypeStep onSelect={() => setStage("binding")} />
        ) : null}
        {stage === "binding" ? (
          <BindingStep
            selected={bindingMethod}
            onSelect={setBindingMethod}
            onContinue={() => setStage("authorize")}
          />
        ) : null}
        {stage === "authorize" ? (
          <AuthorizeStep
            method={bindingMethod}
            authorization={authorization}
            apiKey={apiKey}
            baseUrl={baseUrl}
            baseUrlMode={baseUrlMode}
            busy={busy}
            onApiKey={setApiKey}
            onBaseUrl={setBaseUrl}
            onBaseUrlMode={setBaseUrlMode}
            onDevice={() => void startDeviceAuthorization()}
            onApi={() => void connectApiKey()}
          />
        ) : null}
        {stage === "models" ? (
          <ModelsStep
            models={visibleModels}
            allModels={models}
            search={search}
            selected={selectedModels}
            efforts={effortOptions}
            allowedEfforts={allowedEfforts}
            defaultModel={defaultModel}
            defaultEffort={defaultEffort}
            manualModel={manualModel}
            busy={busy}
            onSearch={setSearch}
            onToggleModel={(id) =>
              setSelectedModels((items) =>
                items.includes(id)
                  ? items.filter((item) => item !== id)
                  : [...items, id],
              )
            }
            onToggleEffort={(effort) =>
              setAllowedEfforts((items) =>
                items.includes(effort)
                  ? items.filter((item) => item !== effort)
                  : [...items, effort],
              )
            }
            onDefaultModel={setDefaultModel}
            onDefaultEffort={setDefaultEffort}
            onManual={setManualModel}
            onAddManual={addManualModel}
            onValidate={() => void validateSelectedModels()}
          />
        ) : null}
        {stage === "validating" ? (
          <ValidationStep
            busy={busy}
            models={models.filter(
              (item) =>
                selectedModels.includes(item.model) ||
                item.validation_status === "unavailable" ||
                item.validation_status === "validating",
            )}
            onBack={() => setStage("models")}
            onContinue={() => setStage("sharing")}
            onRetry={(ids) => void validateSelectedModels(ids)}
          />
        ) : null}
        {stage === "sharing" ? (
          <SharingStep
            value={sharing}
            onChange={setSharing}
            onContinue={() => setStage("review")}
          />
        ) : null}
        {stage === "review" ? (
          <ReviewStep
            bindingMethod={bindingMethod}
            models={models.filter((item) =>
              selectedModels.includes(item.model),
            )}
            efforts={allowedEfforts}
            defaultModel={defaultModel}
            defaultEffort={defaultEffort}
            sharing={sharing}
            name={name}
            busy={busy}
            onName={setName}
            onEditModels={() => setStage("models")}
            onEditSharing={() => setStage("sharing")}
            onFinish={() => void finish()}
          />
        ) : null}
        {stage === "complete" && executor ? (
          <CompletionStep
            busy={busy}
            executor={executor}
            reconfigured={reconfiguration}
            onDone={() => void completeAndExit()}
          />
        ) : null}
      </Flexbox>
    </section>
  );
}

function TypeStep({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <Flexbox gap={12}>
      <OptionCard
        icon={<Codex.Color size={28} />}
        title="Codex"
        description={t("executor.codexTypeDescription")}
        onClick={onSelect}
      />
      <OptionCard
        icon={<ClaudeCode.Color size={28} />}
        title="Claude Code"
        description={t("executor.comingSoon")}
        disabled
      />
      <OptionCard
        icon={<OpenClaw.Color size={28} />}
        title="OpenClaw"
        description={t("executor.comingSoon")}
        disabled
      />
    </Flexbox>
  );
}
function BindingStep({
  selected,
  onSelect,
  onContinue,
}: {
  selected: BindingMethod | null;
  onSelect: (value: BindingMethod) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Flexbox gap={16}>
      <OptionCard
        selected={selected === "device_code"}
        title={t("executor.deviceCode")}
        description={t("executor.deviceCodeDescription")}
        onClick={() => onSelect("device_code")}
      />
      <OptionCard
        selected={selected === "api_key"}
        title={t("executor.apiKey")}
        description={t("executor.apiKeyDescription")}
        onClick={() => onSelect("api_key")}
      />
      <Button
        disabled={!selected}
        onClick={onContinue}
        size="large"
        type="primary"
      >
        {t("common.continue")}
      </Button>
    </Flexbox>
  );
}
function AuthorizeStep(props: {
  method: BindingMethod | null;
  authorization: ExecutorDeviceAuthorizationStartResult | null;
  apiKey: string;
  baseUrl: string;
  baseUrlMode: "official" | "custom";
  busy: boolean;
  onApiKey: (value: string) => void;
  onBaseUrl: (value: string) => void;
  onBaseUrlMode: (value: "official" | "custom") => void;
  onDevice: () => void;
  onApi: () => void;
}) {
  const { t } = useTranslation();
  if (props.method === "device_code")
    return (
      <Flexbox gap={16}>
        {props.authorization ? (
          <>
            <Block padding={16} variant="outlined">
              <Text strong>{props.authorization.user_code}</Text>
              <CopyButton content={props.authorization.user_code} />
              <Button
                icon={<ExternalLink size={14} />}
                onClick={() =>
                  openExternalUrl(props.authorization!.verification_url)
                }
              >
                {t("executor.open")}
              </Button>
            </Block>
            <Flexbox align="center" horizontal gap={8}>
              <Icon icon={LoaderCircle} spin />
              <Text>{t("executor.waitingForAuthorization")}</Text>
            </Flexbox>
          </>
        ) : (
          <>
            <Text>{t("executor.deviceStartDescription")}</Text>
            <Button
              loading={props.busy}
              onClick={props.onDevice}
              size="large"
              type="primary"
            >
              {t("executor.startAuthorization")}
            </Button>
          </>
        )}
      </Flexbox>
    );
  return (
    <Flexbox gap={12}>
      <Flexbox horizontal gap={8}>
        <Button
          type={props.baseUrlMode === "official" ? "primary" : "default"}
          onClick={() => props.onBaseUrlMode("official")}
        >
          {t("executor.officialOpenAI")}
        </Button>
        <Button
          type={props.baseUrlMode === "custom" ? "primary" : "default"}
          onClick={() => props.onBaseUrlMode("custom")}
        >
          {t("executor.customEndpoint")}
        </Button>
      </Flexbox>
      {props.baseUrlMode === "custom" ? (
        <Input
          value={props.baseUrl}
          onChange={(event) => props.onBaseUrl(event.target.value)}
          placeholder={t("executor.baseUrl")}
        />
      ) : null}
      <Input
        value={props.apiKey}
        onChange={(event) => props.onApiKey(event.target.value)}
        placeholder={t("executor.apiKey")}
        type="password"
      />
      <Button
        disabled={
          !props.apiKey.trim() ||
          (props.baseUrlMode === "custom" && !props.baseUrl.trim())
        }
        loading={props.busy}
        onClick={props.onApi}
        size="large"
        type="primary"
      >
        {t("executor.connectAndDiscover")}
      </Button>
    </Flexbox>
  );
}
function ModelsStep(props: {
  models: ExecutorModelPolicyItem[];
  allModels: ExecutorModelPolicyItem[];
  selected: string[];
  efforts: string[];
  allowedEfforts: string[];
  defaultModel: string | null;
  defaultEffort: string | null;
  search: string;
  manualModel: string;
  busy: boolean;
  onSearch: (value: string) => void;
  onToggleModel: (id: string) => void;
  onToggleEffort: (effort: string) => void;
  onDefaultModel: (id: string) => void;
  onDefaultEffort: (effort: string) => void;
  onManual: (value: string) => void;
  onAddManual: () => void;
  onValidate: () => void;
}) {
  const { t } = useTranslation();
  const selectedItems = props.allModels.filter((item) =>
    props.selected.includes(item.model),
  );
  const common = commonEfforts(selectedItems, props.allowedEfforts);
  const validDefaultEffort =
    props.defaultEffort === null
      ? common.length === 0
      : common.includes(props.defaultEffort);
  return (
    <Flexbox gap={16}>
      <Input
        prefix={<Search size={14} />}
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
        placeholder={t("executor.searchModels")}
      />
      {props.models.map((item) => (
        <Block key={item.model} padding={12} variant="outlined">
          <Checkbox
            checked={props.selected.includes(item.model)}
            onChange={() => props.onToggleModel(item.model)}
          >
            <Text strong>{item.display_name}</Text>
            <Text type="secondary">{item.model}</Text>
          </Checkbox>
          {props.selected.includes(item.model) ? (
            <Button
              onClick={() => props.onDefaultModel(item.model)}
              type={props.defaultModel === item.model ? "primary" : "text"}
            >
              {t("executor.setDefault")}
            </Button>
          ) : null}
        </Block>
      ))}
      <Flexbox horizontal>
        <Input
          value={props.manualModel}
          onChange={(event) => props.onManual(event.target.value)}
          placeholder={t("executor.manualModelId")}
        />
        <Button onClick={props.onAddManual}>{t("common.add")}</Button>
      </Flexbox>
      <Text strong>{t("executor.allowedReasoningEfforts")}</Text>
      <Flexbox horizontal gap={8} wrap="wrap">
        {props.efforts.map((effort) => (
          <Checkbox
            checked={props.allowedEfforts.includes(effort)}
            key={effort}
            onChange={() => props.onToggleEffort(effort)}
          >
            {effort}
          </Checkbox>
        ))}
      </Flexbox>
      <Text strong>{t("executor.defaultReasoningEffort")}</Text>
      <Flexbox horizontal gap={8} wrap="wrap">
        {common.map((effort) => (
          <Button
            key={effort}
            onClick={() => props.onDefaultEffort(effort)}
            type={props.defaultEffort === effort ? "primary" : "default"}
          >
            {effort}
          </Button>
        ))}
      </Flexbox>
      <Button
        disabled={
          props.selected.length === 0 ||
          !props.defaultModel ||
          !validDefaultEffort
        }
        loading={props.busy}
        onClick={props.onValidate}
        size="large"
        type="primary"
      >
        {t("executor.validateModels")}
      </Button>
    </Flexbox>
  );
}
function ValidationStep({
  busy,
  models,
  onBack,
  onContinue,
  onRetry,
}: {
  busy: boolean;
  models: ExecutorModelPolicyItem[];
  onBack: () => void;
  onContinue: () => void;
  onRetry: (modelIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const available = models.filter(
    (item) => item.validation_status === "available",
  );
  const failed = models.filter(
    (item) => item.validation_status === "unavailable",
  );
  return (
    <Flexbox gap={12}>
      {busy ? (
        <Flexbox align="center" gap={8} horizontal>
          <Icon icon={LoaderCircle} spin />
          <Text>{t("executor.validatingModels")}</Text>
        </Flexbox>
      ) : null}
      {models.map((item) => (
        <Block key={item.model} padding={12} variant="outlined">
          <Flexbox align="center" horizontal justify="space-between">
            <Text>{item.display_name}</Text>
            <Text
              type={
                item.validation_status === "available"
                  ? "success"
                  : item.validation_status === "validating"
                    ? "secondary"
                    : "danger"
              }
            >
              {t(`executor.validation.${item.validation_status}`)}
            </Text>
          </Flexbox>
        </Block>
      ))}
      {!busy ? (
        <Flexbox horizontal gap={8}>
          <Button onClick={onBack}>{t("common.back")}</Button>
          {failed.length > 0 ? (
            <Button onClick={() => onRetry(failed.map((item) => item.model))}>
              {t("common.retry")}
            </Button>
          ) : null}
          <Button
            disabled={available.length === 0}
            onClick={onContinue}
            type="primary"
          >
            {t("common.continue")}
          </Button>
        </Flexbox>
      ) : null}
    </Flexbox>
  );
}
function SharingStep({
  value,
  onChange,
  onContinue,
}: {
  value: "private" | "company_shared";
  onChange: (value: "private" | "company_shared") => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Flexbox gap={12}>
      <OptionCard
        selected={value === "private"}
        title={t("executor.keepPrivate")}
        description={t("executor.privateDescription")}
        onClick={() => onChange("private")}
      />
      <OptionCard
        selected={value === "company_shared"}
        title={t("executor.addToSharedPool")}
        description={t("executor.onboardingShareDescription")}
        onClick={() => onChange("company_shared")}
      />
      <Button onClick={onContinue} type="primary">
        {t("common.continue")}
      </Button>
    </Flexbox>
  );
}
function ReviewStep(props: {
  bindingMethod: BindingMethod | null;
  models: ExecutorModelPolicyItem[];
  efforts: string[];
  defaultModel: string | null;
  defaultEffort: string | null;
  sharing: string;
  name: string;
  busy: boolean;
  onName: (value: string) => void;
  onEditModels: () => void;
  onEditSharing: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Flexbox gap={16}>
      <Input
        value={props.name}
        onChange={(event) => props.onName(event.target.value)}
        placeholder={t("executor.name")}
      />
      <Summary label={t("executor.typeLabel")} value="Codex" />
      <Summary
        label={t("executor.bindingMethod")}
        value={
          props.bindingMethod === "device_code"
            ? t("executor.deviceCode")
            : t("executor.apiKey")
        }
      />
      <Summary
        label={t("executor.models")}
        value={props.models.map((item) => item.display_name).join(", ")}
        action={props.onEditModels}
      />
      <Summary
        label={t("executor.allowedReasoningEfforts")}
        value={props.efforts.join(", ")}
        action={props.onEditModels}
      />
      <Summary
        label={t("executor.defaults")}
        value={`${props.defaultModel ?? "—"} · ${props.defaultEffort ?? t("home.reasoningEffortDefault")}`}
      />
      <Summary
        label={t("executor.share")}
        value={
          props.sharing === "company_shared"
            ? t("executor.sharedPool")
            : t("executor.keepPrivate")
        }
        action={props.onEditSharing}
      />
      <Button
        disabled={!props.name.trim()}
        loading={props.busy}
        onClick={props.onFinish}
        size="large"
        type="primary"
      >
        {t("executor.finishCreation")}
      </Button>
    </Flexbox>
  );
}
function CompletionStep({
  busy,
  executor,
  reconfigured,
  onDone,
}: {
  busy: boolean;
  executor: PersonalExecutorSummary;
  reconfigured: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Flexbox align="center" gap={18}>
      <Check size={42} />
      <h2>
        {t(reconfigured ? "executor.configuredTitle" : "executor.createdTitle")}
      </h2>
      <Text strong>{executor.name}</Text>
      <Text>
        {executor.model_policy.models
          .map((item) => item.display_name)
          .join(", ")}
      </Text>
      <Button loading={busy} onClick={onDone} size="large" type="primary">
        {t("executor.returnToSource")}
      </Button>
    </Flexbox>
  );
}
function StageProgress({
  current,
  stages,
}: {
  current: Stage;
  stages: Stage[];
}) {
  const currentIndex = stages.indexOf(current);
  return (
    <div
      aria-label={`${currentIndex + 1} / ${stages.length}`}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={stages.length}
      aria-valuenow={currentIndex + 1}
      style={{
        display: "grid",
        gap: 6,
        gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      }}
    >
      {stages.map((stage, index) => (
        <span
          key={stage}
          style={{
            background:
              index <= currentIndex
                ? "var(--ant-color-primary)"
                : "var(--ant-color-border-secondary)",
            borderRadius: 2,
            height: 3,
            transition: "background 200ms ease",
          }}
        />
      ))}
    </div>
  );
}
function OptionCard({
  title,
  description,
  icon,
  disabled,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        background: "var(--ant-color-bg-container)",
        border: `1px solid ${selected ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)"}`,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        padding: 20,
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      <Flexbox gap={6}>
        <Flexbox align="center" horizontal gap={8}>
          {icon ?? <LockKeyhole size={18} />}
          <Text strong>{title}</Text>
        </Flexbox>
        <Text type="secondary">{description}</Text>
      </Flexbox>
    </button>
  );
}
function Summary({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Block padding={12} variant="outlined">
      <Flexbox align="center" horizontal justify="space-between">
        <div>
          <Text type="secondary">{label}</Text>
          <Text strong>{value}</Text>
        </div>
        {action ? (
          <Button onClick={action} type="text">
            {t("common.edit")}
          </Button>
        ) : null}
      </Flexbox>
    </Block>
  );
}
function provisionalName(): string {
  return `Codex · ${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).slice(0, 6).toUpperCase()}`;
}
function initialStage(executor: PersonalExecutorSummary | null): Stage {
  if (!executor) return "type";
  return executor.availability === "pending_auth" ? "authorize" : "models";
}
function commonEfforts(
  models: ExecutorModelPolicyItem[],
  allowed: string[],
): string[] {
  return allowed.filter(
    (effort) =>
      models.length > 0 &&
      models.every((model) =>
        model.supported_reasoning_efforts.includes(effort),
      ),
  );
}
function message(_error: unknown, fallback: string): string {
  return fallback;
}
