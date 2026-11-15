import {
  desktopBrowserSetInputSchema,
  desktopBrowserStatusSchema,
  desktopBrowserTunnelStartInputSchema,
  desktopBrowserTunnelStartResultSchema,
} from "@fields/contracts/public/desktop-browser";
import {
  agentRoomExecutionSummarySchema,
  roomAgentActivityWatchInputSchema,
  roomAgentExecutionGetInputSchema,
  roomAgentTriggerPolicyInputSchema,
  roomAgentTriggerPolicyResultSchema,
  roomAgentTriggerPolicySetInputSchema,
} from "@fields/contracts/public/agent-room";
import {
  companyActorCreateInputSchema,
  companyActorCreateResultSchema,
  companyActorGetInputSchema,
  companyActorRemoveInputSchema,
  companyActorRemoveResultSchema,
  companyActorSchema,
  companyActorsListInputSchema,
  companyActorsListResultSchema,
  companyRegistrationSetEnabledInputSchema,
  companyRegistrationSettingsSchema,
  companyOnboardingRetryResultSchema,
  companyOnboardingStatusSchema,
  companyInvitationsListInputSchema,
  companyInvitationsListResultSchema,
  companyRuntimeStatusInputSchema,
  companyRuntimeStatusResultSchema,
  sessionMeSchema,
  registrationClaimResultSchema,
  registrationPrepareInputSchema,
  registrationPrepareResultSchema,
} from "@fields/contracts/public/company";
import {
  companyFileDeleteResultSchema,
  companyFileDownloadInputSchema,
  companyFileDownloadResultSchema,
  companyFileFolderCreateInputSchema,
  companyFileFolderDeleteResultSchema,
  companyFileFolderMutationInputSchema,
  companyFileFolderSchema,
  companyFileListInputSchema,
  companyFileListResultSchema,
  companyFileMutationInputSchema,
  companyFileSchema,
  companyFileShareCreateInputSchema,
  companyFileShareListInputSchema,
  companyFileShareListResultSchema,
  companyFileShareResolveInputSchema,
  companyFileShareResolveResultSchema,
  companyFileShareRevokeInputSchema,
  companyFileShareRevokeResultSchema,
  companyFileShareSchema,
  companyFileUploadBeginInputSchema,
  companyFileUploadFinalizeInputSchema,
  companyFileUploadReservationSchema,
} from "@fields/contracts/public/company-file";
import {
  companyExecutorSafeListResultSchema,
  companyProxyDisableInputSchema,
  companyProxySetInputSchema,
  companyProxyStatusSchema,
  companyExecutorSharingGovernanceInputSchema,
  companyExecutorSharingGovernanceResultSchema,
  companyMemberExecutorInputSchema,
  companyMemberExecutorSetInputSchema,
  executorDeleteResultSchema,
  executorDeviceAuthorizationCancelResultSchema,
  executorDeviceAuthorizationStartResultSchema,
  executorDeviceAuthorizationStatusInputSchema,
  executorDeviceAuthorizationStatusResultSchema,
  executorCustomApiConfigureInputSchema,
  executorModelCatalogInputSchema,
  executorModelCatalogResultSchema,
  executorModelPolicyResultSchema,
  executorModelPolicyUpdateInputSchema,
  executorModelValidationInputSchema,
  executorModelValidationResultSchema,
  memberExecutorAssignmentSchema,
  memberExecutorCurrentInputSchema,
  memberExecutorOptionsResultSchema,
  memberExecutorSetInputSchema,
  personalExecutorCreateInputSchema,
  personalExecutorMutationInputSchema,
  personalExecutorMutationResultSchema,
  personalExecutorRenameInputSchema,
  personalExecutorsListResultSchema,
  personalExecutorUsageResultSchema,
} from "@fields/contracts/public/executor";
import {
  globalSearchInputSchema,
  globalSearchResultSchema,
  roomMessageContextInputSchema,
} from "@fields/contracts/public/search";
import {
  mailAttachmentReadInputSchema,
  mailAttachmentReadResultSchema,
  mailFolderListInputSchema,
  mailFolderListResultSchema,
  mailMailboxDisconnectResultSchema,
  mailMailboxListResultSchema,
  mailMailboxMutationResultSchema,
  mailMailboxReadInputSchema,
  mailMessageListInputSchema,
  mailMessagePageSchema,
  mailMessageReadInputSchema,
  mailMessageSchema,
  mailMessageSearchInputSchema,
  mailMessageUpdateInputSchema,
  mailMessageUpdateResultSchema,
  mailPersonalConnectInputSchema,
  mailSendInputSchema,
  mailSendResultSchema,
  mailSharedConnectInputSchema,
  mailSharedGrantListInputSchema,
  mailSharedGrantListResultSchema,
  mailSharedGrantMutationResultSchema,
  mailSharedGrantSetInputSchema,
  mailSharedMailboxDeleteResultSchema,
  mailboxSchema,
} from "@fields/contracts/public/mail";
import {
  homeFilesystemCreateInputSchema,
  homeFilesystemDeleteInputSchema,
  homeFilesystemDeleteResultSchema,
  homeFilesystemEntrySchema,
  homeFilesystemEventStreamSchema,
  homeFilesystemEventsInputSchema,
  homeFilesystemListInputSchema,
  homeFilesystemListResultSchema,
  homeFilesystemRenameInputSchema,
  homeModelOptionsInputSchema,
  homeModelOptionsResultSchema,
  homeMemoryInputSchema,
  homeMemoryProfileSchema,
  homeMemoryUpdateInputSchema,
  homeProjectCreateInputSchema,
  homeProjectDeleteInputSchema,
  homeProjectDeleteResultSchema,
  homeProjectListInputSchema,
  homeProjectListResultSchema,
  homeProjectSchema,
  homeProjectThreadMoveInputSchema,
  homeProjectThreadMoveResultSchema,
  homeProjectUpdateInputSchema,
  homeThreadListInputSchema,
  homeThreadListResultSchema,
  homeThreadDeleteInputSchema,
  homeThreadDeleteResultSchema,
  homeThreadForkInputSchema,
  homeThreadForkResultSchema,
  homeThreadReadInputSchema,
  homeThreadReadResultSchema,
  homeThreadSelectInputSchema,
  homeThreadSelectResultSchema,
  homeThreadSearchInputSchema,
  homeThreadSearchResultSchema,
  homeThreadSettingsInputSchema,
  homeThreadSettingsResultSchema,
  homeThreadSettingsSetInputSchema,
  homeTurnEventStreamSchema,
  homeTurnEventsInputSchema,
  homeTurnSubmitInputSchema,
  homeTurnSubmitResultSchema,
  homeQuestionInteractionRespondInputSchema,
  homeQuestionInteractionRespondResultSchema,
  homeQuestionInteractionSnoozeInputSchema,
  homeQuestionInteractionSnoozeResultSchema,
  homeConversationImportReadInputSchema,
  homeConversationImportSchema,
} from "@fields/contracts/public/home";
import { desktopNotificationEventsInputSchema, desktopNotificationEventStreamSchema, type DesktopNotificationEvent } from "@fields/contracts/public/desktop-notification";
import type { HomeAgentTurnEvent } from "@fields/contracts/public/agent-activity";
import {
  roomAgentTurnEventStreamSchema,
} from "@fields/contracts/public/agent-activity";
import {
  roomCreateInputSchema,
  roomCreateResultSchema,
  roomInteractionRespondInputSchema,
  roomInteractionRespondResultSchema,
  roomInteractionSnoozeInputSchema,
  roomInteractionSnoozeResultSchema,
  roomListInputSchema,
  roomListResultSchema,
  roomMembersAddInputSchema,
  roomMembersAddResultSchema,
  roomMembersListInputSchema,
  roomMembersListResultSchema,
  roomMembersRemoveInputSchema,
  roomMembersRemoveResultSchema,
  roomMessageEventStreamSchema,
  roomMessageEditInputSchema,
  roomMessageMutationResultSchema,
  roomMessageSendInputSchema,
  roomMessageSendResultSchema,
  roomMessageSoftDeleteInputSchema,
  roomAgentReplyRegenerateInputSchema,
  roomAgentReplyRegenerateResultSchema,
  roomAgentReplySelectionResultSchema,
  roomAgentReplySelectionSetInputSchema,
  roomMessagesEventsInputSchema,
  roomMessagesListInputSchema,
  roomMessagesListResultSchema,
  roomThreadReadInputSchema,
  roomThreadReadResultSchema,
  type RoomMessageImageAttachment,
  type RoomTimelineMessage,
} from "@fields/contracts/public/room";
import {
  referencesWithRoomImageAttachments,
} from "../../../application/room/message-image-attachments.js";
import { TRPCError } from "@trpc/server";
import {
  assetArchiveInputSchema,
  assetContentReadInputSchema,
  assetContentSchema,
  assetDetailSchema,
  assetDraftBeginZipInputSchema,
  assetDraftCreateMcpInputSchema,
  assetDraftDeleteResultSchema,
  assetDraftImportGitInputSchema,
  assetDraftMutationResultSchema,
  assetDraftRevisionInputSchema,
  assetDraftUpdateInputSchema,
  assetListInputSchema,
  assetListResultSchema,
  assetMcpCredentialReplaceInputSchema,
  assetMcpToolCallInputSchema,
  assetMcpToolCallResultSchema,
  assetMcpToolsListInputSchema,
  assetMcpToolsListResultSchema,
  assetMutationResultSchema,
  assetPublishResultSchema,
  assetReadInputSchema,
  memberAssetApplyInputSchema,
  memberAssetCurrentInputSchema,
  memberAssetOperationInputSchema,
  memberAssetOperationSchema,
  memberAssetOptionsInputSchema,
  memberAssetOptionsResultSchema,
  memberAssetProfileSchema,
} from "@fields/contracts/public/asset";
import {
  agentBuilderProfileInputSchema,
  agentBuilderProfileSchema,
  agentBuilderProfileUpdateInputSchema,
  agentBuilderTopicCreateInputSchema,
  agentBuilderTopicListInputSchema,
  agentBuilderTopicListResultSchema,
  agentBuilderTopicReadInputSchema,
  agentBuilderTopicReadResultSchema,
  agentBuilderTopicSchema,
  agentBuilderTurnSubmitInputSchema,
  agentBuilderTurnSubmitResultSchema,
} from "@fields/contracts/public/agent-builder";
import {
  assetBuilderTopicCreateInputSchema,
  assetBuilderTopicListInputSchema,
  assetBuilderTopicListResultSchema,
  assetBuilderTopicReadInputSchema,
  assetBuilderTopicReadResultSchema,
  assetBuilderTopicSchema,
  assetBuilderTurnSubmitInputSchema,
  assetBuilderTurnSubmitResultSchema,
} from "@fields/contracts/public/asset-builder";
import {
  roomSideChatReadInputSchema,
  roomSideChatReadResultSchema,
  roomSideChatTurnEventStreamSchema,
  roomSideChatTurnEventsInputSchema,
  roomSideChatTurnSubmitInputSchema,
  roomSideChatTurnSubmitResultSchema,
} from "@fields/contracts/public/room-side-chat";

