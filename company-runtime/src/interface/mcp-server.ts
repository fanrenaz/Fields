import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  companyRuntimeRoomMessagesResourceSchema,
  type CompanyRuntimeRoomMessagesReadInput,
  type CompanyRuntimeRoomMessagesReadResult,
  type CompanyRuntimeSearchQueryResult,
} from "@fields/contracts/internal/company-runtime";
import {
  embodimentCallEndInputSchema as callEndInputSchema,
  embodimentCallExchangeInputSchema as callExchangeInputSchema,
  embodimentCallStartInputSchema as callStartInputSchema,
  type EmbodimentCallEndInput as CallEndInput,
  type EmbodimentCallExchangeInput as CallExchangeInput,
  type EmbodimentCallStartInput as CallStartInput,
} from "@fields/contracts/public/embodiment";
import {
  globalSearchInputSchema,
  type GlobalSearchInput,
} from "@fields/contracts/public/search";
import {
  companyFileListInputSchema,
  type CompanyFileListInput,
} from "@fields/contracts/public/company-file";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  mailMcpSendInputSchema,
  mailMcpSaveAttachmentInputSchema,
  mailMcpUpdateInputSchema,
  type MailMcpSendInput,
  type MailMcpSaveAttachmentInput,
  type MailMcpUpdateInput,
} from "@fields/contracts/internal/mail";
import {
  mailMessageListInputSchema,
  mailMessageReadInputSchema,
  mailMessageSearchInputSchema,
  type MailMessageListInput,
  type MailMessageReadInput,
  type MailMessageSearchInput,
} from "@fields/contracts/public/mail";
import {
  assetArchiveInputSchema,
  assetContentReadInputSchema,
  assetDraftCreateMcpInputSchema,
  assetDraftImportGitInputSchema,
  assetDraftRevisionInputSchema,
  assetDraftUpdateInputSchema,
  assetListInputSchema,
  assetNameSchema,
  assetMcpCredentialReplaceInputSchema,
  assetReadInputSchema,
  assetSlugSchema,
  assetVersionSchema,
  assetKindSchema,
  selfMemberAssetApplyInputSchema,
  type AssetArchiveInput,
  type AssetContentReadInput,
  type AssetDraftCreateMcpInput,
  type AssetDraftImportGitInput,
  type AssetDraftRevisionInput,
  type AssetDraftUpdateInput,
  type AssetListInput,
  type AssetMcpCredentialReplaceInput,
  type AssetReadInput,
  type SelfMemberAssetApplyInput,
} from "@fields/contracts/public/asset";

import {
  CallMcpError,
  type CallEndToolResult,
  type CallExchangeToolResult,
  type CallStartToolResult,
  type TerminalListToolResult,
} from "../application/mcp/embodiment-call.js";
import { MailServiceError } from "../application/mail/index.js";
import { recordRoomMessagesToolCall } from "../observability/events.js";

export const EMBODIMENT_TOOL_NAMES = [
  "embodiment.terminal.list",
  "embodiment.call.start",
  "embodiment.call.exchange",
  "embodiment.call.end",
] as const;
export const SEARCH_TOOL_NAMES = [
  "search.query",
  "company.files.list",
  "company.files.read",
  "company.files.publish",
] as const;
export const ROOM_MESSAGES_TOOL_NAMES = ["room.messages.read"] as const;
// The MCP SDK only publishes Zod object roots. Keep callback-boundary parsing permissive
// so roomMessagesToolResult can return stable safe errors, while discovery exposes the
// canonical strict selector union.
const roomMessagesToolInputBoundarySchema = z.object({}).catchall(z.unknown()).meta({
  oneOf: z.toJSONSchema(companyRuntimeRoomMessagesResourceSchema, {
    target: "draft-7",
    io: "input",
  }).oneOf,
});
export const ASSET_TOOL_NAMES = [
  "assets.list",
  "assets.read",
  "assets.content.read",
  "assets.draft.import_git",
  "assets.draft.import_workspace_zip",
  "assets.draft.create_mcp",
  "assets.draft.update",
  "assets.draft.validate",
  "assets.draft.delete",
  "assets.publish",
  "assets.archive",
  "assets.restore",
  "assets.mcp.credential.replace",
  "assets.installations.read",
  "assets.installations.options",
  "assets.installations.apply",
] as const;
export const MAIL_TOOL_NAMES = [
  "mail_list_mailboxes",
  "mail_list_messages",
  "mail_search_messages",
  "mail_read_message",
  "mail_send_message",
  "mail_update_message",
  "mail_save_attachment",
] as const;

