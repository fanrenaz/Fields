import { chmod, lstat, mkdir, readdir, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

export const MEMBERS_DIR = "members";
export const ROOMS_DIR = "rooms";
export const EXECUTORS_DIR = "executors";
export const WORKSPACE_DIR = "workspace";
export const MEMBER_CODEX_HOME_DIR = ".codex";
export const BUILDER_WORKSPACES_DIR = "builders";
const LEGACY_SHARED_DIR = "shared";
const LEGACY_SHARED_CHILDREN = ["memories", "resources", "context"] as const;

export type CompanyRuntimeLayout = {
  root: string;
  members: string;
  rooms: string;
  executors: string;
};

export type MemberWorkspaceLayout = {
  memberId: string;
  memberRoot: string;
  workspace: string;
  codexHome: string;
};

export function memberCompanyFilesCacheRoot(layout: MemberWorkspaceLayout): string {
  return join(layout.memberRoot, ".runtime", "company-files");
}


export type BuilderWorkspaceLayout = {
  memberId: string;
  kind: "agent" | "asset";
  topicId: string;
  root: string;
  workspace: string;
};

export class WorkspaceLayoutError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: { details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "WorkspaceLayoutError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export async function ensureCompanyRuntimeLayout(workdir: string): Promise<CompanyRuntimeLayout> {
  const layout = companyRuntimeLayout(workdir);
  await ensureDirectory(layout.root, "company_runtime_invalid", "Company Runtime root", { root: layout.root }, 0o750);
  await ensureDirectory(layout.members, "members_root_invalid", "Members root", { members: layout.members }, 0o700);
  await ensureDirectory(layout.rooms, "rooms_root_invalid", "Rooms root", { rooms: layout.rooms }, 0o750);
  await ensureDirectory(layout.executors, "executors_root_invalid", "Executors root", { executors: layout.executors }, 0o700);
  return layout;
}

export function companyRuntimeLayout(workdir: string): CompanyRuntimeLayout {
  const root = resolve(workdir);
  return {
    root,
    members: join(root, MEMBERS_DIR),
    rooms: join(root, ROOMS_DIR),
    executors: join(root, EXECUTORS_DIR),
  };
}

export async function provisionMemberWorkspace(workdir: string, memberId: string): Promise<MemberWorkspaceLayout> {
  await ensureCompanyRuntimeLayout(workdir);
  const layout = memberWorkspaceLayout(workdir, memberId);
  await ensureDirectory(layout.memberRoot, "member_workspace_invalid", "Member root", {
    member_id: layout.memberId,
    member_root: layout.memberRoot,
  }, 0o700);
  await ensureDirectory(layout.workspace, "member_workspace_invalid", "Member workspace", {
    member_id: layout.memberId,
    workspace: layout.workspace,
  }, 0o700);
  await ensureDirectory(layout.codexHome, "member_codex_home_invalid", "Member CODEX_HOME", {
    member_id: layout.memberId,
    codex_home: layout.codexHome,
  }, 0o700);
  await ensureDirectory(memberCompanyFilesCacheRoot(layout), "member_workspace_invalid", "Company Files cache", {
    member_id: layout.memberId,
  }, 0o700);
  await chmod(memberCompanyFilesCacheRoot(layout), 0o500);
  await assertMemberCodexHomeCredentialFree(layout);
  return layout;
}

export async function requireMemberWorkspace(workdir: string, memberId: string): Promise<MemberWorkspaceLayout> {
  const layout = memberWorkspaceLayout(workdir, memberId);
  await requireDirectory(layout.workspace, "member_workspace_not_provisioned", "member_workspace_invalid", "Member workspace", {
    member_id: layout.memberId,
    workspace: layout.workspace,
  });
  return provisionMemberWorkspace(workdir, memberId);
}

export async function provisionBuilderWorkspace(
  workdir: string,
  memberId: string,
  kind: "agent" | "asset",
  topicId: string,
): Promise<BuilderWorkspaceLayout> {
  const member = await provisionMemberWorkspace(workdir, memberId);
  const layout = builderWorkspaceLayout(workdir, memberId, kind, topicId);
  await ensureDirectory(
    join(member.memberRoot, BUILDER_WORKSPACES_DIR),
    "builder_workspace_invalid",
    "Builder workspaces root",
    { member_id: layout.memberId },
    0o700,
  );
  await ensureDirectory(
    join(member.memberRoot, BUILDER_WORKSPACES_DIR, layout.kind),
    "builder_workspace_invalid",
    "Builder kind root",
    { member_id: layout.memberId, builder_kind: layout.kind },
    0o700,
  );
  await ensureDirectory(layout.root, "builder_workspace_invalid", "Builder topic root", {
    member_id: layout.memberId,
    builder_kind: layout.kind,
    topic_id: layout.topicId,
  }, 0o700);
  await ensureDirectory(layout.workspace, "builder_workspace_invalid", "Builder workspace", {
    member_id: layout.memberId,
    builder_kind: layout.kind,
    topic_id: layout.topicId,
  }, 0o700);
  return layout;
}

export function builderWorkspaceLayout(
  workdir: string,
  memberId: string,
  kind: "agent" | "asset",
  topicId: string,
): BuilderWorkspaceLayout {
  const member = memberWorkspaceLayout(workdir, memberId);
  const safeTopicId = safePathComponent(topicId, "builder_topic_id");
  const root = join(member.memberRoot, BUILDER_WORKSPACES_DIR, kind, safeTopicId);
  return {
    memberId: member.memberId,
    kind,
    topicId: safeTopicId,
    root,
    workspace: join(root, WORKSPACE_DIR),
  };
}

export function memberWorkspaceLayout(workdir: string, memberId: string): MemberWorkspaceLayout {
  const root = resolve(workdir);
  const safeMemberId = safePathComponent(memberId, "member_id");
  const memberRoot = join(root, MEMBERS_DIR, safeMemberId);
  const workspace = join(memberRoot, WORKSPACE_DIR);
  return {
    memberId: safeMemberId,
    memberRoot,
    workspace,
    codexHome: join(workspace, MEMBER_CODEX_HOME_DIR),
  };
}

export async function removeMemberWorkspace(workdir: string, memberId: string): Promise<void> {
  const runtime = companyRuntimeLayout(workdir);
  const member = memberWorkspaceLayout(workdir, memberId);
  const membersRoot = resolve(runtime.members);
  const memberRoot = resolve(member.memberRoot);
  const memberRelativePath = relative(membersRoot, memberRoot);
  if (
    memberRoot === membersRoot
    || dirname(memberRoot) !== membersRoot
    || basename(memberRoot) !== member.memberId
    || memberRelativePath !== member.memberId
  ) {
    throw new WorkspaceLayoutError(
      "member_cleanup_path_invalid",
      "Member cleanup target must be one exact child of the Members root.",
      {
        details: {
          member_id: member.memberId,
          members_root: membersRoot,
          member_root: memberRoot,
        },
      },
    );
  }
  const membersRootMetadata = await lstatOrNull(membersRoot);
  if (membersRootMetadata === null) return;
  if (!membersRootMetadata.isDirectory() || membersRootMetadata.isSymbolicLink()) {
    throw new WorkspaceLayoutError(
      "members_root_invalid",
      "Members root must be a real directory before Member cleanup.",
      { details: { members_root: membersRoot } },
    );
  }
  await makeTreeRemovable(memberRoot);
  await rm(memberRoot, { recursive: true, force: true, maxRetries: 3 });
}

async function makeTreeRemovable(root: string): Promise<void> {
  const metadata = await lstatOrNull(root);
  if (metadata === null || metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory()) return;
  await chmod(root, 0o700);
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => makeTreeRemovable(join(root, entry.name))));
}

