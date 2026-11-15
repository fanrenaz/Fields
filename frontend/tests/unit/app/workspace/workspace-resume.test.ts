import assert from "node:assert/strict";
import test from "node:test";

import {
  readWorkspaceResume,
  workspaceResumeKey,
  workspaceResumeStorage,
  writeWorkspaceResume,
  type WorkspaceProductDestination,
  type WorkspaceResumeStorage,
} from "../../../../app/workspace/workspace-resume";

test("renderer resume state always uses local storage", () => {
  const localStorage = memoryStorage();
  const browser = { localStorage };

  assert.equal(
    workspaceResumeStorage({ platform: "desktop", appVersion: "1.2.3" }, browser),
    localStorage,
  );
});

test("stable product destinations round-trip without transient workspace state", () => {
  const destinations: WorkspaceProductDestination[] = [
    { page: "home", threadId: "thread-1" },
    { page: "room", roomId: "room-1" },
    { page: "member", actorId: "actor-1" },
    { page: "files" },
    { page: "scheduledTasks" },
    { page: "assets", assetId: "asset-1", kind: "skill", lifecycle: "draft" },
    { page: "mail", mailboxId: "mailbox-1", folderId: "folder-1", messageId: "message-1" },
  ];
  const runtime = { platform: "desktop", appVersion: "1.2.3" } as const;

  for (const [index, destination] of destinations.entries()) {
    const storage = memoryStorage();
    const key = `destination-${index}`;
    assert.equal(writeWorkspaceResume(storage, key, runtime, destination), true);
    assert.deepEqual(readWorkspaceResume(storage, key, runtime), {
      outcome: "restored",
      view: destination,
    });
    const serialized = storage.getItem(key) ?? "";
    assert.doesNotMatch(serialized, /draftText|password|search|overlay|dialog|invitationCredential/u);
  }
});

test("settings route restores with the underlying product destination", () => {
  const storage = memoryStorage();
  const runtime = { platform: "desktop", appVersion: "1.2.3" } as const;
  const view = {
    page: "settings",
    returnTo: { page: "room", roomId: "room-1" },
  } as const;

  assert.equal(writeWorkspaceResume(storage, "settings", runtime, view), true);
  assert.deepEqual(readWorkspaceResume(storage, "settings", runtime), {
    outcome: "restored",
    view,
  });
});

test("desktop records survive the same version and expire after an app update", () => {
  const storage = memoryStorage();
  const current = { platform: "desktop", appVersion: "1.2.3" } as const;
  const updated = { platform: "desktop", appVersion: "1.2.4" } as const;
  const view = { page: "files" } as const;

  assert.equal(writeWorkspaceResume(storage, "desktop", current, view), true);
  assert.deepEqual(readWorkspaceResume(storage, "desktop", current), {
    outcome: "restored",
    view,
  });
  assert.deepEqual(readWorkspaceResume(storage, "desktop", updated), {
    outcome: "desktop_version_changed",
    view: null,
  });
  assert.equal(storage.getItem("desktop"), null);
});

test("records are isolated by company and actor", () => {
  assert.notEqual(workspaceResumeKey("company-a", "actor-a"), workspaceResumeKey("company-b", "actor-a"));
  assert.notEqual(workspaceResumeKey("company-a", "actor-a"), workspaceResumeKey("company-a", "actor-b"));
});

test("invalid records are discarded and unavailable storage never blocks navigation", () => {
  const storage = memoryStorage();
  storage.setItem("invalid", JSON.stringify({
    schemaVersion: 1,
    desktopAppVersion: "1.2.3",
    view: { page: "search", query: "secret" },
  }));
  assert.deepEqual(readWorkspaceResume(storage, "invalid", { platform: "desktop", appVersion: "1.2.3" }), {
    outcome: "invalid",
    view: null,
  });
  assert.equal(storage.getItem("invalid"), null);

  const unavailable: WorkspaceResumeStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  assert.deepEqual(readWorkspaceResume(unavailable, "key", { platform: "desktop", appVersion: "1.2.3" }), {
    outcome: "storage_unavailable",
    view: null,
  });
  assert.equal(writeWorkspaceResume(unavailable, "key", { platform: "desktop", appVersion: "1.2.3" }, { page: "files" }), false);
});

function memoryStorage(): WorkspaceResumeStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