export type EmbodimentToolName = typeof EMBODIMENT_TOOL_NAMES[number];
export type SearchToolName = typeof SEARCH_TOOL_NAMES[number];
export type AssetToolName = typeof ASSET_TOOL_NAMES[number];
export type MemberMcpContext = { memberId: string };

type AssetWorkspaceZipToolBaseInput = {
  name: string;
  slug: string;
  description?: string;
  workspace_relative_path: string;
  idempotency_key: string;
};

export type AssetWorkspaceZipToolInput =
  | AssetWorkspaceZipToolBaseInput & {
    kind: "plugin";
    version?: null;
  }
  | AssetWorkspaceZipToolBaseInput & {
    kind: "skill";
    version: string;
  };

const EMBODIMENT_TOOL_DESCRIPTIONS: Record<EmbodimentToolName, string> = {
  "embodiment.terminal.list":
    "List active Company terminals and their connection status. Use a returned terminal_id explicitly when starting an Embodiment Call.",
  "embodiment.call.start": "Start an Embodiment Call with a Company terminal.",
  "embodiment.call.exchange": "Speak to the active Embodiment Call and return the terminal response.",
  "embodiment.call.end": "End the active Embodiment Call.",
};

const embodimentToolInputSchemas: Record<
  EmbodimentToolName,
  z.ZodType<Record<string, unknown>>
> = {
  "embodiment.terminal.list": z.strictObject({}),
  "embodiment.call.start": callStartInputSchema,
  "embodiment.call.exchange": callExchangeInputSchema,
  "embodiment.call.end": callEndInputSchema,
};

export type CompanyRuntimeMcpGateway = {
  resolveMemberContext(memberId: string): Promise<MemberMcpContext>;
  authorizeAssetTool(
    memberId: string,
    threadId: string | null,
    toolName: AssetToolName,
  ): Promise<void>;
  listTerminals(memberId: string): Promise<TerminalListToolResult>;
  callStart(memberId: string, input: CallStartInput): Promise<CallStartToolResult>;
  callExchange(memberId: string, input: CallExchangeInput): Promise<CallExchangeToolResult>;
  callEnd(memberId: string, input: CallEndInput): Promise<CallEndToolResult>;
  resolveRoomContext(
    memberId: string,
    threadId: string,
  ): Promise<{
    memberId: string;
    roomId: string;
    threadId: string;
    accessMode: "agent_execution" | "human_side_chat";
  }>;
  readRoomMessages(
    memberId: string,
    roomId: string,
    accessMode: "agent_execution" | "human_side_chat",
    selector: CompanyRuntimeRoomMessagesReadInput["resource"],
  ): Promise<CompanyRuntimeRoomMessagesReadResult>;
  search(memberId: string, input: GlobalSearchInput): Promise<CompanyRuntimeSearchQueryResult>;
  fileList(memberId: string, input: CompanyFileListInput): Promise<unknown>;
  fileRead(memberId: string, input: CompanyFileReadInput): Promise<unknown>;
  filePublishWorkspace(memberId: string, input: CompanyFilePublishWorkspaceInput): Promise<unknown>;
  assetList(memberId: string, input: AssetListInput): Promise<unknown>;
  assetRead(memberId: string, input: AssetReadInput): Promise<unknown>;
  assetContentRead(memberId: string, input: AssetContentReadInput): Promise<unknown>;
  assetImportGit(memberId: string, input: AssetDraftImportGitInput): Promise<unknown>;
  assetImportWorkspaceZip(
    memberId: string,
    input: AssetWorkspaceZipToolInput & { thread_id: string },
  ): Promise<unknown>;
  assetCreateMcp(memberId: string, input: AssetDraftCreateMcpInput): Promise<unknown>;
  assetUpdateDraft(memberId: string, input: AssetDraftUpdateInput): Promise<unknown>;
  assetValidateDraft(memberId: string, input: AssetDraftRevisionInput): Promise<unknown>;
  assetDeleteDraft(memberId: string, input: AssetDraftRevisionInput): Promise<unknown>;
  assetPublish(memberId: string, input: AssetDraftRevisionInput): Promise<unknown>;
  assetArchive(memberId: string, input: AssetArchiveInput): Promise<unknown>;
  assetRestore(memberId: string, input: AssetArchiveInput): Promise<unknown>;
  assetReplaceCredential(memberId: string, input: AssetMcpCredentialReplaceInput): Promise<unknown>;
  memberAssetCurrent(memberId: string): Promise<unknown>;
  memberAssetOptions(
    memberId: string,
    input: { kind?: "plugin" | "skill" | "mcp"; search_term?: string },
  ): Promise<unknown>;
  memberAssetApply(memberId: string, input: SelfMemberAssetApplyInput): Promise<unknown>;
};

