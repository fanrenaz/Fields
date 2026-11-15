import assert from "node:assert/strict";
import test from "node:test";

import {
  DockerodeFullEnvironmentResetDocker,
  FULL_ENVIRONMENT_RESET_CONFIRMATION,
  FullEnvironmentResetConfirmationError,
  FullEnvironmentResetPreflightError,
  preflightFullEnvironmentReset,
  resetFullEnvironment,
  type EnvironmentResetContainer,
  type EnvironmentResetVolume,
  type FullEnvironmentResetDocker,
} from "../../../src/ops/reset-environment.js";

const CONTROL_TOKEN_HOST_FILE = "/srv/fields/control-token";

test("read-only preflight enumerates exact Company Runtime resources and preserves Caddy", async () => {
  const docker = completeDocker();
  const plan = await preflightFullEnvironmentReset({
    docker,
    env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
  });

  assert.deepEqual(plan.containers.map((container) => container.name), ["runtime-container"]);
  assert.deepEqual(plan.workspaceVolumes.map((volume) => volume.name), ["runtime-workspace"]);
  assert.equal(plan.postgresVolume?.name, "fields_postgres-data");
  assert.deepEqual(plan.preservedCaddyVolumes.map((volume) => volume.name), [
    "fields_caddy-config",
    "fields_caddy-data",
  ]);
  assert.deepEqual(docker.removed, []);
});

test("execution requires the exact V3 confirmation before Docker access", async () => {
  const docker = completeDocker();
  await assert.rejects(
    () => resetFullEnvironment({ docker, confirmation: "RESET_FIELDS_BACKEND_V2" }),
    (error) => error instanceof FullEnvironmentResetConfirmationError,
  );
  assert.equal(docker.preflights, 0);
  assert.deepEqual(docker.removed, []);
});

test("preflight fails closed for stale dual-runtime labels", async () => {
  const docker = new MemoryDocker([{
    id: "old-home",
    name: "old-home",
    labels: {
      "fields.kind": "company-home",
      "fields.company_id": "company-one",
    },
    mounts: [],
  }], [postgresVolume()]);

  await assert.rejects(
    () => preflightFullEnvironmentReset({
      docker,
      env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
    }),
    (error) => error instanceof FullEnvironmentResetPreflightError
      && /unknown Fields managed identity/u.test(error.message),
  );
});

test("preflight rejects unexpected labels, mounts, and duplicate Company workspaces", async (t) => {
  await t.test("unexpected label", async () => {
    const docker = completeDocker();
    docker.containerItems[0]!.labels["fields.unexpected"] = "true";
    await assert.rejects(
      () => preflightFullEnvironmentReset({
        docker,
        env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
      }),
      /unexpected Fields labels/u,
    );
  });

  await t.test("unexpected mount", async () => {
    const docker = completeDocker();
    docker.containerItems[0]!.mounts.push({
      type: "bind",
      name: null,
      source: "/unexpected",
      destination: "/unexpected",
      readWrite: false,
    });
    await assert.rejects(
      () => preflightFullEnvironmentReset({
        docker,
        env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
      }),
      /unexpected mounts/u,
    );
  });

  await t.test("duplicate workspace", async () => {
    const duplicate = runtimeWorkspace();
    duplicate.name = "runtime-workspace-duplicate";
    const docker = new MemoryDocker(
      [runtimeContainer()],
      [runtimeWorkspace(), duplicate, postgresVolume()],
    );
    await assert.rejects(
      () => preflightFullEnvironmentReset({
        docker,
        env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
      }),
      /duplicate Workspace Volume identity/u,
    );
  });
});

test("preflight requires the configured absolute Company Runtime token source", async () => {
  const docker = completeDocker();
  await assert.rejects(
    () => preflightFullEnvironmentReset({ docker, env: {} }),
    /Company Runtime control-token mount source is not configured/u,
  );
  await assert.rejects(
    () => preflightFullEnvironmentReset({
      docker,
      env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: "relative/token" },
    }),
    /Company Runtime control-token mount source is invalid/u,
  );
});

test("workspace cleanup failure prevents PostgreSQL deletion", async () => {
  const docker = completeDocker();
  docker.failVolume = "runtime-workspace";

  await assert.rejects(
    () => resetFullEnvironment({
      docker,
      confirmation: FULL_ENVIRONMENT_RESET_CONFIRMATION,
      env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
    }),
    /workspace busy/u,
  );
  assert.equal(docker.removed.includes("volume:fields_postgres-data"), false);
});

