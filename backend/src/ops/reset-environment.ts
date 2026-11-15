import { isAbsolute } from "node:path";

import Dockerode from "dockerode";

export const FULL_ENVIRONMENT_RESET_CONFIRMATION = "RESET_FIELDS_BACKEND_V3";

const FIELDS_LABEL_PREFIX = "fields.";
const FIELDS_COMPOSE_PROJECT = "fields";
const POSTGRES_VOLUME_NAME = "fields_postgres-data";
const CADDY_DATA_VOLUME_NAME = "fields_caddy-data";
const CADDY_CONFIG_VOLUME_NAME = "fields_caddy-config";
const HOME_WORKDIR = "/workdir";
const HOME_CONTROL_TOKEN_TARGET = "/run/secrets/fields-control-token";

type ProjectVolumeKind = "postgres-data" | "caddy-data" | "caddy-config";

export type EnvironmentResetMount = {
  type: string | null;
  name: string | null;
  source: string | null;
  destination: string | null;
  readWrite: boolean | null;
};

export type EnvironmentResetContainer = {
  id: string;
  name: string;
  labels: Record<string, string>;
  mounts: EnvironmentResetMount[];
};

export type EnvironmentResetVolume = {
  name: string;
  labels: Record<string, string>;
};

type CompanyRuntimeContainer = EnvironmentResetContainer & {
  kind: "company-runtime";
  companyId: string;
  instanceId: string;
  generation: number;
};

export type ManagedEnvironmentResetContainer = CompanyRuntimeContainer;

type CompanyRuntimeWorkspaceVolume = EnvironmentResetVolume & {
  kind: "company-runtime-workspace";
  companyId: string;
};

export type ManagedWorkspaceVolume = CompanyRuntimeWorkspaceVolume;

export type ProjectEnvironmentVolume = EnvironmentResetVolume & {
  kind: ProjectVolumeKind;
};

export type FullEnvironmentResetPlan = {
  containers: ManagedEnvironmentResetContainer[];
  workspaceVolumes: ManagedWorkspaceVolume[];
  postgresVolume: ProjectEnvironmentVolume | null;
  preservedCaddyVolumes: ProjectEnvironmentVolume[];
};

export type FullEnvironmentResetResult = {
  containersRemoved: number;
  workspaceVolumesRemoved: number;
  postgresVolumeRemoved: string;
  preservedCaddyVolumes: string[];
};

export type FullEnvironmentResetDocker = {
  preflight(): Promise<void>;
  containers(): Promise<EnvironmentResetContainer[]>;
  volumes(): Promise<EnvironmentResetVolume[]>;
  removeContainer(container: EnvironmentResetContainer): Promise<void>;
  removeVolume(volume: EnvironmentResetVolume): Promise<void>;
};

type FullEnvironmentResetTokenSourceOptions = {
  /**
   * The Docker-daemon-visible path used for Company Runtime control-token binds.
   */
  companyRuntimeControlTokenHostFile?: string;
  env?: NodeJS.ProcessEnv;
};

type ExpectedCompanyRuntimeControlTokenSource = {
  path: string | null;
  error: string | null;
};

export class FullEnvironmentResetPreflightError extends Error {}

export class FullEnvironmentResetConfirmationError extends Error {}

/**
 * Reads Docker state only. The returned plan contains just the resources whose
 * identity is proven by the current Fields labels and mount graph.
 */
export async function preflightFullEnvironmentReset(input: {
  docker: FullEnvironmentResetDocker;
} & FullEnvironmentResetTokenSourceOptions): Promise<FullEnvironmentResetPlan> {
  const expectedControlTokenSource = expectedCompanyRuntimeControlTokenSourceFor(input);
  return preflightFullEnvironmentResetWithExpectedControlTokenSource(
    input.docker,
    expectedControlTokenSource,
  );
}