export type CompanyFilePublishWorkspaceInput = {
  workspace_relative_path: string;
  file_id?: string;
  expected_revision?: number;
  folder_id: string | null;
  name?: string;
  idempotency_key: string;
};

export type CompanyFileReadInput = {
  file_id: string;
  version_id?: string;
};

const companyFileReadInputSchema = z.strictObject({
  file_id: z.string().trim().min(1).max(128),
  version_id: z.string().trim().min(1).max(128).optional(),
});

const companyFilePublishWorkspaceInputSchema = z.strictObject({
  workspace_relative_path: z.string().trim().min(1).max(2_048),
  file_id: z.string().trim().min(1).max(128).optional(),
  expected_revision: z.number().int().positive().optional(),
  folder_id: z.string().trim().min(1).max(128).nullable().default(null),
  name: z.string().trim().min(1).max(255).optional(),
  idempotency_key: z.string().trim().min(1).max(200),
}).refine(
  (input) => (input.file_id === undefined) === (input.expected_revision === undefined),
  { message: "file_id and expected_revision must be supplied together." },
);

export type CompanyRuntimeMailMcpGateway = {
  authenticateMember(
    bearerToken: string,
    claimedMemberId: string,
  ): Promise<MemberMcpContext>;
  mailListMailboxes(memberId: string): Promise<unknown>;
  mailListMessages(memberId: string, input: MailMessageListInput): Promise<unknown>;
  mailSearchMessages(memberId: string, input: MailMessageSearchInput): Promise<unknown>;
  mailReadMessage(memberId: string, input: MailMessageReadInput): Promise<unknown>;
  mailSendMessage(memberId: string, input: MailMcpSendInput): Promise<unknown>;
  mailUpdateMessage(memberId: string, input: MailMcpUpdateInput): Promise<unknown>;
  mailSaveAttachment(memberId: string, input: MailMcpSaveAttachmentInput): Promise<unknown>;
};

export class EmbodimentMcpServer {
  constructor(
    private readonly memberContext: MemberMcpContext,
    private readonly gateway: CompanyRuntimeMcpGateway,
  ) {}

  listTools(): Array<{ name: EmbodimentToolName; description: string }> {
    return EMBODIMENT_TOOL_NAMES.map((name) => ({
      name,
      description: EMBODIMENT_TOOL_DESCRIPTIONS[name],
    }));
  }

  async callTool(
    name: EmbodimentToolName,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; data: unknown }> {
    return { ok: true, data: await this.runTool(name, args) };
  }

