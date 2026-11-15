import { relations } from "drizzle-orm";

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
import { companies, companyOnboardingProcesses } from "./company.js";
import { companyRuntimeStatuses } from "./runtime/execution-company-runtime.js";
import { eventInbox, outboxDeliveries, outboxEvents } from "./eventing.js";
import {
  companyExecutors,
  executorAuthAttempts,
  memberExecutorAssignments,
} from "./runtime/member-executor.js";
import {
  agentRoomCascades,
  agentRoomExecutionMessages,
  agentRoomExecutions,
  agentRoomStates,
  roomMessages,
} from "./messaging/room-messaging.js";
import { roomMemberships, rooms } from "./room.js";

export const companiesRelations = relations(companies, ({ one, many }) => ({
  authOrganization: one(organization, {
    fields: [companies.authOrganizationId],
    references: [organization.id],
  }),
  onboardingProcess: one(companyOnboardingProcesses),
  actors: many(actors),
  runtimeStatus: one(companyRuntimeStatuses),
  executors: many(companyExecutors),
  memberExecutorAssignments: many(memberExecutorAssignments),
  executorAuthAttempts: many(executorAuthAttempts),
  rooms: many(rooms),
  roomMemberships: many(roomMemberships),
  roomMessages: many(roomMessages),
  agentRoomStates: many(agentRoomStates),
  agentRoomCascades: many(agentRoomCascades),
  agentRoomExecutions: many(agentRoomExecutions),
}));

export const companyOnboardingProcessesRelations = relations(companyOnboardingProcesses, ({ one }) => ({
  company: one(companies, {
    fields: [companyOnboardingProcesses.companyId],
    references: [companies.id],
  }),
}));

export const actorsRelations = relations(actors, ({ one, many }) => ({
  company: one(companies, {
    fields: [actors.companyId],
    references: [companies.id],
  }),
  authUser: one(user, {
    fields: [actors.authUserId],
    references: [user.id],
  }),
  createdRooms: many(rooms),
  roomMemberships: many(roomMemberships),
  ownedExecutors: many(companyExecutors),
  executorAssignment: one(memberExecutorAssignments),
  sentRoomMessages: many(roomMessages),
  agentRoomStates: many(agentRoomStates),
  agentRoomExecutions: many(agentRoomExecutions),
}));

export const companyRuntimeStatusesRelations = relations(companyRuntimeStatuses, ({ one }) => ({
  company: one(companies, {
    fields: [companyRuntimeStatuses.companyId],
    references: [companies.id],
  }),
}));

export const companyExecutorsRelations = relations(companyExecutors, ({ one, many }) => ({
  company: one(companies, {
    fields: [companyExecutors.companyId],
    references: [companies.id],
  }),
  ownerMember: one(actors, {
    fields: [companyExecutors.ownerMemberId],
    references: [actors.id],
  }),
  assignments: many(memberExecutorAssignments),
  authAttempts: many(executorAuthAttempts),
}));

export const memberExecutorAssignmentsRelations = relations(memberExecutorAssignments, ({ one }) => ({
  company: one(companies, {
    fields: [memberExecutorAssignments.companyId],
    references: [companies.id],
  }),
  member: one(actors, {
    fields: [memberExecutorAssignments.memberId],
    references: [actors.id],
  }),
  executor: one(companyExecutors, {
    fields: [memberExecutorAssignments.executorId],
    references: [companyExecutors.executorId],
  }),
}));