import {
  MEMBER_EXECUTOR_NOT_FOUND_CODE,
  type MemberExecutorAssignment,
  type MemberExecutorSummary,
} from "../../../application/execution/ports/index.js";
import { ApplicationError } from "../../../application/platform/errors.js";
import { markdownToPlainText } from "../../../application/room/markdown-to-plain-text.js";
import type { PersistedRoomMessage } from "../../../application/room/ports/index.js";
import { runGlobalSearch } from "../../../application/search/global-search.js";
import {
  publicError,
  requireCompanySession,
  requireProductSession,
  t,
  type BackendTrpcContext,
} from "../core.js";
import {
  notificationInboxListInputSchema, notificationInboxListResultSchema,
  notificationMarkReadInputSchema, notificationMarkReadResultSchema,
  pushSubscriptionDeleteInputSchema, pushSubscriptionDeleteResultSchema,
  pushSubscriptionListResultSchema, pushSubscriptionSchema,
  pushSubscriptionUpsertInputSchema, webPushPublicKeyResultSchema,
} from "@fields/contracts/public/notification";

export function createPublicTrpcRouterRecord() {
  return {
    notifications: t.router({
      events: t.procedure.input(desktopNotificationEventsInputSchema).output(desktopNotificationEventStreamSchema).subscription(({ ctx, signal }) => {
        const session = requireProductSession(ctx);
        return mergeDesktopNotificationStreams([ctx.roomMessages.watchDesktopNotifications({ companyId: session.company_id, requestedByMemberId: session.actor_id, signal }), homeDesktopNotifications(ctx.runtime.watchAllHomeTurnEvents(session.company_id, session.actor_id, signal))]);
      }),
      inbox: t.router({
        list: t.procedure.input(notificationInboxListInputSchema).output(notificationInboxListResultSchema).query(({ ctx, input }) => { const session = requireProductSession(ctx); return ctx.notifications.list(session.company_id, session.actor_id, input); }),
        markRead: t.procedure.input(notificationMarkReadInputSchema).output(notificationMarkReadResultSchema).mutation(({ ctx, input }) => { const session = requireProductSession(ctx); return ctx.notifications.markRead(session.company_id, session.actor_id, input.target, input.through); }),
      }),
      push: t.router({
        publicKey: t.procedure.output(webPushPublicKeyResultSchema).query(({ ctx }) => { requireProductSession(ctx); return ctx.notifications.publicKey(); }),
        subscriptions: t.router({
          list: t.procedure.output(pushSubscriptionListResultSchema).query(({ ctx }) => { const session = requireProductSession(ctx); return ctx.notifications.listSubscriptions(session.company_id, session.actor_id); }),
          upsert: t.procedure.input(pushSubscriptionUpsertInputSchema).output(pushSubscriptionSchema).mutation(({ ctx, input }) => { const session = requireProductSession(ctx); return ctx.notifications.upsertSubscription(session.company_id, session.actor_id, input); }),
          delete: t.procedure.input(pushSubscriptionDeleteInputSchema).output(pushSubscriptionDeleteResultSchema).mutation(({ ctx, input }) => { const session = requireProductSession(ctx); return ctx.notifications.deleteSubscription(session.company_id, session.actor_id, input.subscription_id); }),
        }),
      }),
    }),
    desktop: t.router({
      notifications: t.router({
        events: t.procedure.input(desktopNotificationEventsInputSchema).output(desktopNotificationEventStreamSchema).subscription(({ ctx, signal }) => {
          const session = requireProductSession(ctx);
          return mergeDesktopNotificationStreams([
            ctx.roomMessages.watchDesktopNotifications({ companyId: session.company_id, requestedByMemberId: session.actor_id, signal }),
            homeDesktopNotifications(ctx.runtime.watchAllHomeTurnEvents(session.company_id, session.actor_id, signal)),
          ]);
        }),
      }),
    }),
    mail: t.router({
      mailboxes: t.router({
        list: t.procedure
          .output(mailMailboxListResultSchema)
          .query(({ ctx }) => ctx.mail.listMailboxes(mailAuthority(ctx))),
        read: t.procedure
          .input(mailMailboxReadInputSchema)
          .output(mailboxSchema)
          .query(({ ctx, input }) => ctx.mail.readMailbox(mailAuthority(ctx), input.mailbox_id)),
        connectPersonal: t.procedure
          .input(mailPersonalConnectInputSchema)
          .output(mailMailboxMutationResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.connectPersonal(
            mailAuthority(ctx),
            input.target_actor_id,
            input.configuration,
            input.idempotency_key,
          )),
        connectShared: t.procedure
          .input(mailSharedConnectInputSchema)
          .output(mailMailboxMutationResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.connectShared(mailAuthority(ctx), {
            mailboxId: input.mailbox_id,
            name: input.name,
            configuration: input.configuration,
            idempotencyKey: input.idempotency_key,
          })),
        disconnect: t.procedure
          .input(mailMailboxReadInputSchema)
          .output(mailMailboxDisconnectResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.disconnect(mailAuthority(ctx), input.mailbox_id)),
        deleteShared: t.procedure
          .input(mailMailboxReadInputSchema)
          .output(mailSharedMailboxDeleteResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.deleteShared(mailAuthority(ctx), input.mailbox_id)),
      }),
      folders: t.router({
        list: t.procedure
          .input(mailFolderListInputSchema)
          .output(mailFolderListResultSchema)
          .query(({ ctx, input }) => ctx.mail.listFolders(mailAuthority(ctx), input.mailbox_id)),
      }),
      messages: t.router({
        list: t.procedure
          .input(mailMessageListInputSchema)
          .output(mailMessagePageSchema)
          .query(({ ctx, input }) => ctx.mail.listMessages(mailAuthority(ctx), input)),
        search: t.procedure
          .input(mailMessageSearchInputSchema)
          .output(mailMessagePageSchema)
          .query(({ ctx, input }) => ctx.mail.searchMessages(mailAuthority(ctx), input)),
        read: t.procedure
          .input(mailMessageReadInputSchema)
          .output(mailMessageSchema)
          .query(({ ctx, input }) => ctx.mail.readMessage(mailAuthority(ctx), input)),
        send: t.procedure
          .input(mailSendInputSchema)
          .output(mailSendResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.sendMessage(mailAuthority(ctx), input)),
        update: t.procedure
          .input(mailMessageUpdateInputSchema)
          .output(mailMessageUpdateResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.updateMessage(mailAuthority(ctx), input)),
      }),
      attachments: t.router({
        read: t.procedure
          .input(mailAttachmentReadInputSchema)
          .output(mailAttachmentReadResultSchema)
          .query(({ ctx, input }) => ctx.mail.readAttachment(mailAuthority(ctx), input)),
      }),
      shared: t.router({
        grants: t.router({
          list: t.procedure
            .input(mailSharedGrantListInputSchema)
            .output(mailSharedGrantListResultSchema)
            .query(({ ctx, input }) => ctx.mail.listGrants(mailAuthority(ctx), input.mailbox_id)),
          grant: t.procedure
            .input(mailSharedGrantSetInputSchema)
            .output(mailSharedGrantMutationResultSchema)
            .mutation(({ ctx, input }) => ctx.mail.grant(
              mailAuthority(ctx),
              input.mailbox_id,
              input.actor_id,
            )),
          revoke: t.procedure
            .input(mailSharedGrantSetInputSchema)
            .output(mailSharedGrantMutationResultSchema)
            .mutation(({ ctx, input }) => ctx.mail.revoke(
              mailAuthority(ctx),
              input.mailbox_id,
              input.actor_id,
            )),
        }),
      }),
    }),
    assets: t.router({
      list: t.procedure
        .input(assetListInputSchema)
        .output(assetListResultSchema)
        .query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assets.list(session.company_id, session.actor_id, input);
        }),
      read: t.procedure
        .input(assetReadInputSchema)
        .output(assetDetailSchema)
        .query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assets.read(session.company_id, session.actor_id, input.asset_id);
        }),
      content: t.router({
        read: t.procedure
          .input(assetContentReadInputSchema)
          .output(assetContentSchema)
          .query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.assets.contentRead(session.company_id, session.actor_id, input);
          }),
      }),
      draft: t.router({
        beginZip: t.procedure
          .input(assetDraftBeginZipInputSchema)
          .output(assetDraftMutationResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.assets.beginZip(session.company_id, session.actor_id, input);
          }),
        importGit: t.procedure
          .input(assetDraftImportGitInputSchema)
          .output(assetDraftMutationResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.assets.importGit(session.company_id, session.actor_id, input);
          }),
        createMcp: t.procedure
          .input(assetDraftCreateMcpInputSchema)
          .output(assetDraftMutationResultSchema)
          .mutation(async ({ ctx, input }) => {
            const session = requireProductSession(ctx);
            if (input.authentication === "bearer") {
              await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
                requestedByActorId: session.actor_id,
                companyId: session.company_id,
              });
            }
            return ctx.assets.createMcp(session.company_id, session.actor_id, input);
          }),
        update: t.procedure
          .input(assetDraftUpdateInputSchema)
          .output(assetDraftMutationResultSchema)
          .mutation(async ({ ctx, input }) => {
            const session = requireProductSession(ctx);
            if (input.endpoint_url !== undefined || input.authentication !== undefined) {
              await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
                requestedByActorId: session.actor_id,
                companyId: session.company_id,
              });
            }
            return ctx.assets.updateDraft(session.company_id, session.actor_id, input);
          }),
        validate: t.procedure
          .input(assetDraftRevisionInputSchema)
          .output(assetDraftMutationResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.assets.validateDraft(session.company_id, session.actor_id, input);
          }),
        delete: t.procedure
          .input(assetDraftRevisionInputSchema)
          .output(assetDraftDeleteResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.assets.deleteDraft(session.company_id, session.actor_id, input);
          }),
      }),
      publish: t.procedure
        .input(assetDraftRevisionInputSchema)
        .output(assetPublishResultSchema)
        .mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assets.publish(session.company_id, session.actor_id, input);
        }),
      archive: t.procedure
        .input(assetArchiveInputSchema)
        .output(assetMutationResultSchema)
        .mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assets.archive(session.company_id, session.actor_id, input);
        }),
      restore: t.procedure
        .input(assetArchiveInputSchema)
        .output(assetMutationResultSchema)
        .mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assets.restore(session.company_id, session.actor_id, input);
        }),
      mcp: t.router({
        credential: t.router({
          replace: t.procedure
            .input(assetMcpCredentialReplaceInputSchema)
            .output(assetMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              const session = requireProductSession(ctx);
              await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
                requestedByActorId: session.actor_id,
                companyId: session.company_id,
              });
              return ctx.assets.replaceCredential(session.company_id, session.actor_id, input);
            }),
        }),
        tools: t.router({
          list: t.procedure
            .input(assetMcpToolsListInputSchema)
            .output(assetMcpToolsListResultSchema)
            .query(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.assets.listMcpTools(session.company_id, session.actor_id, input);
            }),
          invoke: t.procedure
            .input(assetMcpToolCallInputSchema)
            .output(assetMcpToolCallResultSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.assets.callMcpTool(session.company_id, session.actor_id, input);
            }),
        }),
      }),
    }),
    search: t.router({
      query: t.procedure.input(globalSearchInputSchema).output(globalSearchResultSchema).query(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return runGlobalSearch(ctx, session.company_id, session.actor_id, input);
      }),
    }),
    session: t.router({
      me: t.procedure.output(sessionMeSchema).query(async ({ ctx }) => {
        const auth = ctx.authContext.authSession;
        if (!auth) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = ctx.authContext.productSession;
        return session
          ? {
            has_company: true as const,
            registration_pending: false as const,
            user_id: auth.user.id,
            ...session,
          }
          : {
            has_company: false as const,
            registration_pending: await ctx.registration.hasPendingGrant(auth.user.id),
            user_id: auth.user.id,
            actor_id: null,
            company_id: null,
            display_name: auth.user.name,
            actor_type: "human" as const,
            company_role: null,
            company_status: null,
          };
      }),
    }),
    registration: t.router({
      prepare: t.procedure.input(registrationPrepareInputSchema).output(registrationPrepareResultSchema).mutation(({ ctx, input }) => (
        ctx.registration.prepare(input)
      )),
      claim: t.procedure.output(registrationClaimResultSchema).mutation(({ ctx }) => {
        const auth = ctx.authContext.authSession;
        if (!auth) throw new TRPCError({ code: "UNAUTHORIZED" });
        return ctx.registration.claim(auth.user.id);
      }),
    }),
    account: t.router({
      proxy: t.router({
        get: t.procedure.output(companyProxyStatusSchema).query(async ({ ctx }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.runtime.companyProxyStatus(session.company_id);
        }),
        set: t.procedure.input(companyProxySetInputSchema).output(companyProxyStatusSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.runtime.setCompanyProxy(session.company_id, input);
        }),
        disable: t.procedure.input(companyProxyDisableInputSchema).output(companyProxyStatusSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.runtime.disableCompanyProxy(session.company_id, input);
        }),
      }),
      desktopBrowser: t.router({
        status: t.procedure.output(desktopBrowserStatusSchema).query(({ ctx }) => {
          const session = requireProductSession(ctx);
          return ctx.desktopBrowser.status(session.company_id);
        }),
        set: t.procedure.input(desktopBrowserSetInputSchema).output(desktopBrowserStatusSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.desktopBrowser.set(session.company_id, input);
        }),
        tunnel: t.router({
          start: t.procedure.input(desktopBrowserTunnelStartInputSchema).output(desktopBrowserTunnelStartResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            if (session.actor_type !== "human") throw new TRPCError({ code: "FORBIDDEN" });
            return ctx.desktopBrowser.start(session.company_id, session.actor_id, input.client_nonce);
          }),
        }),
      }),
      executors: t.router({
        list: t.procedure.output(personalExecutorsListResultSchema).query(({ ctx }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.list(session.company_id, session.actor_id);
        }),
        create: t.procedure.input(personalExecutorCreateInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.create(session.company_id, session.actor_id, input.name, input.authorization_method);
        }),
        rename: t.procedure.input(personalExecutorRenameInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.rename(session.company_id, session.actor_id, input.executor_id, input.name);
        }),
        authorization: t.router({
          start: t.procedure.input(personalExecutorMutationInputSchema).output(executorDeviceAuthorizationStartResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.authorizationStart(session.company_id, session.actor_id, input.executor_id);
          }),
          status: t.procedure.input(executorDeviceAuthorizationStatusInputSchema).output(executorDeviceAuthorizationStatusResultSchema).query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.authorizationStatus(session.company_id, session.actor_id, input.executor_id, input.attempt_id);
          }),
          cancel: t.procedure.input(executorDeviceAuthorizationStatusInputSchema).output(executorDeviceAuthorizationCancelResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.authorizationCancel(session.company_id, session.actor_id, input.executor_id, input.attempt_id);
          }),
          custom: t.router({
            configure: t.procedure.input(executorCustomApiConfigureInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.personalExecutors.configureCustomAuthorization(session.company_id, session.actor_id, input);
            }),
          }),
        }),
        models: t.router({
          catalog: t.procedure.input(executorModelCatalogInputSchema).output(executorModelCatalogResultSchema).query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.modelCatalog(session.company_id, session.actor_id, input.executor_id);
          }),
          validate: t.procedure.input(executorModelValidationInputSchema).output(executorModelValidationResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.validateModels(session.company_id, session.actor_id, input);
          }),
          policy: t.procedure.input(personalExecutorMutationInputSchema).output(executorModelPolicyResultSchema).query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.modelPolicy(session.company_id, session.actor_id, input.executor_id);
          }),
          configure: t.procedure.input(executorModelPolicyUpdateInputSchema).output(executorModelPolicyResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.personalExecutors.configureModelPolicy(session.company_id, session.actor_id, input);
          }),
        }),
        disconnect: t.procedure.input(personalExecutorMutationInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.disconnect(session.company_id, session.actor_id, input.executor_id);
        }),
        share: t.procedure.input(personalExecutorMutationInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.setSharing(session.company_id, session.actor_id, input.executor_id, true);
        }),
        unshare: t.procedure.input(personalExecutorMutationInputSchema).output(personalExecutorMutationResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.setSharing(session.company_id, session.actor_id, input.executor_id, false);
        }),
        usage: t.procedure.input(personalExecutorMutationInputSchema).output(personalExecutorUsageResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.usage(session.company_id, session.actor_id, input.executor_id);
        }),
        delete: t.procedure.input(personalExecutorMutationInputSchema).output(executorDeleteResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.delete(session.company_id, session.actor_id, input.executor_id);
        }),
      }),
    }),
    member: t.router({
      executor: memberExecutorRouter("self"),
    }),
    agentBuilder: t.router({
      profile: t.router({
        get: t.procedure.input(agentBuilderProfileInputSchema).output(agentBuilderProfileSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.agentBuilder.profile(session.company_id, session.actor_id, input.agent_member_id);
        }),
        update: t.procedure.input(agentBuilderProfileUpdateInputSchema).output(agentBuilderProfileSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.agentBuilder.updateProfile({
            companyId: session.company_id,
            humanMemberId: session.actor_id,
            agentMemberId: input.agent_member_id,
            description: input.description,
            avatar: input.avatar,
            instructions: input.instructions,
            readiness: input.readiness,
            memoryEnabled: input.memory_enabled,
            expectedRevision: input.expected_revision,
          });
        }),
      }),
      topic: t.router({
        list: t.procedure.input(agentBuilderTopicListInputSchema).output(agentBuilderTopicListResultSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return {
            items: await ctx.agentBuilder.listTopics(
              session.company_id,
              session.actor_id,
              input.agent_member_id,
            ),
          };
        }),
        create: t.procedure.input(agentBuilderTopicCreateInputSchema).output(agentBuilderTopicSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.agentBuilder.createTopic(
            session.company_id,
            session.actor_id,
            input.agent_member_id,
            input.title,
          );
        }),
        read: t.procedure.input(agentBuilderTopicReadInputSchema).output(agentBuilderTopicReadResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.agentBuilder.readTopic(
            session.company_id,
            session.actor_id,
            input.agent_member_id,
            input.topic_id,
          );
        }),
      }),
      turn: t.router({
        submit: t.procedure.input(agentBuilderTurnSubmitInputSchema).output(agentBuilderTurnSubmitResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.agentBuilder.submitTurn({
            companyId: session.company_id,
            humanMemberId: session.actor_id,
            agentMemberId: input.agent_member_id,
            topicId: input.topic_id,
            prompt: input.prompt,
            clientMessageId: input.client_message_id,
            timeoutMs: input.timeout_ms,
          });
        }),
      }),
    }),
    assetBuilder: t.router({
      topic: t.router({
        list: t.procedure.input(assetBuilderTopicListInputSchema).output(assetBuilderTopicListResultSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return {
            items: await ctx.assetBuilder.listTopics(
              session.company_id,
              session.actor_id,
              input,
            ),
          };
        }),
        create: t.procedure.input(assetBuilderTopicCreateInputSchema).output(assetBuilderTopicSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assetBuilder.createTopic(
            session.company_id,
            session.actor_id,
            input,
            input.title,
          );
        }),
        read: t.procedure.input(assetBuilderTopicReadInputSchema).output(assetBuilderTopicReadResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assetBuilder.readTopic(
            session.company_id,
            session.actor_id,
            input.topic_id,
          );
        }),
      }),
      turn: t.router({
        submit: t.procedure.input(assetBuilderTurnSubmitInputSchema).output(assetBuilderTurnSubmitResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.assetBuilder.submitTurn({
            companyId: session.company_id,
            humanMemberId: session.actor_id,
            topicId: input.topic_id,
            prompt: input.prompt,
            clientMessageId: input.client_message_id,
            timeoutMs: input.timeout_ms,
          });
        }),
      }),
    }),
    roomSideChat: t.router({
      read: t.procedure
        .input(roomSideChatReadInputSchema)
        .output(roomSideChatReadResultSchema)
        .query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.roomSideChat.read(session.company_id, session.actor_id, input.room_id);
        }),
      turn: t.router({
        submit: t.procedure
          .input(roomSideChatTurnSubmitInputSchema)
          .output(roomSideChatTurnSubmitResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.roomSideChat.submitTurn({
              companyId: session.company_id,
              humanMemberId: session.actor_id,
              roomId: input.room_id,
              prompt: input.prompt,
              clientMessageId: input.client_message_id,
              timeoutMs: input.timeout_ms,
            });
          }),
        events: t.procedure
          .input(roomSideChatTurnEventsInputSchema)
          .output(roomSideChatTurnEventStreamSchema)
          .subscription(async function* ({ ctx, input, signal }) {
            const session = requireProductSession(ctx);
            await ctx.roomSideChat.read(session.company_id, session.actor_id, input.room_id);
            for await (const event of ctx.runtime.watchRoomSideChatTurnEvents(
              session.company_id,
              session.actor_id,
              input.room_id,
              signal,
            )) {
              yield event;
            }
          }),
      }),
    }),
    company: t.router({
      registration: t.router({
        get: t.procedure.output(companyRegistrationSettingsSchema).query(async ({ ctx }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.registration.getSettings(session.company_id);
        }),
        rotate: t.procedure.output(companyRegistrationSettingsSchema).mutation(async ({ ctx }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.registration.rotate(session.company_id, session.actor_id);
        }),
        setEnabled: t.procedure.input(companyRegistrationSetEnabledInputSchema).output(companyRegistrationSettingsSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          await ctx.companyActors.requireActiveHumanCompanyOwner.execute({
            requestedByActorId: session.actor_id,
            companyId: session.company_id,
          });
          return ctx.registration.setEnabled(session.company_id, session.actor_id, input.enabled);
        }),
      }),
      onboarding: t.router({
        status: t.procedure.output(companyOnboardingStatusSchema).query(async ({ ctx }) => {
          const session = requireCompanySession(ctx);
          return onboarding(await ctx.companyActors.onboardingStatus.execute({
            companyId: session.company_id,
            isOwner: session.company_role === "owner",
          }));
        }),
        retry: t.procedure.output(companyOnboardingRetryResultSchema).mutation(async ({ ctx }) => {
          const session = requireCompanySession(ctx);
          await ctx.companyActors.retryCompanyOnboarding.execute({
            companyId: session.company_id,
            actorId: session.actor_id,
          });
          return onboarding(await ctx.companyActors.onboardingStatus.execute({
            companyId: session.company_id,
            isOwner: session.company_role === "owner",
          }));
        }),
      }),
      runtime: t.router({
        status: t.procedure.input(companyRuntimeStatusInputSchema).output(companyRuntimeStatusResultSchema).query(async ({ ctx }) => {
          const session = requireCompanySession(ctx);
          const status = await ctx.runtimeStatus.read({
            companyId: session.company_id,
            requestedByMemberId: session.actor_id,
          });
          return {
            company_id: status.companyId,
            status: status.status,
            member_app_servers: status.memberAppServers,
            active_execution_count: status.activeExecutionCount,
            last_seen_at_ms: status.lastHeartbeatAtMs,
            error: status.error,
          };
        }),
      }),
      executors: t.router({
        sharedPool: t.procedure.output(companyExecutorSafeListResultSchema).query(({ ctx }) => {
          const session = requireProductSession(ctx);
          return ctx.personalExecutors.sharedPool(session.company_id, session.actor_id);
        }),
        blockSharing: governanceRoute(true),
        unblockSharing: governanceRoute(false),
      }),
      actors: t.router({
        list: t.procedure.input(companyActorsListInputSchema).output(companyActorsListResultSchema).query(async ({ ctx }) => {
          const session = requireProductSession(ctx);
          const items = await ctx.companyActors.listCompanyDirectoryActors.execute({
            companyId: session.company_id,
            requestedByActorId: session.actor_id,
          });
          return { items: items.map(actorProjection) };
        }),
        get: t.procedure.input(companyActorGetInputSchema).output(companyActorSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return actorProjection(await ctx.companyActors.getCompanyDirectoryActor.execute({
            companyId: session.company_id,
            requestedByActorId: session.actor_id,
            actorId: input.actor_id,
          }));
        }),
        create: t.procedure.input(companyActorCreateInputSchema).output(companyActorCreateResultSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return {
            actor: actorProjection(await ctx.companyActors.createCompanyDirectoryActor.execute({
              companyId: session.company_id,
              requestedByActorId: session.actor_id,
              actorType: input.actor_type,
              displayName: input.display_name,
              mark: input.mark,
            })),
          };
        }),
        remove: t.procedure.input(companyActorRemoveInputSchema).output(companyActorRemoveResultSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          const result = await ctx.companyActors.removeOrdinaryAgent.execute({
            companyId: session.company_id,
            requestedByActorId: session.actor_id,
            actorId: input.actor_id,
          });
          return { actor_id: result.actorId, status: result.status };
        }),
      }),
      invitations: t.router({
        list: t.procedure.input(companyInvitationsListInputSchema).output(companyInvitationsListResultSchema).query(async ({ ctx }) => {
          const session = requireProductSession(ctx);
          const items = await ctx.companyActors.listCompanyInvitations.execute({
            companyId: session.company_id,
            requestedByActorId: session.actor_id,
          });
          return { items: [...items] };
        }),
      }),
      files: t.router({
        list: t.procedure
          .input(companyFileListInputSchema)
          .output(companyFileListResultSchema)
          .query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.companyFiles.list(session.company_id, input);
          }),
        folders: t.router({
          create: t.procedure
            .input(companyFileFolderCreateInputSchema)
            .output(companyFileFolderSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.createFolder(session.company_id, session.actor_id, input);
            }),
          update: t.procedure
            .input(companyFileFolderMutationInputSchema)
            .output(companyFileFolderSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.updateFolder(session.company_id, session.actor_id, input);
            }),
          delete: t.procedure
            .input(companyFileFolderMutationInputSchema)
            .output(companyFileFolderDeleteResultSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              if (session.company_role !== "owner") throw new TRPCError({ code: "FORBIDDEN" });
              return ctx.companyFiles.deleteFolder(session.company_id, session.actor_id, input);
            }),
        }),
        upload: t.router({
          begin: t.procedure
            .input(companyFileUploadBeginInputSchema)
            .output(companyFileUploadReservationSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.beginUpload(session.company_id, session.actor_id, input);
            }),
          finalize: t.procedure
            .input(companyFileUploadFinalizeInputSchema)
            .output(companyFileSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.finalizeUpload(session.company_id, session.actor_id, input);
            }),
        }),
        update: t.procedure
          .input(companyFileMutationInputSchema)
          .output(companyFileSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.companyFiles.updateFile(session.company_id, session.actor_id, input);
          }),
        delete: t.procedure
          .input(companyFileMutationInputSchema)
          .output(companyFileDeleteResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            if (session.company_role !== "owner") throw new TRPCError({ code: "FORBIDDEN" });
            return ctx.companyFiles.deleteFile(session.company_id, session.actor_id, input);
          }),
        download: t.procedure
          .input(companyFileDownloadInputSchema)
          .output(companyFileDownloadResultSchema)
          .query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.companyFiles.download(session.company_id, input);
          }),
        shares: t.router({
          create: t.procedure
            .input(companyFileShareCreateInputSchema)
            .output(companyFileShareSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.createShare(session.company_id, session.actor_id, input);
            }),
          list: t.procedure
            .input(companyFileShareListInputSchema)
            .output(companyFileShareListResultSchema)
            .query(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.listShares(session.company_id, session.actor_id, input);
            }),
          revoke: t.procedure
            .input(companyFileShareRevokeInputSchema)
            .output(companyFileShareRevokeResultSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.companyFiles.revokeShare(session.company_id, session.actor_id, input);
            }),
          resolve: t.procedure
            .input(companyFileShareResolveInputSchema)
            .output(companyFileShareResolveResultSchema)
            .query(({ ctx, input }) => ctx.companyFiles.resolveShare(input)),
        }),
      }),
      members: t.router({
        assets: t.router({
          current: t.procedure
            .input(memberAssetCurrentInputSchema)
            .output(memberAssetProfileSchema)
            .query(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.memberAssets.current(
                session.company_id,
                session.actor_id,
                input.member_id,
              );
            }),
          options: t.procedure
            .input(memberAssetOptionsInputSchema)
            .output(memberAssetOptionsResultSchema)
            .query(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.memberAssets.options(
                session.company_id,
                session.actor_id,
                input.member_id,
                input,
              );
            }),
          applyInstallation: t.procedure
            .input(memberAssetApplyInputSchema)
            .output(memberAssetProfileSchema)
            .mutation(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.memberAssets.apply({
                companyId: session.company_id,
                requestedByActorId: session.actor_id,
                memberId: input.member_id,
                expectedRevision: input.expected_revision,
                installations: input.installations,
                idempotencyKey: input.idempotency_key,
                authority: "human",
              });
            }),
          operation: t.procedure
            .input(memberAssetOperationInputSchema)
            .output(memberAssetOperationSchema)
            .query(({ ctx, input }) => {
              const session = requireProductSession(ctx);
              return ctx.memberAssets.operation(
                session.company_id,
                session.actor_id,
                input.member_id,
                input.operation_id,
              );
            }),
        }),
        executor: memberExecutorRouter("company_owner"),
      }),
    }),
    home: t.router({
      memory: t.router({
        get: t.procedure.input(homeMemoryInputSchema).output(homeMemoryProfileSchema).query(({ ctx }) => {
          const session = requireProductSession(ctx);
          return ctx.memberMemory.profile(session.company_id, session.actor_id);
        }),
        set: t.procedure.input(homeMemoryUpdateInputSchema).output(homeMemoryProfileSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.memberMemory.update({
            companyId: session.company_id,
            memberId: session.actor_id,
            enabled: input.enabled,
            expectedRevision: input.expected_revision,
          });
        }),
      }),
      model: t.router({
        options: t.procedure.input(homeModelOptionsInputSchema).output(homeModelOptionsResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeModelOptions(session.company_id, session.actor_id, input);
        }),
      }),
      project: t.router({
        list: t.procedure.input(homeProjectListInputSchema).output(homeProjectListResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeProjectList(session.company_id, session.actor_id, input);
        }),
        create: t.procedure.input(homeProjectCreateInputSchema).output(homeProjectSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeProjectCreate(session.company_id, session.actor_id, input);
        }),
        update: t.procedure.input(homeProjectUpdateInputSchema).output(homeProjectSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeProjectUpdate(session.company_id, session.actor_id, input);
        }),
        delete: t.procedure.input(homeProjectDeleteInputSchema).output(homeProjectDeleteResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeProjectDelete(session.company_id, session.actor_id, input);
        }),
        thread: t.router({
          move: t.procedure.input(homeProjectThreadMoveInputSchema).output(homeProjectThreadMoveResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.homeProjectThreadMove(session.company_id, session.actor_id, input);
          }),
        }),
      }),
      conversationImport: t.router({
        read: t.procedure
          .input(homeConversationImportReadInputSchema)
          .output(homeConversationImportSchema)
          .query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.homeConversationImportRead(session.company_id, session.actor_id, input.import_id);
          }),
      }),
      thread: t.router({
        list: t.procedure.input(homeThreadListInputSchema).output(homeThreadListResultSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          const [result, agentBuilderThreadIds, assetBuilderThreadIds, roomSideChatThreadIds] = await Promise.all([
            ctx.runtime.homeThreadList(session.company_id, session.actor_id, input),
            ctx.agentBuilder.threadIds(session.company_id, session.actor_id),
            ctx.assetBuilder.threadIds(session.company_id, session.actor_id),
            ctx.roomSideChat.threadIds(session.company_id, session.actor_id),
          ]);
          const builderThreadIds = new Set([
            ...agentBuilderThreadIds,
            ...assetBuilderThreadIds,
            ...roomSideChatThreadIds,
          ]);
          const visible = result.items.filter((item) => !builderThreadIds.has(item.thread_id));
          return { ...result, items: await Promise.all(visible.map(async (item) => { const state = await ctx.notifications.targetState(session.company_id, session.actor_id, { kind: "home", thread_id: item.thread_id }); return { ...item, unread_count: state.unreadCount, read_through: state.readThrough }; })) };
        }),
        delete: t.procedure.input(homeThreadDeleteInputSchema).output(homeThreadDeleteResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeThreadDelete(session.company_id, session.actor_id, input);
        }),
        fork: t.procedure.input(homeThreadForkInputSchema).output(homeThreadForkResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeThreadFork(session.company_id, session.actor_id, input);
        }),
        search: t.procedure.input(homeThreadSearchInputSchema).output(homeThreadSearchResultSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          const [result, agentBuilderThreadIds, assetBuilderThreadIds, roomSideChatThreadIds] = await Promise.all([
            ctx.runtime.homeThreadSearch(session.company_id, session.actor_id, input),
            ctx.agentBuilder.threadIds(session.company_id, session.actor_id),
            ctx.assetBuilder.threadIds(session.company_id, session.actor_id),
            ctx.roomSideChat.threadIds(session.company_id, session.actor_id),
          ]);
          const builderThreadIds = new Set([
            ...agentBuilderThreadIds,
            ...assetBuilderThreadIds,
            ...roomSideChatThreadIds,
          ]);
          const visible = result.items.filter((item) => !builderThreadIds.has(item.thread_id));
          return { ...result, items: await Promise.all(visible.map(async (item) => { const state = await ctx.notifications.targetState(session.company_id, session.actor_id, { kind: "home", thread_id: item.thread_id }); return { ...item, unread_count: state.unreadCount, read_through: state.readThrough }; })) };
        }),
        read: t.procedure.input(homeThreadReadInputSchema).output(homeThreadReadResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeThreadRead(session.company_id, session.actor_id, input);
        }),
        select: t.procedure.input(homeThreadSelectInputSchema).output(homeThreadSelectResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeThreadSelect(session.company_id, session.actor_id, input);
        }),
        settings: t.router({
          get: t.procedure.input(homeThreadSettingsInputSchema).output(homeThreadSettingsResultSchema).query(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.homeThreadSettings(session.company_id, session.actor_id, input);
          }),
          set: t.procedure.input(homeThreadSettingsSetInputSchema).output(homeThreadSettingsResultSchema).mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.setHomeThreadSettings(session.company_id, session.actor_id, input);
          }),
        }),
      }),
      turn: t.router({
        submit: t.procedure.input(homeTurnSubmitInputSchema).output(homeTurnSubmitResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeTurnSubmit(session.company_id, session.actor_id, input);
        }),
        events: t.procedure.input(homeTurnEventsInputSchema).output(homeTurnEventStreamSchema).subscription(({ ctx, input, signal }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.watchHomeTurnEvents(session.company_id, session.actor_id, input, signal);
        }),
        respondToQuestion: t.procedure
          .input(homeQuestionInteractionRespondInputSchema)
          .output(homeQuestionInteractionRespondResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.homeQuestionInteractionRespond(session.company_id, session.actor_id, input);
          }),
        snoozeQuestion: t.procedure
          .input(homeQuestionInteractionSnoozeInputSchema)
          .output(homeQuestionInteractionSnoozeResultSchema)
          .mutation(({ ctx, input }) => {
            const session = requireProductSession(ctx);
            return ctx.runtime.homeQuestionInteractionSnooze(session.company_id, session.actor_id, input);
          }),
      }),
      filesystem: t.router({
        list: t.procedure.input(homeFilesystemListInputSchema).output(homeFilesystemListResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeFilesystemList(session.company_id, session.actor_id, input);
        }),
        create: t.procedure.input(homeFilesystemCreateInputSchema).output(homeFilesystemEntrySchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeFilesystemCreate(session.company_id, session.actor_id, input);
        }),
        rename: t.procedure.input(homeFilesystemRenameInputSchema).output(homeFilesystemEntrySchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeFilesystemRename(session.company_id, session.actor_id, input);
        }),
        delete: t.procedure.input(homeFilesystemDeleteInputSchema).output(homeFilesystemDeleteResultSchema).mutation(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.homeFilesystemDelete(session.company_id, session.actor_id, input);
        }),
        events: t.procedure.input(homeFilesystemEventsInputSchema).output(homeFilesystemEventStreamSchema).subscription(({ ctx, input, signal }) => {
          const session = requireProductSession(ctx);
          return ctx.runtime.watchHomeFilesystemEvents(session.company_id, session.actor_id, input, signal);
        }),
      }),
    }),
  };
}

