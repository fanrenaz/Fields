/** Infrastructure-only repository entry point. */
export { PostgresNotificationApplication } from "./notification-repository.js";
export {
  PostgresDesktopBrowserRepository,
} from "./company/desktop-browser-repository.js";
export {
  PostgresRegistrationApplication,
  REGISTRATION_ACCESS_DENIED_CODE,
  REGISTRATION_CONFLICT_CODE,
  REGISTRATION_INVALID_CODE,
  REGISTRATION_UNAVAILABLE_CODE,
  newRegistrationCode,
  type RegistrationSettingsView,
} from "./company/registration-repository.js";
export {
  MAIL_ACCESS_DENIED_CODE,
  MAILBOX_IDEMPOTENCY_CONFLICT_CODE,
  MAILBOX_INVALID_CODE,
  MAILBOX_NOT_FOUND_CODE,
  PostgresMailApplication,
  PostgresMailMemberCleanupProjection,
} from "./company/mail-repository.js";
export {
  COMPANY_FILE_FOLDER_INVALID_CODE,
  COMPANY_FILE_IDEMPOTENCY_CONFLICT_CODE,
  COMPANY_FILE_NOT_FOUND_CODE,
  COMPANY_FILE_OBJECT_INVALID_CODE,
  COMPANY_FILE_REVISION_CONFLICT_CODE,
  COMPANY_FILE_SHARE_INVALID_CODE,
  PostgresCompanyFileApplication,
} from "./company/company-file-repository.js";
export {
  AGENT_BUILDER_REVISION_CONFLICT_CODE,
  AGENT_NOT_READY_FOR_ROOM_CODE,
  AGENT_BUILDER_TARGET_INVALID_CODE,
  AGENT_BUILDER_TOPIC_NOT_FOUND_CODE,
  PostgresAgentBuilderApplication,
} from "./company/agent-builder-repository.js";
export {
  MEMBER_MEMORY_REVISION_CONFLICT_CODE,
  MEMBER_MEMORY_TARGET_INVALID_CODE,
  PostgresMemberMemoryApplication,
} from "./company/member-memory-repository.js";
export {
  ASSET_BUILDER_TARGET_INVALID_CODE,
  ASSET_BUILDER_TOPIC_NOT_FOUND_CODE,
  PostgresAssetBuilderApplication,
} from "./company/asset-builder-repository.js";
export {
  PostgresRoomSideChatApplication,
  ROOM_SIDE_CHAT_ACCESS_DENIED_CODE,
  ROOM_SIDE_CHAT_THREAD_CONFLICT_CODE,
} from "./company/room-side-chat-repository.js";
export {
  ACTOR_PERSISTENCE_CONFLICT_CODE,
  ACTOR_PERSISTENCE_UNAVAILABLE_CODE,
  PostgresActorRepository,
  type PostgresActorTransactionResolver,
} from "./actor-repository.js";
export {
  PostgresCompanyFileActorSummaryQuery,
  PostgresActorDirectoryRepository,
  PostgresHumanActorEmailQuery,
  type PostgresActorDirectoryTransactionResolver,
} from "./actor-directory-repository.js";
export { PostgresActorInvitationHumanQuery } from "./actor-invitation-human-query.js";
export { PostgresCompanyInvitationQuery } from "./company-invitation-query.js";
export {
  COMPANY_PERSISTENCE_CONFLICT_CODE,
  COMPANY_PERSISTENCE_UNAVAILABLE_CODE,
  PostgresCompanyRepository,
  type PostgresOwnerTransactionResolver,
} from "./company-repository.js";
export {
  COMPANY_RUNTIME_ACCESS_DENIED_CODE,
  COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  fixedCompanyRuntimeOptionsFromEnv,
  COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE,
  PostgresCompanyRuntimeRepository,
  type ReadyCompanyRuntime,
} from "./execution/company-runtime-repository.js";
export {
  COMPANY_RUNTIME_STATUS_ACCESS_DENIED_CODE,
  COMPANY_RUNTIME_STATUS_INVALID_CODE,
  COMPANY_RUNTIME_STATUS_UNAVAILABLE_CODE,
  PostgresCompanyRuntimeStatusRepository,
  type CompanyRuntimeStatus,
} from "./execution/company-runtime-status-repository.js";
export {
  MEMBER_EXECUTOR_ACCESS_DENIED_CODE,
  MEMBER_EXECUTOR_INVALID_CODE,
  MEMBER_EXECUTOR_NOT_FOUND_CODE,
  MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE,
  MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE,
  MemberExecutorAssignmentService,
  PostgresMemberExecutorAssignmentRepository,
  type ExecutorAssignmentAuthority,
  type MemberExecutorAssignment,
  type MemberExecutorRuntimeSwitchGateway,
  type MemberExecutorSummary,
} from "./execution/member-executor-assignment-repository.js";
export { PostgresPersonalExecutorRepository } from "./execution/personal-executor-repository.js";
export {
  PostgresRoomRepository,
  ROOM_ACCESS_DENIED_CODE,
  ROOM_OWNER_ACCESS_DENIED_CODE,
  ROOM_PERSISTENCE_CONFLICT_CODE,
  ROOM_PERSISTENCE_UNAVAILABLE_CODE,
  type PostgresRoomTransactionResolver,
} from "./room-repository.js";
export {
  AGENT_ROOM_EXECUTION_INVALID_CODE,
  AGENT_ROOM_STATE_INVALID_CODE,
  ROOM_MESSAGE_ACCESS_DENIED_CODE,
  ROOM_MESSAGE_INVALID_CODE,
  ROOM_MESSAGE_NOT_FOUND_CODE,
  ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE,
  PostgresRoomMessageRepository,
  agentRoomTriggerPolicies,
  type AgentRoomExecution,
  type AgentRoomState,
  type AgentRoomTriggerPolicy,
  type PersistedRoomMessage,
  type SendRoomMessageInput,
  type SendRoomMessageResult,
} from "./room/room-message-repository.js";
export {
  PostgresScheduledTaskApplication,
  SCHEDULED_TASK_ACCESS_DENIED_CODE,
  SCHEDULED_TASK_CONFLICT_CODE,
  SCHEDULED_TASK_INVALID_CODE,
  SCHEDULED_TASK_NOT_FOUND_CODE,
  SCHEDULED_TASK_TARGET_INVALID_CODE,
  insertRunAndEvent,
  taskFromRow,
} from "./company/scheduled-task-repository.js";