export async function assertMemberCodexHomeCredentialFree(layout: MemberWorkspaceLayout): Promise<void> {
  const authPath = join(layout.codexHome, "auth.json");
  const credential = await lstatOrNull(authPath);
  if (credential !== null) {
    throw new WorkspaceLayoutError(
      "member_codex_home_contains_auth",
      "Member CODEX_HOME must never contain auth.json; Executor credentials belong to Company Runtime.",
      { details: { member_id: layout.memberId, auth_path: authPath } },
    );
  }
}

export function safePathComponent(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkspaceLayoutError("invalid_path_component", `${name} must be a non-empty string.`, { details: { name } });
  }
  if (value.includes("/") || value.includes("\\") || value === "." || value === ".." || value.includes("\0")) {
    throw new WorkspaceLayoutError("invalid_path_component", `${name} must not contain path separators or traversal components.`, {
      details: { name, value },
    });
  }
  return value;
}

export async function removeLegacySharedDirectories(workdir: string): Promise<string[]> {
  const layout = companyRuntimeLayout(workdir);
  const roots = [
    layout.root,
    ...(await childDirectories(layout.members)).map((memberRoot) => join(memberRoot, WORKSPACE_DIR)),
    ...await childDirectories(layout.rooms),
  ];
  const removed: string[] = [];
  for (const root of roots) {
    const shared = join(root, LEGACY_SHARED_DIR);
    const sharedMetadata = await lstatOrNull(shared);
    if (sharedMetadata === null) continue;
    if (sharedMetadata.isSymbolicLink()) {
      throw new WorkspaceLayoutError(
        "legacy_shared_cleanup_symlink",
        "Legacy shared cleanup must not follow a symbolic link.",
        { details: { shared } },
      );
    }
    if (!sharedMetadata.isDirectory()) continue;
    for (const child of LEGACY_SHARED_CHILDREN) {
      const target = join(shared, child);
      const metadata = await lstatOrNull(target);
      if (metadata === null) continue;
      if (metadata.isSymbolicLink()) {
        throw new WorkspaceLayoutError(
          "legacy_shared_cleanup_symlink",
          "Legacy shared cleanup must not follow a symbolic link.",
          { details: { target } },
        );
      }
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      removed.push(target);
    }
    await rmdir(shared).catch((error: unknown) => {
      if (isNodeError(error) && (error.code === "ENOTEMPTY" || error.code === "EEXIST")) return;
      throw error;
    });
  }
  return removed;
}