function mailAuthority(ctx: BackendTrpcContext) {
  const session = requireProductSession(ctx);
  return {
    companyId: session.company_id,
    actorId: session.actor_id,
    isCompanyOwner: session.company_role === "owner",
  };
}

export function createRoomPublicTrpcRouterRecord() {
  return {
    create: t.procedure.input(roomCreateInputSchema).output(roomCreateResultSchema).mutation(async ({ ctx, input }) => {
      const session = requireProductSession(ctx);
      const room = await ctx.rooms.createRoom.execute({
        companyId: session.company_id,
        ownerActorId: session.actor_id,
        name: input.name,
        subtitle: input.subtitle,
      });
      return roomSummary(room);
    }),
    list: t.procedure.input(roomListInputSchema).output(roomListResultSchema).query(async ({ ctx, input }) => {
      const session = requireProductSession(ctx);
      const page = await ctx.rooms.listRooms.execute({
        companyId: session.company_id,
        actorId: session.actor_id,
        cursor: input.cursor,
        limit: input.limit,
        includeArchived: input.include_archived,
        searchTerm: input.search_term,
      });
      return {
        items: page.items.map(roomSummary),
        page: { next_cursor: page.page.nextCursor },
      };
    }),
    members: t.router({
      list: memberListRoute(roomMembersListInputSchema, false),
      add: t.procedure.input(roomMembersAddInputSchema).output(roomMembersAddResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        await ctx.agentBuilder.requireRoomReady(session.company_id, input.actor_id);
        await ctx.rooms.addRoomMember.execute({
          roomId: input.room_id,
          actorId: input.actor_id,
          requestedByActorId: session.actor_id,
        });
        return roomMembers(ctx, session.company_id, session.actor_id, input.room_id);
      }),
      remove: t.procedure.input(roomMembersRemoveInputSchema).output(roomMembersRemoveResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        await ctx.rooms.removeRoomMember.execute({
          roomId: input.room_id,
          actorId: input.actor_id,
          requestedByActorId: session.actor_id,
        });
        return roomMembers(ctx, session.company_id, session.actor_id, input.room_id);
      }),
    }),
    agents: t.router({
      triggerPolicy: t.router({
        get: t.procedure.input(roomAgentTriggerPolicyInputSchema).output(roomAgentTriggerPolicyResultSchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return triggerPolicy(await ctx.roomMessages.getTriggerPolicy({
            roomId: input.room_id,
            companyId: session.company_id,
            agentMemberId: input.agent_member_id,
            requestedByMemberId: session.actor_id,
          }));
        }),
        set: t.procedure.input(roomAgentTriggerPolicySetInputSchema).output(roomAgentTriggerPolicyResultSchema).mutation(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return triggerPolicy(await ctx.roomMessages.setTriggerPolicy({
            roomId: input.room_id,
            companyId: session.company_id,
            agentMemberId: input.agent_member_id,
            requestedByMemberId: session.actor_id,
            policy: input.policy,
            expectedVersion: input.expected_version,
            nowMs: Date.now(),
          }));
        }),
      }),
      execution: t.router({
        get: t.procedure.input(roomAgentExecutionGetInputSchema).output(agentRoomExecutionSummarySchema).query(async ({ ctx, input }) => {
          const session = requireProductSession(ctx);
          await ctx.rooms.roomAccess.requireMember({ roomId: input.room_id, actorId: session.actor_id });
          const execution = await ctx.roomMessages.readExecution(input.execution_id);
          if (!execution || execution.roomId !== input.room_id) throw new TRPCError({ code: "NOT_FOUND" });
          return executionSummary(execution);
        }),
      }),
    }),
    messages: t.router({
      context: t.procedure.input(roomMessageContextInputSchema).output(roomMessagesListResultSchema).query(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const items = await ctx.roomMessages.context({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          messageId: input.message_id,
          limit: input.limit ?? 50,
        });
        return messagePage(input.room_id, items);
      }),
      list: t.procedure.input(roomMessagesListInputSchema).output(roomMessagesListResultSchema).query(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const items = await ctx.roomMessages.list({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          beforeSequence: decodeCursor(input.cursor),
          limit: input.limit ?? 50,
        });
        return messagePage(input.room_id, items);
      }),
      send: t.procedure.input(roomMessageSendInputSchema).output(roomMessageSendResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const references = referencesWithRoomImageAttachments({
          roomId: input.room_id,
          references: input.references ?? [],
          imageAttachments: input.image_attachments ?? [],
        });
        await ctx.companyFiles.validateMessageReferences(
          session.company_id,
          input.room_id,
          references,
          input.image_attachments ?? [],
        );
        const result = await ctx.roomMessages.send({
          roomId: input.room_id,
          companyId: session.company_id,
          senderMemberId: session.actor_id,
          senderType: "human",
          clientMessageId: input.client_message_id,
          markdown: input.markdown,
          plainText: markdownToPlainText(input.markdown),
          replyToMessageIds: input.reply_to_message_ids ?? [],
          branchMessageId: input.branch_message_id ?? null,
          references,
          imageAttachments: input.image_attachments ?? [],
          nowMs: Date.now(),
        });
        return { submitted: true as const, room_id: input.room_id, message: timeline(result.message) };
      }),
      edit: t.procedure.input(roomMessageEditInputSchema).output(roomMessageMutationResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const message = await ctx.roomMessages.edit({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          messageId: input.message_id,
          expectedRevision: input.expected_revision,
          markdown: input.markdown,
          idempotencyKey: input.idempotency_key,
          nowMs: Date.now(),
        });
        return { room_id: input.room_id, message: timeline(message) };
      }),
      softDelete: t.procedure.input(roomMessageSoftDeleteInputSchema).output(roomMessageMutationResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const message = await ctx.roomMessages.softDelete({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          messageId: input.message_id,
          expectedRevision: input.expected_revision,
          idempotencyKey: input.idempotency_key,
          nowMs: Date.now(),
        });
        return { room_id: input.room_id, message: timeline(message) };
      }),
      regenerate: t.procedure.input(roomAgentReplyRegenerateInputSchema).output(roomAgentReplyRegenerateResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const result = await ctx.roomMessages.regenerateAgentReply({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          messageId: input.message_id,
          expectedRevision: input.expected_revision,
          idempotencyKey: input.idempotency_key,
          nowMs: Date.now(),
        });
        return {
          accepted: true as const,
          room_id: input.room_id,
          execution_id: result.executionId,
          version_group_id: result.versionGroupId,
          version_number: result.versionNumber,
          message: timeline(result.message),
        };
      }),
      selectVersion: t.procedure.input(roomAgentReplySelectionSetInputSchema).output(roomAgentReplySelectionResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const selection = await ctx.roomMessages.selectAgentReplyVersion({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          versionGroupId: input.version_group_id,
          messageId: input.message_id,
          expectedRevision: input.expected_revision,
          idempotencyKey: input.idempotency_key,
          nowMs: Date.now(),
        });
        return {
          room_id: input.room_id,
          version_group_id: selection.versionGroupId,
          selected_message_id: selection.selectedMessageId,
          revision: selection.revision,
        };
      }),
      events: t.procedure.input(roomMessagesEventsInputSchema).output(roomMessageEventStreamSchema).subscription(async function* ({ ctx, input, signal }) {
        const session = requireProductSession(ctx);
        for await (const event of ctx.roomMessages.watch({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          signal,
        })) {
          if (event.type === "selection") {
            yield {
              schema_version: 1 as const,
              event_id: `room-selection:${event.versionGroupId}:${session.actor_id}:${event.revision}`,
              type: "room.agent_reply.selection_changed" as const,
              source: "backend" as const,
              room_id: input.room_id,
              version_group_id: event.versionGroupId,
              selected_message_id: event.selectedMessageId,
              revision: event.revision,
              occurred_at_ms: event.occurredAtMs,
            };
            continue;
          }
          const message = event.message;
          yield {
            schema_version: 1 as const,
            event_id: `room-message:${message.messageId}:${message.revision}`,
            type: message.revision === 1
              ? "room.message.created" as const
              : "room.message.updated" as const,
            source: "backend" as const,
            room_id: input.room_id,
            message: timeline(message),
            occurred_at_ms: message.updatedAtMs,
          };
        }
      }),
    }),
    agentActivity: t.router({
      watch: t.procedure.input(roomAgentActivityWatchInputSchema).output(roomAgentTurnEventStreamSchema).subscription(async ({ ctx, input, signal }) => {
        const session = requireProductSession(ctx);
        return ctx.roomMessages.watchActivity({
          roomId: input.room_id,
          companyId: session.company_id,
          executionId: input.execution_id,
          requestedByMemberId: session.actor_id,
          signal,
        });
      }),
    }),
    threads: t.router({
      read: t.procedure.input(roomThreadReadInputSchema).output(roomThreadReadResultSchema).query(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const items = await ctx.roomMessages.list({
          roomId: input.room_id,
          companyId: session.company_id,
          requestedByMemberId: session.actor_id,
          beforeSequence: null,
          limit: 100,
        });
        const threadItems = items.filter((item) => item.threadId === input.thread_id);
        if (threadItems.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return {
          room_id: input.room_id,
          thread_id: input.thread_id,
          root_message_id: threadItems[0]!.messageId,
          items: threadItems.map(timeline),
        };
      }),
    }),
    interactions: t.router({
      snooze: t.procedure.input(roomInteractionSnoozeInputSchema).output(roomInteractionSnoozeResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const deadlineAtMs = await ctx.roomMessages.snoozeQuestionInteraction({
          roomId: input.room_id,
          companyId: session.company_id,
          messageId: input.message_id,
          interactionId: input.interaction_id,
          memberId: session.actor_id,
          nowMs: Date.now(),
        });
        return { accepted: true, deadline_at_ms: deadlineAtMs };
      }),
      respond: t.procedure.input(roomInteractionRespondInputSchema).output(roomInteractionRespondResultSchema).mutation(async ({ ctx, input }) => {
        const session = requireProductSession(ctx);
        const secretClaim = await ctx.roomMessages.claimSecretInteractionResponse({
          roomId: input.room_id,
          companyId: session.company_id,
          messageId: input.message_id,
          interactionId: input.interaction_id,
          responderMemberId: session.actor_id,
          response: input.response,
          nowMs: Date.now(),
        });
        if (secretClaim) {
          try {
            await ctx.runtime.respondAgentRoomInteraction(session.company_id, secretClaim.dispatch);
          } catch (error) {
            await ctx.roomMessages.completeSecretInteractionResponse({
              claimToken: secretClaim.claimToken,
              dispatch: secretClaim.dispatch,
              delivered: false,
              nowMs: Date.now(),
            });
            throw error;
          }
          const message = await ctx.roomMessages.completeSecretInteractionResponse({
            claimToken: secretClaim.claimToken,
            dispatch: secretClaim.dispatch,
            delivered: true,
            nowMs: Date.now(),
          });
          if (!message) throw new TRPCError({ code: "CONFLICT" });
          return { room_id: input.room_id, message: timeline(message) };
        }
        const persisted = await ctx.roomMessages.persistInteractionResponse({
          roomId: input.room_id,
          companyId: session.company_id,
          messageId: input.message_id,
          interactionId: input.interaction_id,
          responderMemberId: session.actor_id,
          response: input.response,
          clientResponseId: input.client_response_id,
          nowMs: Date.now(),
        });
        const accepted = await ctx.runtime.respondAgentRoomInteraction(
          session.company_id,
          persisted.dispatch,
        );
        await ctx.roomMessages.markInteractionResponseDelivered(
          persisted.dispatch,
          accepted,
          Date.now(),
        );
        return {
          room_id: input.room_id,
          message: timeline(persisted.message),
        };
      }),
    }),
  };
}