test("successful reset proves Runtime cleanup before deleting PostgreSQL", async () => {
  const docker = completeDocker();
  const result = await resetFullEnvironment({
    docker,
    confirmation: FULL_ENVIRONMENT_RESET_CONFIRMATION,
    env: { FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE: CONTROL_TOKEN_HOST_FILE },
  });

  assert.deepEqual(docker.events, [
    "preflight",
    "container:runtime-container-id",
    "volume:runtime-workspace",
    "preflight",
    "volume:fields_postgres-data",
    "preflight",
  ]);
  assert.deepEqual(result, {
    containersRemoved: 1,
    workspaceVolumesRemoved: 1,
    postgresVolumeRemoved: "fields_postgres-data",
    preservedCaddyVolumes: ["fields_caddy-config", "fields_caddy-data"],
  });
});

test("Docker discovery includes a reserved PostgreSQL volume with lost labels", async () => {
  const docker = new DockerodeFullEnvironmentResetDocker({
    listVolumes: async () => ({ Volumes: [{ Name: "fields_postgres-data", Labels: {} }] }),
  } as never);
  assert.deepEqual(await docker.volumes(), [{ name: "fields_postgres-data", labels: {} }]);
});

class MemoryDocker implements FullEnvironmentResetDocker {
  preflights = 0;
  events: string[] = [];
  removed: string[] = [];
  failVolume: string | null = null;

  constructor(
    public containerItems: EnvironmentResetContainer[],
    public volumeItems: EnvironmentResetVolume[],
  ) {}

  async preflight(): Promise<void> {
    this.preflights += 1;
    this.events.push("preflight");
  }

  async containers(): Promise<EnvironmentResetContainer[]> {
    return this.containerItems.map((container) => ({
      ...container,
      labels: { ...container.labels },
      mounts: container.mounts.map((mount) => ({ ...mount })),
    }));
  }

  async volumes(): Promise<EnvironmentResetVolume[]> {
    return this.volumeItems.map((volume) => ({ ...volume, labels: { ...volume.labels } }));
  }

  async removeContainer(container: EnvironmentResetContainer): Promise<void> {
    this.removed.push(`container:${container.id}`);
    this.events.push(`container:${container.id}`);
    this.containerItems = this.containerItems.filter((item) => item.id !== container.id);
  }

  async removeVolume(volume: EnvironmentResetVolume): Promise<void> {
    if (volume.name === this.failVolume) throw new Error("workspace busy");
    this.removed.push(`volume:${volume.name}`);
    this.events.push(`volume:${volume.name}`);
    this.volumeItems = this.volumeItems.filter((item) => item.name !== volume.name);
  }
}

function completeDocker(): MemoryDocker {
  return new MemoryDocker(
    [runtimeContainer()],
    [runtimeWorkspace(), postgresVolume(), caddyDataVolume(), caddyConfigVolume()],
  );
}

function runtimeContainer(): EnvironmentResetContainer {
  return {
    id: "runtime-container-id",
    name: "runtime-container",
    labels: {
      "fields.managed": "true",
      "fields.runtime_kind": "company",
      "fields.company_id": "company-one",
      "fields.runtime_instance_id": "runtime-instance-one",
      "fields.runtime_generation": "1",
    },
    mounts: [
      {
        type: "volume",
        name: "runtime-workspace",
        source: "/var/lib/docker/volumes/runtime-workspace/_data",
        destination: "/workdir",
        readWrite: true,
      },
      {
        type: "bind",
        name: null,
        source: CONTROL_TOKEN_HOST_FILE,
        destination: "/run/secrets/fields-control-token",
        readWrite: false,
      },
    ],
  };
}

function runtimeWorkspace(): EnvironmentResetVolume {
  return {
    name: "runtime-workspace",
    labels: {
      "fields.managed": "true",
      "fields.runtime_kind": "company",
      "fields.company_id": "company-one",
      "fields.resource_kind": "workspace",
    },
  };
}

function postgresVolume(): EnvironmentResetVolume {
  return composeVolume("fields_postgres-data", "postgres-data");
}

function caddyDataVolume(): EnvironmentResetVolume {
  return composeVolume("fields_caddy-data", "caddy-data");
}

function caddyConfigVolume(): EnvironmentResetVolume {
  return composeVolume("fields_caddy-config", "caddy-config");
}

function composeVolume(name: string, composeVolumeName: string): EnvironmentResetVolume {
  return {
    name,
    labels: {
      "com.docker.compose.project": "fields",
      "com.docker.compose.volume": composeVolumeName,
      "com.docker.compose.version": "2.0.0",
    },
  };
}
