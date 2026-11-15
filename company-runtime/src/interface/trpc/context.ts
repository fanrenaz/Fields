import type { AgentRoomExecutionCoordinator } from "../../application/agent-room/coordinator.js";
import type { CompanyExecutorService } from "../../application/company-executor/service.js";
import type { CompanyRuntimeLifecycle } from "../../application/company-runtime/lifecycle.js";
import type { HomeCodexFilesystem } from "../../application/filesystem/codex-fs.js";
import type { MemberRuntimeManager } from "../../application/member-runtime/manager.js";
import type { CompanyAssetStore } from "../../application/assets/service.js";
import type { MemberAssetService } from "../../application/member-assets/service.js";
import type { CompanyMailService } from "../../application/mail/service.js";
import type { CompanyProxyService } from "../../application/company-proxy/service.js";
import type { MemberMemoryCapabilityService } from "../../application/member-memory/capability.js";

export type CompanyRuntimeTrpcDependencies = {
  codexFilesystemFactory?: (socketPath: string) => HomeCodexFilesystem;
};

export type CompanyRuntimeTrpcContext = {
  workdir: string;
  runtime: MemberRuntimeManager;
  lifecycle: CompanyRuntimeLifecycle;
  companyExecutor: CompanyExecutorService;
  companyProxy: CompanyProxyService;
  assetStore: CompanyAssetStore;
  memberAssets: MemberAssetService;
  memberMemory: MemberMemoryCapabilityService;
  mail: CompanyMailService;
  agentExecutions: AgentRoomExecutionCoordinator;
  authorization: string | undefined;
  traceparent?: string;
  controlTokenFile: string;
  dependencies: CompanyRuntimeTrpcDependencies;
};
