import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { actors } from "./actor.js";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
} from "./better-auth.js";
import { companies, companyDevices, companyOnboardingProcesses } from "./company.js";
import { companyRuntimeStatuses } from "./runtime/execution-company-runtime.js";
import { eventInbox, outboxDeliveries, outboxEvents } from "./eventing.js";
import {
  companyExecutors,
  executorAuthAttempts,
  memberExecutorAssignments,
} from "./runtime/member-executor.js";
import {
  agentRoomCascades,
  agentRoomActivityReceipts,
  agentRoomActivitySnapshots,
  agentRoomExecutionMessages,
  agentRoomExecutions,
  agentRoomStates,
  roomInteractionResponses,
  roomInteractions,
  roomMessages,
} from "./messaging/room-messaging.js";
import { roomMemberships, rooms } from "./room.js";
import {
  companyAssetDrafts,
  companyAssetMutationReceipts,
  companyAssets,
  companyAssetVersionCredentials,
  companyAssetVersions,
  memberAssetInstallations,
  memberAssetOperations,
  memberAssetProfiles,
} from "./company/asset.js";
import {
  companyFileBlobs,
  companyFileFolders,
  companyFileMutationReceipts,
  companyFileShares,
  companyFiles,
  companyFileUploads,
  companyFileVersions,
} from "./company/file.js";
import {
  companyMailboxAuditEvents,
  companyMailboxGrants,
  companyMailboxMutationReceipts,
  companyMailboxes,
} from "./company/mail.js";
import { agentBuilderProfiles, agentBuilderTopics } from "./company/agent-builder.js";
import { assetBuilderTopics } from "./company/asset-builder.js";
import { roomSideChats } from "./company/room-side-chat.js";
import { memberMemoryProfiles } from "./company/member-memory.js";
import { companyRegistrationSettings, registrationSignupGrants } from "./company/registration.js";
import { scheduledTaskMutationReceipts, scheduledTaskRuns, scheduledTasks } from "./scheduling/scheduled-task.js";
import { notificationActivities, notificationPushDeliveries, notificationPushSubscriptions, notificationReadCursors } from "./notification.js";

export * from "./actor.js";
export * from "./company/asset.js";
export * from "./company/file.js";
export * from "./company/mail.js";
export * from "./company/agent-builder.js";
export * from "./company/asset-builder.js";
export * from "./company/room-side-chat.js";
export * from "./company/member-memory.js";
export * from "./company/registration.js";
export * from "./better-auth.js";
export * from "./company.js";
export * from "./runtime/execution-company-runtime.js";
export * from "./eventing.js";
export * from "./runtime/member-executor.js";
export * from "./relations.js";
export * from "./messaging/room-messaging.js";
export * from "./room.js";
export * from "./scheduling/scheduled-task.js";
export * from "./notification.js";