function memberExecutorRouter(authority: "self" | "company_owner") {
  const currentInput = authority === "self" ? memberExecutorCurrentInputSchema : companyMemberExecutorInputSchema;
  const setInput = authority === "self" ? memberExecutorSetInputSchema : companyMemberExecutorSetInputSchema;
  return t.router({
    current: t.procedure.input(currentInput).output(memberExecutorAssignmentSchema).query(async ({ ctx, input }) => {
      const session = requireProductSession(ctx);
      const memberId = authority === "self"
        ? session.actor_id
        : (input as unknown as { member_id: string }).member_id;
      return currentMemberExecutor(ctx, session.company_id, memberId, authority, session.actor_id);
    }),
    options: t.procedure.input(currentInput).output(memberExecutorOptionsResultSchema).query(async ({ ctx, input }) => {
      const session = requireProductSession(ctx);
      const memberId = authority === "self"
        ? session.actor_id
        : (input as unknown as { member_id: string }).member_id;
      const items = await ctx.memberExecutors.listOptions({
        companyId: session.company_id,
        memberId,
        authority: { kind: authority, requestedByMemberId: session.actor_id },
      });
      return { member_id: memberId, items: items.map(safeExecutor) };
    }),
    set: t.procedure.input(setInput).output(memberExecutorAssignmentSchema).mutation(async ({ ctx, input }) => {
      const session = requireProductSession(ctx);
      const memberId = authority === "self"
        ? session.actor_id
        : (input as unknown as { member_id: string }).member_id;
      return memberAssignment(await ctx.memberExecutors.set({
        companyId: session.company_id,
        memberId,
        executorId: input.executor_id,
        authority: { kind: authority, requestedByMemberId: session.actor_id },
      }));
    }),
  });
}