async function preflightFullEnvironmentResetWithExpectedControlTokenSource(
  docker: FullEnvironmentResetDocker,
  expectedControlTokenSource: ExpectedCompanyRuntimeControlTokenSource,
): Promise<FullEnvironmentResetPlan> {
  await docker.preflight();
  const [containers, volumes] = await Promise.all([
    docker.containers(),
    docker.volumes(),
  ]);
  return validateFullEnvironmentResetPreflightWithExpectedControlTokenSource(
    containers,
    volumes,
    expectedControlTokenSource,
  );
}

export async function resetFullEnvironment(input: {
  confirmation?: string;
  docker: FullEnvironmentResetDocker;
} & FullEnvironmentResetTokenSourceOptions): Promise<FullEnvironmentResetResult> {
  if (input.confirmation !== FULL_ENVIRONMENT_RESET_CONFIRMATION) {
    throw new FullEnvironmentResetConfirmationError(
      `Exact confirmation ${FULL_ENVIRONMENT_RESET_CONFIRMATION} is required.`,
    );
  }

  // Resolve once so every preflight in this reset proves the same configured
  // host bind source, even if the surrounding process environment changes.
  const expectedControlTokenSource = expectedCompanyRuntimeControlTokenSourceFor(input);
  const plan = await preflightFullEnvironmentResetWithExpectedControlTokenSource(
    input.docker,
    expectedControlTokenSource,
  );
  if (!plan.postgresVolume) {
    throw new FullEnvironmentResetPreflightError(
      "The exact Fields PostgreSQL project volume is required before a full environment reset.",
    );
  }

  for (const container of plan.containers) {
    await input.docker.removeContainer(container);
  }
  for (const volume of plan.workspaceVolumes) {
    await input.docker.removeVolume(volume);
  }

  // A successful Docker remove call is not sufficient evidence that the
  // resource disappeared. Re-read the exact managed graph before product data
  // can be deleted; this also catches a newly-created managed resource.
  const afterDynamicCleanup = await preflightFullEnvironmentResetWithExpectedControlTokenSource(
    input.docker,
    expectedControlTokenSource,
  );
  assertDynamicCleanupComplete(afterDynamicCleanup);

  // The PostgreSQL volume is deliberately last: any Docker cleanup failure above
  // leaves product facts intact for a safe rerun.
  await input.docker.removeVolume(plan.postgresVolume);

  const remaining = await preflightFullEnvironmentResetWithExpectedControlTokenSource(
    input.docker,
    expectedControlTokenSource,
  );
  assertResetComplete(remaining);

  return {
    containersRemoved: plan.containers.length,
    workspaceVolumesRemoved: plan.workspaceVolumes.length,
    postgresVolumeRemoved: plan.postgresVolume.name,
    preservedCaddyVolumes: plan.preservedCaddyVolumes.map((volume) => volume.name),
  };
}

export function validateFullEnvironmentResetPreflight(
  containers: EnvironmentResetContainer[],
  volumes: EnvironmentResetVolume[],
  options: FullEnvironmentResetTokenSourceOptions = {},
): FullEnvironmentResetPlan {
  return validateFullEnvironmentResetPreflightWithExpectedControlTokenSource(
    containers,
    volumes,
    expectedCompanyRuntimeControlTokenSourceFor(options),
  );
}