export type Company = InferSelectModel<typeof companies>;
export type NewCompany = InferInsertModel<typeof companies>;
export type CompanyOnboardingProcess = InferSelectModel<typeof companyOnboardingProcesses>;
export type NewCompanyOnboardingProcess = InferInsertModel<typeof companyOnboardingProcesses>;
export type CompanyDevice = InferSelectModel<typeof companyDevices>;
export type NewCompanyDevice = InferInsertModel<typeof companyDevices>;
export type CompanyRuntimeStatus = InferSelectModel<typeof companyRuntimeStatuses>;
export type NewCompanyRuntimeStatus = InferInsertModel<typeof companyRuntimeStatuses>;
export type CompanyExecutor = InferSelectModel<typeof companyExecutors>;
export type NewCompanyExecutor = InferInsertModel<typeof companyExecutors>;
export type MemberExecutorAssignment = InferSelectModel<typeof memberExecutorAssignments>;
export type NewMemberExecutorAssignment = InferInsertModel<typeof memberExecutorAssignments>;
export type ExecutorAuthAttempt = InferSelectModel<typeof executorAuthAttempts>;
export type NewExecutorAuthAttempt = InferInsertModel<typeof executorAuthAttempts>;
export type AuthUser = InferSelectModel<typeof user>;
export type NewAuthUser = InferInsertModel<typeof user>;
export type AuthSession = InferSelectModel<typeof session>;
export type NewAuthSession = InferInsertModel<typeof session>;
export type AuthAccount = InferSelectModel<typeof account>;
export type NewAuthAccount = InferInsertModel<typeof account>;
export type AuthVerification = InferSelectModel<typeof verification>;
export type NewAuthVerification = InferInsertModel<typeof verification>;
export type AuthOrganization = InferSelectModel<typeof organization>;
export type NewAuthOrganization = InferInsertModel<typeof organization>;
export type AuthMember = InferSelectModel<typeof member>;
export type NewAuthMember = InferInsertModel<typeof member>;
export type AuthInvitation = InferSelectModel<typeof invitation>;
export type NewAuthInvitation = InferInsertModel<typeof invitation>;
export type CompanyRegistrationSettingsRow = InferSelectModel<typeof companyRegistrationSettings>;
export type RegistrationSignupGrantRow = InferSelectModel<typeof registrationSignupGrants>;
export type Actor = InferSelectModel<typeof actors>;
export type NewActor = InferInsertModel<typeof actors>;
export type Room = InferSelectModel<typeof rooms>;
export type NewRoom = InferInsertModel<typeof rooms>;
export type RoomMembership = InferSelectModel<typeof roomMemberships>;
export type NewRoomMembership = InferInsertModel<typeof roomMemberships>;
export type RoomMessage = InferSelectModel<typeof roomMessages>;
export type NewRoomMessage = InferInsertModel<typeof roomMessages>;
export type AgentRoomState = InferSelectModel<typeof agentRoomStates>;
export type NewAgentRoomState = InferInsertModel<typeof agentRoomStates>;
export type AgentRoomCascade = InferSelectModel<typeof agentRoomCascades>;
export type NewAgentRoomCascade = InferInsertModel<typeof agentRoomCascades>;
export type AgentRoomExecution = InferSelectModel<typeof agentRoomExecutions>;
export type NewAgentRoomExecution = InferInsertModel<typeof agentRoomExecutions>;
export type AgentRoomExecutionMessage = InferSelectModel<typeof agentRoomExecutionMessages>;
export type NewAgentRoomExecutionMessage = InferInsertModel<typeof agentRoomExecutionMessages>;
export type AgentRoomActivityReceipt = InferSelectModel<typeof agentRoomActivityReceipts>;
export type NewAgentRoomActivityReceipt = InferInsertModel<typeof agentRoomActivityReceipts>;
export type AgentRoomActivitySnapshot = InferSelectModel<typeof agentRoomActivitySnapshots>;
export type NewAgentRoomActivitySnapshot = InferInsertModel<typeof agentRoomActivitySnapshots>;
export type RoomInteraction = InferSelectModel<typeof roomInteractions>;
export type NewRoomInteraction = InferInsertModel<typeof roomInteractions>;
export type RoomInteractionResponse = InferSelectModel<typeof roomInteractionResponses>;
export type NewRoomInteractionResponse = InferInsertModel<typeof roomInteractionResponses>;
export type OutboxEvent = InferSelectModel<typeof outboxEvents>;
export type NewOutboxEvent = InferInsertModel<typeof outboxEvents>;
export type OutboxDelivery = InferSelectModel<typeof outboxDeliveries>;
export type NewOutboxDelivery = InferInsertModel<typeof outboxDeliveries>;
export type EventInboxReceipt = InferSelectModel<typeof eventInbox>;
export type NewEventInboxReceipt = InferInsertModel<typeof eventInbox>;
export type CompanyAsset = InferSelectModel<typeof companyAssets>;
export type NewCompanyAsset = InferInsertModel<typeof companyAssets>;
export type CompanyAssetDraft = InferSelectModel<typeof companyAssetDrafts>;
export type NewCompanyAssetDraft = InferInsertModel<typeof companyAssetDrafts>;
export type CompanyAssetVersion = InferSelectModel<typeof companyAssetVersions>;
export type NewCompanyAssetVersion = InferInsertModel<typeof companyAssetVersions>;
export type CompanyAssetVersionCredential =
  InferSelectModel<typeof companyAssetVersionCredentials>;