function governanceRoute(blocked: boolean) {
  return t.procedure
    .input(companyExecutorSharingGovernanceInputSchema)
    .output(companyExecutorSharingGovernanceResultSchema)
    .mutation(({ ctx, input }) => {
      const session = requireProductSession(ctx);
      return ctx.personalExecutors.governSharing(
        session.company_id,
        session.actor_id,
        input.executor_id,
        blocked,
      );
    });
}

function memberListRoute(schema: typeof roomMembersListInputSchema, _mutation: boolean) {
  return t.procedure.input(schema).output(roomMembersListResultSchema).query(({ ctx, input }) => {
    const session = requireProductSession(ctx);
    return roomMembers(ctx, session.company_id, session.actor_id, input.room_id);
  });
}

async function roomMembers(
  ctx: Parameters<typeof requireProductSession>[0],
  companyId: string,
  actorId: string,
  roomId: string,
) {
  const result = await ctx.rooms.listRoomMembers.execute({
    companyId,
    roomId,
    actorId,
  });
  return {
    room_id: roomId,
    items: result.items.map((item) => ({
      member_id: item.actorId,
      name: item.displayName,
      mark: item.mark,
      role: item.role,
      meta: item.meta,
      joined_at_ms: item.joinedAtMs,
      status: item.status,
      actor_type: item.actorType,
      membership_version: item.membershipVersion,
      agent: item.actorType === "agent" ? true : undefined,
    })),
  };
}