  toSdkServer(): McpServer {
    const sdk = mcpServer("Fields Embodiment");
    for (const name of EMBODIMENT_TOOL_NAMES) {
      sdk.registerTool(name, {
        description: EMBODIMENT_TOOL_DESCRIPTIONS[name],
        inputSchema: embodimentToolInputSchemas[name],
      }, async (args) => toolResult(() => this.runTool(name, args ?? {})));
    }
    return sdk;
  }

  private async runTool(
    name: EmbodimentToolName,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const parsed = embodimentToolInputSchemas[name].parse(args);
    if (name === "embodiment.terminal.list") {
      return this.gateway.listTerminals(this.memberContext.memberId);
    }
    if (name === "embodiment.call.start") {
      return this.gateway.callStart(
        this.memberContext.memberId,
        parsed as CallStartInput,
      );
    }
    if (name === "embodiment.call.exchange") {
      return this.gateway.callExchange(
        this.memberContext.memberId,
        parsed as CallExchangeInput,
      );
    }
    return this.gateway.callEnd(
      this.memberContext.memberId,
      parsed as CallEndInput,
    );
  }
}

export async function handleEmbodimentMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: CompanyRuntimeMcpGateway,
): Promise<void> {
  const context = await gateway.resolveMemberContext(
    requiredHeader(request.headers["x-fields-member-id"], "X-Fields-Member-Id"),
  );
  await handleSdkMcpRequest(
    request,
    reply,
    new EmbodimentMcpServer(context, gateway).toSdkServer(),
  );
}

export async function handleSearchMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: CompanyRuntimeMcpGateway,
): Promise<void> {
  const context = await gateway.resolveMemberContext(
    requiredHeader(request.headers["x-fields-member-id"], "X-Fields-Member-Id"),
  );
  const sdk = mcpServer("Fields Search and Company Files");
  sdk.registerTool("search.query", {
    description: "Search the current Member's authorized Fields content. Company File hits contain metadata; call company.files.read to access file contents.",
    inputSchema: globalSearchInputSchema,
  }, async (input) => toolResult(() => gateway.search(context.memberId, input)));
  sdk.registerTool("company.files.list", {
    description: "List or search Company Files visible to every Company Member, including current version metadata. Call company.files.read to access file contents.",
    inputSchema: companyFileListInputSchema,
  }, async (input) => toolResult(() => gateway.fileList(context.memberId, input)));
  sdk.registerTool("company.files.read", {
    description: "Materialize an exact Company File version into this Member's verified read-only runtime cache and return its local path. Omit version_id to read the current version at call time.",
    inputSchema: companyFileReadInputSchema,
  }, async (input) => toolResult(() => gateway.fileRead(context.memberId, input)));
  sdk.registerTool("company.files.publish", {
    description: "Publish a regular file from the current Member Home Workspace as a new Company File or a new version. This tool cannot rename, move, or delete Company Files.",
    inputSchema: companyFilePublishWorkspaceInputSchema,
  }, async (input) => toolResult(() => gateway.filePublishWorkspace(context.memberId, input)));
  await handleSdkMcpRequest(request, reply, sdk);
}

const assetWorkspaceZipToolInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plugin"),
    name: assetNameSchema,
    slug: assetSlugSchema,
    version: z.null().optional(),
    description: z.string().max(4_000).optional(),
    workspace_relative_path: z.string().min(1).max(2_048),
    idempotency_key: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("skill"),
    name: assetNameSchema,
    slug: assetSlugSchema,
    version: assetVersionSchema,
    description: z.string().max(4_000).optional(),
    workspace_relative_path: z.string().min(1).max(2_048),
    idempotency_key: z.string().min(1).max(200),
  }),
]);