async function childDirectories(root: string): Promise<string[]> {
  const metadata = await lstatOrNull(root);
  if (metadata === null) return [];
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WorkspaceLayoutError(
      "legacy_shared_cleanup_root_invalid",
      "Legacy shared cleanup root must be a real directory.",
      { details: { root } },
    );
  }
  const children: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const child = await lstatOrNull(path);
    if (child?.isDirectory() && !child.isSymbolicLink()) children.push(path);
  }
  return children;
}

async function ensureDirectory(
  path: string,
  errorCode: string,
  label: string,
  details: Record<string, unknown>,
  mode = 0o750,
): Promise<void> {
  const existing = await lstatOrNull(path);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new WorkspaceLayoutError(errorCode, `${label} must be a real directory.`, { details });
    }
    return;
  }
  await mkdir(path, { recursive: true, mode });
  const created = await lstatOrNull(path);
  if (!created || created.isSymbolicLink() || !created.isDirectory()) {
    throw new WorkspaceLayoutError(errorCode, `${label} could not be created safely.`, { details });
  }
}

async function requireDirectory(
  path: string,
  missingCode: string,
  invalidCode: string,
  label: string,
  details: Record<string, unknown>,
): Promise<void> {
  const existing = await lstatOrNull(path);
  if (!existing) {
    throw new WorkspaceLayoutError(missingCode, `${label} is not provisioned.`, { details });
  }
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new WorkspaceLayoutError(invalidCode, `${label} must be a real directory.`, { details });
  }
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