async function currentMemberExecutor(
  ctx: Parameters<typeof requireProductSession>[0],
  companyId: string,
  memberId: string,
  authority: "self" | "company_owner",
  requestedByMemberId: string,
) {
  try {
    return memberAssignment(await ctx.memberExecutors.read({
      companyId,
      memberId,
      authority: { kind: authority, requestedByMemberId },
    }));
  } catch (error) {
    if (error instanceof ApplicationError && error.code === MEMBER_EXECUTOR_NOT_FOUND_CODE) {
      return {
        member_id: memberId,
        executor: null,
        version: 0,
        session_state: "unconfigured" as const,
        updated_at_ms: 0,
      };
    }
    return publicError(error);
  }
}

function memberAssignment(assignment: MemberExecutorAssignment) {
  return {
    member_id: assignment.memberId,
    executor: safeExecutor(assignment.executor),
    version: assignment.assignmentVersion,
    session_state: assignment.state,
    updated_at_ms: assignment.updatedAtMs,
  };
}

function safeExecutor(executor: MemberExecutorSummary) {
  return {
    executor_id: executor.executorId,
    scope: "personal" as const,
    executor_type: executor.executorType,
    binding_method: executor.authorization.method === "chatgpt" ? "device_code" as const : "api_key" as const,
    owner_actor_id: executor.ownerMemberId,
    owner_display_name: executor.ownerDisplayName,
    name: executor.name,
    authorization: executor.authorization.method === "chatgpt"
      ? { method: "chatgpt" as const, plan_type: executor.authorization.planType }
      : { method: "custom_api_key" as const },
    availability: executor.availability,
    model_policy: {
      revision: executor.configurationRevision,
      status: executor.configurationStatus,
      models: executor.allowedModels,
      allowed_reasoning_efforts: executor.allowedReasoningEfforts,
      default_model: executor.defaultModel,
      default_reasoning_effort: executor.defaultReasoningEffort,
      catalog_checked_at_ms: executor.catalogCheckedAtMs,
      updated_at_ms: executor.configurationUpdatedAtMs,
    },
  };
}