export async function handleAssetsMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: CompanyRuntimeMcpGateway,
): Promise<void> {
  const memberId = requiredHeader(
    request.headers["x-fields-member-id"],
    "X-Fields-Member-Id",
  );
  await gateway.resolveMemberContext(memberId);
  const sdk = mcpServer("Fields Assets");
  const call = (
    toolName: AssetToolName,
    meta: Record<string, unknown> | undefined,
    run: () => Promise<unknown>,
  ) => assetToolResult(async () => {
    await gateway.authorizeAssetTool(memberId, optionalTrustedThreadId(meta), toolName);
    return run();
  });
  sdk.registerTool("assets.list", {
    description: "List Company assets and drafts visible to the current Member.",
    inputSchema: assetListInputSchema,
  }, async (input, extra) => call(
    "assets.list",
    extra._meta,
    () => gateway.assetList(memberId, input),
  ));
  sdk.registerTool("assets.read", {
    description: "Read one Company asset, its drafts, versions, and safe capability snapshot.",
    inputSchema: assetReadInputSchema,
  }, async (input, extra) => call(
    "assets.read",
    extra._meta,
    () => gateway.assetRead(memberId, input),
  ));
  sdk.registerTool("assets.content.read", {
    description: "Read a safe text preview from one Company asset draft or version.",
    inputSchema: assetContentReadInputSchema,
  }, async (input, extra) => call(
    "assets.content.read",
    extra._meta,
    () => gateway.assetContentRead(memberId, input),
  ));
  sdk.registerTool("assets.draft.import_git", {
    description: "Import a public HTTPS Git repository into a recoverable Company asset draft.",
    inputSchema: assetDraftImportGitInputSchema,
  }, async (input, extra) => call(
    "assets.draft.import_git",
    extra._meta,
    () => gateway.assetImportGit(memberId, input),
  ));
  sdk.registerTool("assets.draft.import_workspace_zip", {
    description: "Import a ZIP by relative path from the current trusted Thread workspace.",
    inputSchema: assetWorkspaceZipToolInputSchema,
  }, async (input, extra) => call("assets.draft.import_workspace_zip", extra._meta, () => {
    const threadId = trustedThreadId(extra._meta);
    return gateway.assetImportWorkspaceZip(memberId, {
      ...input,
      thread_id: threadId,
    });
  }));
  sdk.registerTool("assets.draft.create_mcp", {
    description: "Create an HTTPS Streamable HTTP MCP asset draft.",
    inputSchema: assetDraftCreateMcpInputSchema,
  }, async (input, extra) => call(
    "assets.draft.create_mcp",
    extra._meta,
    () => gateway.assetCreateMcp(memberId, input),
  ));
  sdk.registerTool("assets.draft.update", {
    description: "Update a recoverable Company asset draft at its expected revision.",
    inputSchema: assetDraftUpdateInputSchema,
  }, async (input, extra) => call(
    "assets.draft.update",
    extra._meta,
    () => gateway.assetUpdateDraft(memberId, input),
  ));
  sdk.registerTool("assets.draft.validate", {
    description: "Validate a Company asset draft at its expected revision.",
    inputSchema: assetDraftRevisionInputSchema,
  }, async (input, extra) => call(
    "assets.draft.validate",
    extra._meta,
    () => gateway.assetValidateDraft(memberId, input),
  ));
  sdk.registerTool("assets.draft.delete", {
    description: "Delete a recoverable Company asset draft at its expected revision.",
    inputSchema: assetDraftRevisionInputSchema,
  }, async (input, extra) => call(
    "assets.draft.delete",
    extra._meta,
    () => gateway.assetDeleteDraft(memberId, input),
  ));
  sdk.registerTool("assets.publish", {
    description: "Publish a valid Company asset draft as an immutable version.",
    inputSchema: assetDraftRevisionInputSchema,
  }, async (input, extra) => call(
    "assets.publish",
    extra._meta,
    () => gateway.assetPublish(memberId, input),
  ));
  sdk.registerTool("assets.archive", {
    description: "Archive a published Company asset.",
    inputSchema: assetArchiveInputSchema,
  }, async (input, extra) => call(
    "assets.archive",
    extra._meta,
    () => gateway.assetArchive(memberId, input),
  ));
  sdk.registerTool("assets.restore", {
    description: "Restore an archived Company asset.",
    inputSchema: assetArchiveInputSchema,
  }, async (input, extra) => call(
    "assets.restore",
    extra._meta,
    () => gateway.assetRestore(memberId, input),
  ));
  sdk.registerTool("assets.mcp.credential.replace", {
    description: "Replace or remove the Bearer credential of an MCP asset.",
    inputSchema: assetMcpCredentialReplaceInputSchema,
  }, async (input, extra) => call(
    "assets.mcp.credential.replace",
    extra._meta,
    () => gateway.assetReplaceCredential(memberId, input),
  ));
  sdk.registerTool("assets.installations.read", {
    description: "Read the current Agent's installed Company asset versions and operation state.",
    inputSchema: z.strictObject({}),
  }, async (_input, extra) => call(
    "assets.installations.read",
    extra._meta,
    () => gateway.memberAssetCurrent(memberId),
  ));
  sdk.registerTool("assets.installations.options", {
    description: "List published Company asset versions that the current Agent can install.",
    inputSchema: z.strictObject({
      kind: assetKindSchema.optional(),
      search_term: z.string().trim().max(200).optional(),
    }),
  }, async (input, extra) => call(
    "assets.installations.options",
    extra._meta,
    () => gateway.memberAssetOptions(memberId, input),
  ));
  sdk.registerTool("assets.installations.apply", {
    description: "Replace the current Agent's installed asset set after this Turn completes.",
    inputSchema: selfMemberAssetApplyInputSchema,
  }, async (input, extra) => call(
    "assets.installations.apply",
    extra._meta,
    () => gateway.memberAssetApply(memberId, input),
  ));
  await handleSdkMcpRequest(request, reply, sdk);
}