function validateFullEnvironmentResetPreflightWithExpectedControlTokenSource(
  containers: EnvironmentResetContainer[],
  volumes: EnvironmentResetVolume[],
  expectedControlTokenSource: ExpectedCompanyRuntimeControlTokenSource,
): FullEnvironmentResetPlan {
  const errors: string[] = [];
  const managedContainers = containers.flatMap((container) => parseManagedContainer(container, errors));
  const managedWorkspaceVolumes = volumes.flatMap((volume) => parseWorkspaceVolume(volume, errors));
  const projectVolumes = volumes.flatMap((volume) => parseProjectVolume(volume, errors));

  validateResourceCollisions(managedContainers, managedWorkspaceVolumes, projectVolumes, errors);
  validateContainerMounts(
    managedContainers,
    managedWorkspaceVolumes,
    expectedControlTokenSource,
    errors,
  );

  if (errors.length > 0) {
    throw new FullEnvironmentResetPreflightError(
      `Full environment reset preflight failed: ${errors.join("; ")}.`,
    );
  }

  const postgresVolumes = projectVolumes.filter((volume) => volume.kind === "postgres-data");
  const preservedCaddyVolumes = projectVolumes.filter(
    (volume) => volume.kind === "caddy-data" || volume.kind === "caddy-config",
  );
  return {
    containers: sortByName(managedContainers),
    workspaceVolumes: sortByName(managedWorkspaceVolumes),
    postgresVolume: postgresVolumes[0] ?? null,
    preservedCaddyVolumes: sortByName(preservedCaddyVolumes),
  };
}

function assertDynamicCleanupComplete(plan: FullEnvironmentResetPlan): void {
  if (plan.containers.length > 0 || plan.workspaceVolumes.length > 0) {
    throw new FullEnvironmentResetPreflightError(
      "Full environment reset dynamic Docker cleanup left managed resources behind.",
    );
  }
}

function assertResetComplete(plan: FullEnvironmentResetPlan): void {
  if (plan.containers.length > 0 || plan.workspaceVolumes.length > 0 || plan.postgresVolume) {
    throw new FullEnvironmentResetPreflightError(
      "Full environment reset cleanup left managed Docker resources behind.",
    );
  }
}

function parseManagedContainer(
  container: EnvironmentResetContainer,
  errors: string[],
): ManagedEnvironmentResetContainer[] {
  const fieldsLabels = fieldsLabelsOf(container.labels);
  if (Object.keys(fieldsLabels).length === 0) return [];

  if (
    fieldsLabels["fields.managed"] === "true"
    && fieldsLabels["fields.runtime_kind"] === "company"
    && !("fields.resource_kind" in fieldsLabels)
  ) {
    const companyId = requiredLabel(fieldsLabels, "fields.company_id", containerDescription(container), errors);
    const instanceId = requiredLabel(
      fieldsLabels,
      "fields.runtime_instance_id",
      containerDescription(container),
      errors,
    );
    const generation = requiredGeneration(
      fieldsLabels,
      "fields.runtime_generation",
      containerDescription(container),
      errors,
    );
    const expected = companyRuntimeContainerLabels(companyId, instanceId, generation);
    if (!recordsEqual(fieldsLabels, expected)) {
      errors.push(`${containerDescription(container)} has unexpected Fields labels`);
    }
    if (!companyId || !instanceId || generation === null) return [];
    return [{
      ...container,
      kind: "company-runtime",
      companyId,
      instanceId,
      generation,
    }];
  }

  errors.push(`${containerDescription(container)} has an unknown Fields managed identity`);
  return [];
}

function parseWorkspaceVolume(
  volume: EnvironmentResetVolume,
  errors: string[],
): ManagedWorkspaceVolume[] {
  const fieldsLabels = fieldsLabelsOf(volume.labels);
  if (Object.keys(fieldsLabels).length === 0) return [];

  if (
    fieldsLabels["fields.managed"] === "true"
    && fieldsLabels["fields.runtime_kind"] === "company"
    && fieldsLabels["fields.resource_kind"] === "workspace"
  ) {
    const companyId = requiredLabel(fieldsLabels, "fields.company_id", volumeDescription(volume), errors);
    const expected = companyRuntimeWorkspaceLabels(companyId);
    if (!recordsEqual(volume.labels, expected)) {
      errors.push(`${volumeDescription(volume)} has unexpected Fields labels`);
    }
    if (!companyId) return [];
    return [{ ...volume, kind: "company-runtime-workspace", companyId }];
  }

  errors.push(`${volumeDescription(volume)} has an unknown Fields managed identity`);
  return [];
}