export const executorAuthAttemptsRelations = relations(executorAuthAttempts, ({ one }) => ({
  company: one(companies, {
    fields: [executorAuthAttempts.companyId],
    references: [companies.id],
  }),
  executor: one(companyExecutors, {
    fields: [executorAuthAttempts.executorId],
    references: [companyExecutors.executorId],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  actors: many(actors),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  companies: many(companies),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const verificationRelations = relations(verification, () => ({}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  company: one(companies, {
    fields: [rooms.companyId],
    references: [companies.id],
  }),
  createdByActor: one(actors, {
    fields: [rooms.createdByActorId],
    references: [actors.id],
  }),
  memberships: many(roomMemberships),
  messages: many(roomMessages),
  agentStates: many(agentRoomStates),
  cascades: many(agentRoomCascades),
  executions: many(agentRoomExecutions),
}));

export const roomMembershipsRelations = relations(roomMemberships, ({ one }) => ({
  company: one(companies, {
    fields: [roomMemberships.companyId],
    references: [companies.id],
  }),
  room: one(rooms, {
    fields: [roomMemberships.roomId],
    references: [rooms.id],
  }),
  actor: one(actors, {
    fields: [roomMemberships.actorId],
    references: [actors.id],
  }),
}));

export const roomMessagesRelations = relations(roomMessages, ({ one, many }) => ({
  room: one(rooms, {
    fields: [roomMessages.roomId],
    references: [rooms.id],
  }),
  senderMember: one(actors, {
    fields: [roomMessages.senderMemberId],
    references: [actors.id],
  }),
  sourceCascade: one(agentRoomCascades, {
    fields: [roomMessages.sourceCascadeId],
    references: [agentRoomCascades.cascadeId],
  }),
  sourceExecution: one(agentRoomExecutions, {
    fields: [roomMessages.sourceExecutionId],
    references: [agentRoomExecutions.executionId],
  }),
  executionInputs: many(agentRoomExecutionMessages),
}));

export const agentRoomStatesRelations = relations(agentRoomStates, ({ one }) => ({
  room: one(rooms, {
    fields: [agentRoomStates.roomId],
    references: [rooms.id],
  }),
  agentMember: one(actors, {
    fields: [agentRoomStates.agentMemberId],
    references: [actors.id],
  }),
}));

export const agentRoomCascadesRelations = relations(agentRoomCascades, ({ one, many }) => ({
  room: one(rooms, {
    fields: [agentRoomCascades.roomId],
    references: [rooms.id],
  }),
  sourceMessage: one(roomMessages, {
    fields: [agentRoomCascades.sourceMessageId],
    references: [roomMessages.messageId],
  }),
  executions: many(agentRoomExecutions),
  messages: many(roomMessages),
}));

export const agentRoomExecutionsRelations = relations(agentRoomExecutions, ({ one, many }) => ({
  room: one(rooms, {
    fields: [agentRoomExecutions.roomId],
    references: [rooms.id],
  }),
  agentMember: one(actors, {
    fields: [agentRoomExecutions.agentMemberId],
    references: [actors.id],
  }),
  cascade: one(agentRoomCascades, {
    fields: [agentRoomExecutions.cascadeId],
    references: [agentRoomCascades.cascadeId],
  }),
  sourceMessage: one(roomMessages, {
    fields: [agentRoomExecutions.sourceMessageId],
    references: [roomMessages.messageId],
  }),
  inputs: many(agentRoomExecutionMessages),
  publishedMessages: many(roomMessages),
}));

export const agentRoomExecutionMessagesRelations = relations(agentRoomExecutionMessages, ({ one }) => ({
  execution: one(agentRoomExecutions, {
    fields: [agentRoomExecutionMessages.executionId],
    references: [agentRoomExecutions.executionId],
  }),
  message: one(roomMessages, {
    fields: [agentRoomExecutionMessages.messageId],
    references: [roomMessages.messageId],
  }),
}));

export const outboxEventsRelations = relations(outboxEvents, ({ many }) => ({
  deliveries: many(outboxDeliveries),
  inboxReceipts: many(eventInbox),
}));

export const outboxDeliveriesRelations = relations(outboxDeliveries, ({ one }) => ({
  event: one(outboxEvents, {
    fields: [outboxDeliveries.eventId],
    references: [outboxEvents.eventId],
  }),
}));

export const eventInboxRelations = relations(eventInbox, ({ one }) => ({
  event: one(outboxEvents, {
    fields: [eventInbox.eventId],
    references: [outboxEvents.eventId],
  }),
}));
