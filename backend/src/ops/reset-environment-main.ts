#!/usr/bin/env node
import {
  DockerodeFullEnvironmentResetDocker,
  FULL_ENVIRONMENT_RESET_CONFIRMATION,
  FullEnvironmentResetPreflightError,
  preflightFullEnvironmentReset,
  resetFullEnvironment,
  type FullEnvironmentResetDocker,
  type FullEnvironmentResetPlan,
} from "./reset-environment.js";

type CliMode = { mode: "preflight" } | { mode: "execute"; confirmation: string };

export async function main(
  argumentsList: string[] = process.argv.slice(2),
  docker: FullEnvironmentResetDocker = new DockerodeFullEnvironmentResetDocker(),
): Promise<number> {
  try {
    const command = parseCommand(argumentsList);
    if (command.mode === "preflight") {
      const plan = await preflightFullEnvironmentReset({ docker });
      process.stdout.write(`${JSON.stringify({
        stage: "preflight",
        status: "passed",
        mode: "read-only",
        plan: safePlan(plan),
      })}\n`);
      return 0;
    }

    const result = await resetFullEnvironment({ docker, confirmation: command.confirmation });
    process.stdout.write(`${JSON.stringify({ stage: "complete", status: "passed", ...result })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      stage: error instanceof FullEnvironmentResetPreflightError ? "preflight" : "reset",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    return 1;
  }
}

function parseCommand(argumentsList: string[]): CliMode {
  if (argumentsList.length === 0) return { mode: "preflight" };
  if (argumentsList.length === 2 && argumentsList[0] === "--confirm") {
    return { mode: "execute", confirmation: argumentsList[1] ?? "" };
  }
  throw new FullEnvironmentResetPreflightError(
    `Usage: reset-environment-main.ts [--confirm ${FULL_ENVIRONMENT_RESET_CONFIRMATION}]`,
  );
}

function safePlan(plan: FullEnvironmentResetPlan): object {
  return {
    containers: plan.containers.map((container) => ({
      id: container.id,
      name: container.name,
      kind: container.kind,
    })),
    workspaceVolumes: plan.workspaceVolumes.map((volume) => ({ name: volume.name, kind: volume.kind })),
    postgresVolume: plan.postgresVolume?.name ?? null,
    preservedCaddyVolumes: plan.preservedCaddyVolumes.map((volume) => volume.name),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