export async function handleMailMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: CompanyRuntimeMailMcpGateway,
): Promise<void> {
  const memberId = requiredHeader(
    request.headers["x-fields-member-id"],
    "X-Fields-Member-Id",
  );
  const context = await gateway.authenticateMember(
    requiredBearerToken(request.headers.authorization),
    memberId,
  );
  const sdk = mcpServer("Fields Mail");
  sdk.registerTool("mail_list_mailboxes", {
    description: "List mailboxes and their discoverable folders for the current Member.",
    inputSchema: z.strictObject({}),
  }, async () => mailToolResult(() => gateway.mailListMailboxes(context.memberId)));
  sdk.registerTool("mail_list_messages", {
    description: "List messages in one available mailbox folder.",
    inputSchema: mailMessageListInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailListMessages(context.memberId, input)));
  sdk.registerTool("mail_search_messages", {
    description: "Search messages across available mailboxes.",
    inputSchema: mailMessageSearchInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailSearchMessages(context.memberId, input)));
  sdk.registerTool("mail_read_message", {
    description: "Read one message from an available mailbox.",
    inputSchema: mailMessageReadInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailReadMessage(context.memberId, input)));
  sdk.registerTool("mail_send_message", {
    description: "Send mail from an available mailbox.",
    inputSchema: mailMcpSendInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailSendMessage(context.memberId, input)));
  sdk.registerTool("mail_update_message", {
    description: "Mark, move, or trash one message in an available mailbox.",
    inputSchema: mailMcpUpdateInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailUpdateMessage(context.memberId, input)));
  sdk.registerTool("mail_save_attachment", {
    description: "Save one mail attachment into the current Member workspace.",
    inputSchema: mailMcpSaveAttachmentInputSchema,
  }, async (input) => mailToolResult(() => gateway.mailSaveAttachment(context.memberId, input)));
  await handleSdkMcpRequest(request, reply, sdk);
}