function parseProjectVolume(
  volume: EnvironmentResetVolume,
  errors: string[],
): ProjectEnvironmentVolume[] {
  const project = volume.labels["com.docker.compose.project"];
  const composeVolume = volume.labels["com.docker.compose.volume"];
  if (project !== FIELDS_COMPOSE_PROJECT) {
    if (isReservedProjectVolumeName(volume.name)) {
      errors.push(`${volumeDescription(volume)} is missing the exact Fields Compose identity`);
    }
    return [];
  }

  const kind = projectVolumeKind(composeVolume);
  if (!kind) {
    errors.push(`${volumeDescription(volume)} has an unknown Fields Compose volume identity`);
    return [];
  }
  if (Object.keys(fieldsLabelsOf(volume.labels)).length > 0) {
    errors.push(`${volumeDescription(volume)} mixes Compose and Fields managed identities`);
  }
  if (volume.name !== projectVolumeName(kind)) {
    errors.push(`${volumeDescription(volume)} does not have the exact Fields project volume name`);
  }
  const unexpectedLabels = Object.keys(volume.labels).filter((key) => !key.startsWith("com.docker.compose."));
  if (unexpectedLabels.length > 0) {
    errors.push(`${volumeDescription(volume)} has unexpected non-Compose labels`);
  }
  return [{ ...volume, kind }];
}

function validateResourceCollisions(
  containers: ManagedEnvironmentResetContainer[],
  workspaceVolumes: ManagedWorkspaceVolume[],
  projectVolumes: ProjectEnvironmentVolume[],
  errors: string[],
): void {
  validateUnique(containers, containerIdentityKey, "managed container identity", errors);
  validateUnique(workspaceVolumes, workspaceIdentityKey, "Workspace Volume identity", errors);
  validateUnique(projectVolumes, (volume) => volume.kind, "project volume identity", errors);
}

function validateContainerMounts(
  containers: ManagedEnvironmentResetContainer[],
  workspaceVolumes: ManagedWorkspaceVolume[],
  expectedControlTokenSource: ExpectedCompanyRuntimeControlTokenSource,
  errors: string[],
): void {
  const workspaces = new Map<string, CompanyRuntimeWorkspaceVolume>();
  for (const volume of workspaceVolumes) {
    workspaces.set(volume.companyId, volume);
  }

  for (const container of containers) {
    const workspace = workspaces.get(container.companyId);
    if (!workspace) {
      errors.push(`${containerDescription(container)} is orphaned from its Company Runtime Workspace Volume`);
      continue;
    }
    if (expectedControlTokenSource.error) {
      errors.push(expectedControlTokenSource.error);
    } else if (!hasExactCompanyRuntimeMounts(
      container.mounts,
      workspace.name,
      expectedControlTokenSource.path!,
    )) {
      errors.push(`${containerDescription(container)} has unexpected mounts`);
    }
  }
}

function hasExactCompanyRuntimeMounts(
  mounts: EnvironmentResetMount[],
  workspaceName: string,
  controlTokenHostFile: string,
): boolean {
  if (mounts.length !== 2) return false;
  const workspace = mounts.filter((mount) => (
    mount.type === "volume"
    && mount.name === workspaceName
    && mount.destination === HOME_WORKDIR
    && mount.readWrite === true
  ));
  const token = mounts.filter((mount) => (
    mount.type === "bind"
    && mount.source === controlTokenHostFile
    && mount.destination === HOME_CONTROL_TOKEN_TARGET
    && mount.readWrite === false
  ));
  return workspace.length === 1 && token.length === 1;
}

function expectedCompanyRuntimeControlTokenSourceFor(
  options: FullEnvironmentResetTokenSourceOptions,
): ExpectedCompanyRuntimeControlTokenSource {
  const env = options.env ?? process.env;
  const configured = options.companyRuntimeControlTokenHostFile
    ?? optionalString(env.FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE);
  const path = optionalString(configured);
  if (!path) {
    return {
      path: null,
      error: "Company Runtime control-token mount source is not configured.",
    };
  }
  if (!isAbsolute(path)) {
    return {
      path: null,
      error: "Company Runtime control-token mount source is invalid.",
    };
  }
  return { path, error: null };
}

function optionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validateUnique<T>(
  items: T[],
  keyFor: (item: T) => string,
  description: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) {
      errors.push(`duplicate ${description} ${key}`);
    }
    seen.add(key);
  }
}

function containerIdentityKey(container: ManagedEnvironmentResetContainer): string {
  return [
    container.kind,
    container.companyId,
    container.instanceId,
    container.generation,
  ].join("/");
}

function workspaceIdentityKey(volume: ManagedWorkspaceVolume): string {
  return `${volume.kind}/${volume.companyId}`;
}

function companyRuntimeContainerLabels(
  companyId: string | null,
  instanceId: string | null,
  generation: number | null,
): Record<string, string> {
  return {
    "fields.managed": "true",
    "fields.runtime_kind": "company",
    "fields.company_id": companyId ?? "",
    "fields.runtime_instance_id": instanceId ?? "",
    "fields.runtime_generation": generation === null ? "" : String(generation),
  };
}

function companyRuntimeWorkspaceLabels(
  companyId: string | null,
): Record<string, string> {
  return {
    "fields.managed": "true",
    "fields.runtime_kind": "company",
    "fields.company_id": companyId ?? "",
    "fields.resource_kind": "workspace",
  };
}

function requiredLabel(
  labels: Record<string, string>,
  name: string,
  resource: string,
  errors: string[],
): string | null {
  const value = labels[name]?.trim();
  if (value) return value;
  errors.push(`${resource} is missing ${name}`);
  return null;
}

function requiredGeneration(
  labels: Record<string, string>,
  name: string,
  resource: string,
  errors: string[],
): number | null {
  const raw = labels[name];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (Number.isSafeInteger(value) && value > 0 && String(value) === raw) return value;
  errors.push(`${resource} has an invalid ${name}`);
  return null;
}

function fieldsLabelsOf(labels: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).filter(([name]) => name.startsWith(FIELDS_LABEL_PREFIX)));
}

function recordsEqual(actual: Record<string, string>, expected: Record<string, string>): boolean {
  return JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());
}

function projectVolumeKind(value: string | undefined): ProjectVolumeKind | null {
  if (value === "postgres-data" || value === "caddy-data" || value === "caddy-config") return value;
  return null;
}

function projectVolumeName(kind: ProjectVolumeKind): string {
  if (kind === "postgres-data") return POSTGRES_VOLUME_NAME;
  if (kind === "caddy-data") return CADDY_DATA_VOLUME_NAME;
  return CADDY_CONFIG_VOLUME_NAME;
}

function isReservedProjectVolumeName(name: string): boolean {
  return name === POSTGRES_VOLUME_NAME || name === CADDY_DATA_VOLUME_NAME || name === CADDY_CONFIG_VOLUME_NAME;
}

function containerDescription(container: EnvironmentResetContainer): string {
  return `container ${container.name || container.id}`;
}

