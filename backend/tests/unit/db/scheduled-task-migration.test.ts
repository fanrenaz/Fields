import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(import.meta.dirname, "../../../drizzle/0025_scheduled_tasks.sql"), "utf8");
const targetKindMigration = readFileSync(resolve(import.meta.dirname, "../../../drizzle/0027_scheduled_task_target_kind.sql"), "utf8");

test("scheduled-task migration backfills one hidden scheduler per Company and Room", () => {
  assert.match(migration, /actors_company_scheduler_unique[\s\S]*where "system_role" = 'scheduler'/iu);
  assert.match(migration, /insert into "actors"[\s\S]*'human'[\s\S]*'定时任务'[\s\S]*'scheduler'/iu);
  assert.match(migration, /from "companies" company[\s\S]*on conflict do nothing/iu);
  assert.match(migration, /insert into "room_memberships"[\s\S]*join "actors" scheduler[\s\S]*on conflict \("room_id", "actor_id"\) do nothing/iu);
});

test("scheduled-task target-kind migration upgrades persisted content and idempotency receipts", () => {
  assert.match(targetKindMigration, /rename column "scope" to "target_kind"/iu);
  assert.match(targetKindMigration, /jsonb_build_object\('kind', "content_json" -> 'scope'\)/iu);
  assert.match(targetKindMigration, /scheduled_task_mutation_receipts[\s\S]*\{target,kind\}[\s\S]*\{content,kind\}/iu);
  assert.match(targetKindMigration, /scheduled_tasks_target_kind_check/iu);
  assert.doesNotMatch(targetKindMigration, /alter table "scheduled_tasks" rename column "target_kind" to "scope"/iu);
});

test("scheduled-task migration installs occurrence, due-scan, history, and idempotency constraints", () => {
  assert.match(migration, /create table "scheduled_tasks"/iu);
  assert.match(migration, /scheduled_tasks_due_idx/iu);
  assert.match(migration, /create table "scheduled_task_runs"/iu);
  assert.match(migration, /scheduled_task_runs_occurrence_unique/iu);
  assert.match(migration, /scheduled_task_runs_task_history_idx/iu);
  assert.match(migration, /create table "scheduled_task_mutation_receipts"/iu);
  assert.match(migration, /scheduled_task_mutation_receipts_key_unique/iu);
});