export async function handleRoomMessagesMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: CompanyRuntimeMcpGateway,
): Promise<void> {
  const context = await gateway.resolveMemberContext(
    requiredHeader(request.headers["x-fields-member-id"], "X-Fields-Member-Id"),
  );
  const sdk = mcpServer("Fields Room Messages");
  sdk.registerTool("room.messages.read", {
    description: "Read the Room conversation associated with the current Codex Thread.",
    inputSchema: roomMessagesToolInputBoundarySchema,
  }, async (selector, extra) => roomMessagesToolResult(
    context.memberId,
    selector,
    extra,
    gateway,
  ));
  await handleSdkMcpRequest(request, reply, sdk);
}

async function toolResult(run: () => Promise<unknown>) {
  try {
    const data = await run();
    const payload = { ok: true, data };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  } catch (error) {
    if (!(error instanceof CallMcpError)) throw error;
    const payload = {
      ok: false,
      error: { code: error.code, message: error.message },
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
}

export async function mailToolResult(run: () => Promise<unknown>) {
  try {
    const data = await run();
    const payload = { ok: true, data };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  } catch (error) {
    const safe = safeMailToolError(error);
    const payload = { ok: false, error: safe };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
}

async function roomMessagesToolResult(
  memberId: string,
  rawSelector: unknown,
  extra: { _meta?: Record<string, unknown> },
  gateway: CompanyRuntimeMcpGateway,
) {
  const startedAt = Date.now();
  try {
    const selector = companyRuntimeRoomMessagesResourceSchema.parse(rawSelector);
    const threadId = threadIdFromToolMetadata(extra._meta);
    const context = await gateway.resolveRoomContext(memberId, threadId);
    const result = await gateway.readRoomMessages(
      context.memberId,
      context.roomId,
      context.accessMode,
      selector,
    );
    recordRoomMessagesToolCall({
      result: "succeeded",
      durationMs: Date.now() - startedAt,
    });
    return {
      content: [{ type: "text" as const, text: result.text }],
      structuredContent: result,
    };
  } catch (error) {
    const safe = safeRoomToolError(error);
    recordRoomMessagesToolCall({
      result: "failed",
      code: safe.code,
      durationMs: Date.now() - startedAt,
    });
    const payload = { error: { code: safe.code, message: safe.message } };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
}

async function assetToolResult(run: () => Promise<unknown>) {
  try {
    const data = await run();
    const payload = { ok: true, data };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  } catch (error) {
    const payload = {
      ok: false,
      error: {
        code: error instanceof CallMcpError ? error.code : "asset_operation_failed",
        message: error instanceof CallMcpError
          ? error.message
          : "The Company asset operation could not be completed.",
      },
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
}

function mcpServer(name: string): McpServer {
  return new McpServer(
    { name, version: "0.1.3" },
    { instructions: `${name} exposes only its named Fields capability.` },
  );
}

async function handleSdkMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  server: McpServer,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
  await transport.handleRequest(request.raw, reply.raw, request.body);
}

function requiredHeader(
  value: string | string[] | undefined,
  name: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes(",")) {
    throw new CallMcpError(
      "mcp_identity_invalid",
      `${name} must contain exactly one identifier.`,
    );
  }
  return value.trim();
}

function requiredBearerToken(value: string | string[] | undefined): string {
  if (typeof value !== "string") {
    throw new CallMcpError("mail_mcp_identity_invalid", "Mail MCP bearer token is required.");
  }
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/u.exec(value);
  if (!match) {
    throw new CallMcpError("mail_mcp_identity_invalid", "Mail MCP bearer token is invalid.");
  }
  return match[1]!;
}

function threadIdFromToolMetadata(metadata: Record<string, unknown> | undefined): string {
  const threadId = metadata?.threadId;
  if (typeof threadId !== "string" || threadId.trim().length === 0) {
    throw new CallMcpError(
      "mcp_room_context_unavailable",
      "Room context is unavailable for this Codex Thread.",
    );
  }
  return threadId.trim();
}

function trustedThreadId(meta: Record<string, unknown> | undefined): string {
  const value = meta?.threadId;
  if (typeof value !== "string" || value.trim().length === 0 || value.includes(",")) {
    throw new CallMcpError(
      "mcp_thread_identity_invalid",
      "Workspace ZIP import requires the trusted current Codex Thread metadata.",
    );
  }
  return value.trim();
}

function optionalTrustedThreadId(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.threadId;
  return typeof value === "string" && value.trim().length > 0 && !value.includes(",")
    ? value.trim()
    : null;
}

function safeRoomToolError(error: unknown): { code: string; message: string } {
  if (error instanceof CallMcpError && [
    "mcp_room_context_unavailable",
    "mcp_room_context_ambiguous",
    "mcp_room_messages_invalid_argument",
    "mcp_room_messages_backend_failed",
  ].includes(error.code)) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "mcp_room_messages_invalid_argument",
      message: "Room message selector is invalid.",
    };
  }
  return {
    code: "mcp_room_messages_backend_failed",
    message: "Room messages could not be read.",
  };
}

const SAFE_MAIL_TOOL_ERROR_CODES = new Set([
  "mail_access_denied",
  "mail_mcp_identity_invalid",
  "mcp_identity_invalid",
  "MAILBOX_CONNECTION_RECOVERY_PENDING",
  "MAILBOX_IDEMPOTENCY_CONFLICT",
  "MAILBOX_INVALID",
  "MAILBOX_NOT_CONNECTED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_OPERATION_IN_PROGRESS",
  "MAIL_ACCESS_DENIED",
  "MAIL_ATTACHMENT_DESTINATION_EXISTS",
  "MAIL_ATTACHMENT_ID_INVALID",
  "MAIL_ATTACHMENT_NOT_REGULAR",
  "MAIL_ATTACHMENT_PATH_INVALID",
  "MAIL_ATTACHMENT_TOO_LARGE",
  "MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED",
  "MAIL_ATTACHMENT_WORKSPACE_UNAVAILABLE",
  "MAIL_CONNECTION_CONFIGURATION_INVALID",
  "MAIL_CONNECTION_FAILED",
  "MAIL_CONNECTION_ROLLBACK_INVALID",
  "MAIL_CONNECTION_SSRF_BLOCKED",
  "MAIL_CREDENTIAL_INVALID",
  "MAIL_CREDENTIAL_VERSION_CONFLICT",
  "MAIL_CURSOR_INVALID",
  "MAIL_FOLDER_ID_INVALID",
  "MAIL_FOLDER_NOT_OPEN",
  "MAIL_INBOX_UNAVAILABLE",
  "MAIL_MESSAGE_BODY_TOO_LARGE",
  "MAIL_MESSAGE_ID_INVALID",
  "MAIL_MESSAGE_NOT_FOUND",
  "MAIL_MOVE_UNSUPPORTED",
  "MAIL_OPERATION_IDEMPOTENCY_CONFLICT",
  "MAIL_OPERATION_OUTCOME_UNKNOWN",
  "MAIL_RECEIPT_KEY_INVALID",
  "MAIL_SEND_IDEMPOTENCY_CONFLICT",
  "MAIL_SEND_IN_PROGRESS",
  "MAIL_SENT_APPEND_FAILED",
  "MAIL_SENT_COPY_FAILED",
  "MAIL_SENT_FOLDER_UNAVAILABLE",
  "MAIL_TRASH_UNAVAILABLE",
  "MAIL_UIDVALIDITY_CHANGED",
]);

function safeMailToolError(error: unknown): { code: string; message: string } {
  const code = mailToolErrorCode(error);
  if (code) {
    return {
      code,
      message: "The mail operation could not be completed.",
    };
  }
  return {
    code: "mail_operation_failed",
    message: "The mail operation could not be completed.",
  };
}

function mailToolErrorCode(error: unknown): string | null {
  if (error instanceof MailServiceError || error instanceof CallMcpError) {
    return SAFE_MAIL_TOOL_ERROR_CODES.has(error.code) ? error.code : null;
  }
  if (typeof error !== "object" || error === null) return null;
  const code = "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.message
      : null;
  return code && SAFE_MAIL_TOOL_ERROR_CODES.has(code) ? code : null;
}