function onboarding(value: {
  stage: "creatingRuntime" | "initializingRuntime" | "failed" | "ready";
  company: { companyId: string; name: string; status: "provisioning" | "active" | "setup_failed" };
  runtime: { status: "pending" | "provisioning" | "initializing" | "ready" | "failed"; error: { code: string; retryable: boolean } | null };
}) {
  return {
    stage: value.stage,
    company: {
      company_id: value.company.companyId,
      name: value.company.name,
      status: value.company.status,
    },
    runtime: { status: value.runtime.status, error: value.runtime.error },
  };
}

function actorProjection(actor: {
  actorId: string;
  displayName: string;
  mark: string;
  email: string | null;
  actorType: "human" | "agent";
  companyRole: "owner" | "member";
  status: "active";
}) {
  return {
    actor_id: actor.actorId,
    display_name: actor.displayName,
    mark: actor.mark,
    email: actor.email,
    actor_type: actor.actorType,
    company_role: actor.companyRole,
    status: actor.status,
  };
}

function roomSummary(room: {
  id?: string;
  roomId?: string;
  name: string;
  subtitle: string | null;
  status: string;
  updatedAtMs: number;
  unreadCount?: number;
  readThrough?: string | null;
}) {
  return {
    room_id: room.id ?? room.roomId ?? "",
    name: room.name,
    subtitle: room.subtitle,
    status: room.status,
    updated_at_ms: room.updatedAtMs,
    unread_count: room.unreadCount ?? 0,
    read_through: room.readThrough ?? null,
  };
}