export type NewCompanyAssetVersionCredential =
  InferInsertModel<typeof companyAssetVersionCredentials>;
export type CompanyAssetMutationReceipt = InferSelectModel<typeof companyAssetMutationReceipts>;
export type NewCompanyAssetMutationReceipt = InferInsertModel<typeof companyAssetMutationReceipts>;
export type CompanyFileFolderRow = InferSelectModel<typeof companyFileFolders>;
export type CompanyFileBlobRow = InferSelectModel<typeof companyFileBlobs>;
export type CompanyFileRow = InferSelectModel<typeof companyFiles>;
export type CompanyFileVersionRow = InferSelectModel<typeof companyFileVersions>;
export type CompanyFileUploadRow = InferSelectModel<typeof companyFileUploads>;
export type CompanyFileShareRow = InferSelectModel<typeof companyFileShares>;
export type CompanyFileMutationReceiptRow = InferSelectModel<typeof companyFileMutationReceipts>;
export type MemberAssetProfileRow = InferSelectModel<typeof memberAssetProfiles>;
export type NewMemberAssetProfileRow = InferInsertModel<typeof memberAssetProfiles>;
export type MemberAssetInstallationRow = InferSelectModel<typeof memberAssetInstallations>;
export type NewMemberAssetInstallationRow = InferInsertModel<typeof memberAssetInstallations>;
export type MemberAssetOperationRow = InferSelectModel<typeof memberAssetOperations>;
export type NewMemberAssetOperationRow = InferInsertModel<typeof memberAssetOperations>;
export type CompanyMailboxRow = InferSelectModel<typeof companyMailboxes>;
export type NewCompanyMailboxRow = InferInsertModel<typeof companyMailboxes>;
export type CompanyMailboxGrantRow = InferSelectModel<typeof companyMailboxGrants>;
export type NewCompanyMailboxGrantRow = InferInsertModel<typeof companyMailboxGrants>;
export type CompanyMailboxMutationReceiptRow =
  InferSelectModel<typeof companyMailboxMutationReceipts>;
export type CompanyMailboxAuditEventRow = InferSelectModel<typeof companyMailboxAuditEvents>;
export type AgentBuilderProfileRow = InferSelectModel<typeof agentBuilderProfiles>;
export type AgentBuilderTopicRow = InferSelectModel<typeof agentBuilderTopics>;
export type AssetBuilderTopicRow = InferSelectModel<typeof assetBuilderTopics>;
export type RoomSideChatRow = InferSelectModel<typeof roomSideChats>;
export type MemberMemoryProfileRow = InferSelectModel<typeof memberMemoryProfiles>;
export type ScheduledTaskRow = InferSelectModel<typeof scheduledTasks>;
export type NewScheduledTaskRow = InferInsertModel<typeof scheduledTasks>;
export type ScheduledTaskRunRow = InferSelectModel<typeof scheduledTaskRuns>;
export type NewScheduledTaskRunRow = InferInsertModel<typeof scheduledTaskRuns>;
export type NotificationActivityRow = InferSelectModel<typeof notificationActivities>;
export type NotificationReadCursorRow = InferSelectModel<typeof notificationReadCursors>;
export type NotificationPushSubscriptionRow = InferSelectModel<typeof notificationPushSubscriptions>;
export type NotificationPushDeliveryRow = InferSelectModel<typeof notificationPushDeliveries>;
export type ScheduledTaskMutationReceiptRow = InferSelectModel<typeof scheduledTaskMutationReceipts>;