function volumeDescription(volume: EnvironmentResetVolume): string {
  return `volume ${volume.name}`;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

export class DockerodeFullEnvironmentResetDocker implements FullEnvironmentResetDocker {
  constructor(private readonly docker: Dockerode = new Dockerode()) {}

  async preflight(): Promise<void> {
    await this.docker.ping();
  }

  async containers(): Promise<EnvironmentResetContainer[]> {
    const summaries = await this.docker.listContainers({ all: true });
    const candidates = summaries.filter((summary) => hasFieldsLabels(summary.Labels ?? {}));
    const containers: EnvironmentResetContainer[] = [];
    for (const summary of candidates) {
      const inspected = await this.docker.getContainer(summary.Id).inspect();
      const container = containerFromInspect(inspected);
      if (!hasFieldsLabels(container.labels)) {
        throw new FullEnvironmentResetPreflightError(
          `Container ${container.name} changed its Fields labels during reset preflight.`,
        );
      }
      containers.push(container);
    }
    return containers;
  }

  async volumes(): Promise<EnvironmentResetVolume[]> {
    const response = await this.docker.listVolumes();
    return (response.Volumes ?? []).filter((volume) => (
      hasFieldsLabels(volume.Labels ?? {})
      || volume.Labels?.["com.docker.compose.project"] === FIELDS_COMPOSE_PROJECT
      // A lost Compose label on one of these fixed project names is an
      // identity conflict, not a reason to hide it from the fail-closed
      // preflight validator.
      || isReservedProjectVolumeName(volume.Name)
    )).map((volume) => ({
      name: volume.Name,
      labels: volume.Labels ?? {},
    }));
  }

  async removeContainer(container: EnvironmentResetContainer): Promise<void> {
    const current = await this.currentContainer(container.id);
    if (!current) return;
    if (!sameContainer(current, container)) {
      throw new FullEnvironmentResetPreflightError(
        `Container ${container.name} changed after reset preflight.`,
      );
    }
    try {
      await this.docker.getContainer(container.id).remove({ force: true });
    } catch (error) {
      if (dockerStatusCode(error) !== 404) throw error;
    }
  }

  async removeVolume(volume: EnvironmentResetVolume): Promise<void> {
    const current = await this.currentVolume(volume.name);
    if (!current) return;
    if (!sameVolume(current, volume)) {
      throw new FullEnvironmentResetPreflightError(
        `Volume ${volume.name} changed after reset preflight.`,
      );
    }
    try {
      await this.docker.getVolume(volume.name).remove();
    } catch (error) {
      if (dockerStatusCode(error) !== 404) throw error;
    }
  }

  private async currentContainer(id: string): Promise<EnvironmentResetContainer | null> {
    try {
      return containerFromInspect(await this.docker.getContainer(id).inspect());
    } catch (error) {
      if (dockerStatusCode(error) === 404) return null;
      throw error;
    }
  }

  private async currentVolume(name: string): Promise<EnvironmentResetVolume | null> {
    try {
      const inspected = await this.docker.getVolume(name).inspect();
      return { name: inspected.Name, labels: inspected.Labels ?? {} };
    } catch (error) {
      if (dockerStatusCode(error) === 404) return null;
      throw error;
    }
  }
}

function hasFieldsLabels(labels: Record<string, string>): boolean {
  return Object.keys(labels).some((name) => name.startsWith(FIELDS_LABEL_PREFIX));
}

function containerFromInspect(inspected: Dockerode.ContainerInspectInfo): EnvironmentResetContainer {
  return {
    id: inspected.Id,
    name: inspected.Name.replace(/^\//u, ""),
    labels: inspected.Config?.Labels ?? {},
    mounts: (inspected.Mounts ?? []).map((mount) => ({
      type: stringOrNull(mount.Type),
      name: stringOrNull(mount.Name),
      source: stringOrNull(mount.Source),
      destination: stringOrNull(mount.Destination),
      readWrite: typeof mount.RW === "boolean" ? mount.RW : null,
    })),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sameContainer(left: EnvironmentResetContainer, right: EnvironmentResetContainer): boolean {
  return left.id === right.id
    && left.name === right.name
    && recordsEqual(left.labels, right.labels)
    && JSON.stringify(normalizedMounts(left.mounts)) === JSON.stringify(normalizedMounts(right.mounts));
}

function normalizedMounts(mounts: EnvironmentResetMount[]): EnvironmentResetMount[] {
  return [...mounts].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function sameVolume(left: EnvironmentResetVolume, right: EnvironmentResetVolume): boolean {
  return left.name === right.name && recordsEqual(left.labels, right.labels);
}

function dockerStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : null;
}