function triggerPolicy(state: {
  roomId: string;
  agentMemberId: string;
  triggerPolicy:
    | "human_explicit"
    | "member_explicit"
    | "human_auto"
    | "member_auto"
    | "human_explicit_agent_auto"
    | "agent_explicit_human_auto";
  triggerPolicyVersion: number;
  updatedAtMs: number;
}) {
  return {
    room_id: state.roomId,
    agent_member_id: state.agentMemberId,
    policy: state.triggerPolicy,
    version: state.triggerPolicyVersion,
    updated_at_ms: state.updatedAtMs,
  };
}

function executionSummary(execution: {
  executionId: string;
  cascadeId: string;
  roomId: string;
  agentMemberId: string;
  sourceMessageId: string;
  trigger: "mention" | "direct_reply" | "automatic";
  status: "pending" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";
  startedAtMs: number | null;
  completedAtMs: number | null;
  error: { code: string; retryable: boolean } | null;
}) {
  return {
    execution_id: execution.executionId,
    cascade_id: execution.cascadeId,
    room_id: execution.roomId,
    agent_member_id: execution.agentMemberId,
    source_message_id: execution.sourceMessageId,
    trigger: execution.trigger,
    status: execution.status,
    started_at_ms: execution.startedAtMs,
    completed_at_ms: execution.completedAtMs,
    error: execution.error,
  };
}

function messagePage(roomId: string, items: readonly PersistedRoomMessage[]) {
  return {
    room_id: roomId,
    items: items.map(timeline),
    page: {
      next_cursor: items.length === 0 ? null : encodeCursor(items[0]!.sequence),
      backwards_cursor: items.length === 0 ? null : encodeCursor(items.at(-1)!.sequence),
    },
  };
}

function timeline(message: PersistedRoomMessage): RoomTimelineMessage {
  const senderId = message.senderMemberId ?? "system";
  return {
    id: message.messageId,
    sequence: message.sequence,
    kind: "message",
    room_id: message.roomId,
    occurred_at_ms: message.createdAtMs,
    sender: {
      type: message.senderType,
      id: senderId,
      display_name: message.senderDisplayName,
      mark: message.senderMark,
      avatar_resource_id: message.senderAvatarResourceId,
    },
    body: {
      format: "inline_markdown",
      markdown: message.markdown,
      plain_text: message.plainText,
    },
    revision: message.revision,
    edited_at_ms: message.editedAtMs,
    deleted_at_ms: message.deletedAtMs,
    reply_to: message.replyToMessageIds.length === 0
      ? null
      : { message_ids: [...message.replyToMessageIds], preview: "" },
    interactions: [...message.interactions],
    thread_id: message.threadId,
    references: message.references as RoomTimelineMessage extends { references?: infer R } ? R : never,
    image_attachments: [...(message.imageAttachments ?? [])] as RoomMessageImageAttachment[],
    ...(message.versionGroupId !== null && message.versionNumber !== null
      ? {
        agent_reply_version: {
          group_id: message.versionGroupId,
          version_number: message.versionNumber,
          version_count: message.versionCount,
          selected: message.selectedVersionMessageId === message.messageId,
          selection_revision: message.selectionRevision,
          latest_successful: message.latestSuccessfulVersionMessageId === message.messageId,
          source_execution_id: message.sourceExecutionId,
        },
      }
      : {}),
    ...(message.sourceExecutionId && message.sourceCascadeId
      ? {
        agent_turn: {
          trigger_message_id: message.triggerMessageId ?? message.messageId,
          execution_id: message.sourceExecutionId,
          cascade_id: message.sourceCascadeId,
          status: publicAgentTurnStatus(message.sourceExecutionStatus),
          started_at_ms: message.sourceExecutionStartedAtMs,
          completed_at_ms: message.sourceExecutionCompletedAtMs,
          duration_ms: message.sourceExecutionStartedAtMs === null
            || message.sourceExecutionCompletedAtMs === null
            ? null
            : Math.max(
              0,
              message.sourceExecutionCompletedAtMs - message.sourceExecutionStartedAtMs,
            ),
        },
      }
      : {}),
    ...(message.sourceExecutionStatus === "pending"
      || message.sourceExecutionStatus === "dispatched"
      || message.sourceExecutionStatus === "running"
      ? {
        generation: {
          state: message.sourceExecutionStatus === "running"
            ? "streaming" as const
            : "waiting" as const,
        },
      }
      : {}),
  };
}

function publicAgentTurnStatus(
  status: PersistedRoomMessage["sourceExecutionStatus"],
): "queued" | "running" | "completed" | "failed" | "interrupted" {
  if (status === "running") return "running";
  if (status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "interrupted";
  return "queued";
}

async function* homeDesktopNotifications(events: AsyncIterable<unknown>): AsyncGenerator<DesktopNotificationEvent> {
  const previews = new Map<string, string>();
  for await (const value of events) {
    const event = value as HomeAgentTurnEvent;
    if (event.scope.type !== "home") continue;
    if (event.type === "agent_turn.item_upsert" && event.item.type === "assistant_message") {
      const preview = event.item.content.flatMap((content) => content.type === "text" ? [content.text] : content.type === "markdown" ? [content.markdown] : []).join(" ").replace(/\s+/gu, " ").trim().slice(0, 240);
      if (preview) previews.set(event.scope.thread_id, preview);
      continue;
    }
    if (event.type !== "agent_turn.status" || (event.status !== "completed" && event.status !== "failed" && event.status !== "interrupted")) continue;
    yield { schema_version: 1, event_id: `desktop-home-agent:${event.event_id}`, type: "agent.terminal", occurred_at_ms: event.occurred_at_ms, status: event.status, target: { kind: "home", thread_id: event.scope.thread_id, title: "Home" }, preview: previews.get(event.scope.thread_id) ?? null };
    previews.delete(event.scope.thread_id);
  }
}

async function* mergeDesktopNotificationStreams(streams: AsyncIterable<DesktopNotificationEvent>[]): AsyncGenerator<DesktopNotificationEvent> {
  const queue: DesktopNotificationEvent[] = [];
  let active = streams.length;
  let wake: (() => void) | null = null;
  let failure: unknown = null;
  const notify = () => { const current = wake; wake = null; if (current !== null) current(); };
  for (const stream of streams) void (async () => {
    try { for await (const event of stream) { queue.push(event); notify(); } }
    catch (error) { failure = error; }
    finally { active -= 1; notify(); }
  })();
  while (active > 0 || queue.length > 0) {
    const event = queue.shift();
    if (event) { yield event; continue; }
    if (failure) throw failure;
    await new Promise<void>((resolve) => { wake = resolve; });
  }
  if (failure) throw failure;
}

function encodeCursor(sequence: number): string {
  return Buffer.from(String(sequence), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
