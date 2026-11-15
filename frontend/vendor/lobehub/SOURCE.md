# LobeHub vendored browser runtime

Source repository: `https://github.com/lobehub/lobe-chat.git`

Pinned commit: `11f7bc8d4434140557b2d8709979e5532233c864`

The files in this directory are a deliberately small browser-only source
closure. Conversation types and flow are compiled through the
`@lobechat/conversation-flow` and `@lobechat/types` aliases. The selected shell
components are presentation-only adapters derived from the same pinned commit.
LobeHub server, router, global stores, account, marketplace, persistence,
settings, and tool-execution code are not included.

The Asset Builder reuses the existing `agent-builder/AgentBuilder.tsx` source
closure; it does not import another LobeHub subtree.

## Copy command

Starting from a clean checkout of the pinned commit:

```sh
mkdir -p frontend/vendor/lobehub/conversation-flow
cp -R packages/conversation-flow/src/. frontend/vendor/lobehub/conversation-flow/
find frontend/vendor/lobehub/conversation-flow -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -delete
install -D LICENSE frontend/vendor/lobehub/LICENSE
install -D packages/types/src/message/ui/chat.ts frontend/vendor/lobehub/types/message/ui/chat.ts
install -D packages/types/src/message/common/base.ts frontend/vendor/lobehub/types/message/common/base.ts
install -D packages/types/src/message/common/messageGroup.ts frontend/vendor/lobehub/types/message/common/messageGroup.ts
install -D packages/types/src/message/common/tools.ts frontend/vendor/lobehub/types/message/common/tools.ts
install -D src/features/Conversation/Messages/AssistantGroup/components/ProcessFold.tsx frontend/vendor/lobehub/components/ProcessFold.tsx
install -D src/features/Conversation/Messages/components/MessageBranch.tsx frontend/vendor/lobehub/components/MessageBranch.tsx
install -D src/features/AgentTasks/AgentTaskDetail/scheduler/CronConfig.ts frontend/vendor/lobehub/scheduled-task/CronConfig.ts
install -D src/features/AgentTasks/AgentTaskDetail/scheduler/SchedulerForm.tsx frontend/vendor/lobehub/scheduled-task/SchedulerForm.tsx
install -D src/features/AgentTasks/features/AgentTaskItem.tsx frontend/vendor/lobehub/scheduled-task/TaskList.tsx
```

Apply the patches documented in `PATCHES.md` after copying.

The shell adapters use these additional source inputs from the same checkout:

- `src/features/NavHeader/index.tsx`
- `src/features/NavPanel/SideBarLayout.tsx`
- `src/features/NavPanel/components/NavPanelDraggable.tsx`
- `src/routes/(main)/_layout/DesktopLayoutContainer.tsx`
- `src/routes/(main)/_layout/DesktopLayoutContainer/style.ts`
- `src/routes/(main)/agent/(chat)/_layout/index.tsx`
- `src/routes/(main)/agent/features/Conversation/Header/index.tsx`
- `src/routes/(main)/group/_layout/index.tsx`
- `src/routes/(main)/group/index.tsx`
- `src/routes/(main)/group/features/Conversation/Header/index.tsx`

The shared Home and Room message adapter uses this application-level source
input instead of the horizontal generic `@lobehub/ui/chat` item:

- `src/features/Conversation/ChatItem/ChatItem.tsx`

The Agent Builder adapter uses these source inputs from the same pinned
checkout:

- `src/features/AgentBuilder/index.tsx`
- `src/features/AgentBuilder/AgentBuilderConversation.tsx`
- `src/features/AgentBuilder/AgentBuilderWelcome.tsx`
- `src/features/AgentBuilder/TopicSelector.tsx`
- `src/features/AgentBuilder/SuggestionChips/index.tsx`

The Room private chat adapter uses the current fixed-topic composition from:

- `src/features/FloatingChatPanel/index.tsx`
- `src/features/FloatingChatPanel/ChatBody.tsx`
- `src/features/FloatingChatPanel/InputRow.tsx`

The Company Files presentation adapter uses the Explorer and FileViewer
composition from:

- `src/features/ResourceManager/components/Explorer/index.tsx`
- `src/features/ResourceManager/components/Explorer/Header/index.tsx`
- `src/features/ResourceManager/components/Explorer/Header/Breadcrumb.tsx`
- `src/features/ResourceManager/components/Explorer/Header/SearchInput.tsx`
- `src/features/ResourceManager/components/Explorer/ListView/index.tsx`
- `src/features/ResourceManager/components/Explorer/MasonryView/index.tsx`
- `src/features/ResourceManager/components/Explorer/ToolBar/SortDropdown.tsx`
- `src/features/ResourceManager/components/Explorer/ToolBar/ViewSwitcher.tsx`
- `src/features/ResourceManager/components/Explorer/ItemDropdown/useFileItemDropdown.tsx`
- `src/features/FileViewer/index.tsx`
- `src/features/FileViewer/Renderer/Code/index.tsx`
- `src/features/FileViewer/Renderer/HTML/index.tsx`
- `src/features/FileViewer/Renderer/Image/index.tsx`
- `src/features/FileViewer/Renderer/MSDoc/index.tsx`
- `src/features/FileViewer/Renderer/PDF/index.tsx`
- `src/features/FileViewer/Renderer/Video/index.tsx`

The Scheduled Tasks presentation uses the smallest source closure from the
same pinned checkout. No Task Store, Kanban, assignee, priority, subtask,
acceptance, conversation, or Lobe server code is included:

- `src/features/AgentTasks/AgentTaskDetail/TaskScheduleConfig.tsx`
- `src/features/AgentTasks/AgentTaskDetail/scheduler/CronConfig.ts`
- `src/features/AgentTasks/AgentTaskDetail/scheduler/SchedulerForm.tsx`
- `src/features/AgentTasks/AgentTaskDetail/scheduler/helpers.ts`
- `src/features/AgentTasks/features/AgentTaskItem.tsx`
- `src/features/AgentTasks/AgentTaskList/TasksGroupConfig.tsx`

## Copied upstream file manifest

- `LICENSE`
- `conversation-flow/assistantGroupContent.ts`
- `conversation-flow/doctor/diagnose.ts`
- `conversation-flow/doctor/index.ts`
- `conversation-flow/doctor/types.ts`
- `conversation-flow/index.ts`
- `conversation-flow/indexing.ts`
- `conversation-flow/parse.ts`
- `conversation-flow/structuring.ts`
- `conversation-flow/transformation/BranchResolver.ts`
- `conversation-flow/transformation/ContextTreeBuilder.ts`
- `conversation-flow/transformation/FlatListBuilder.ts`
- `conversation-flow/transformation/MessageCollector.ts`
- `conversation-flow/transformation/MessageTransformer.ts`
- `conversation-flow/transformation/index.ts`
- `conversation-flow/types/contextTree.ts`
- `conversation-flow/types/flatMessageList.ts`
- `conversation-flow/types/index.ts`
- `conversation-flow/types/shared.ts`
- `components/MessageBranch.tsx`
- `components/ProcessFold.tsx`
- `types/message/common/base.ts`
- `types/message/common/messageGroup.ts`
- `types/message/common/tools.ts`
- `types/message/ui/chat.ts`

## Fields browser adapter files

These files are local integration code derived from the corresponding Lobe
conversation concepts. They intentionally remove imports of Lobe's global
application stores and services:

- `components/AssistantGroup.tsx`
- `components/ConversationChatItem.tsx`
- `agent-builder/AgentBuilder.tsx`
- `components/ConversationColumn.tsx`
- `components/ConversationPanelHeader.tsx`
- `components/DesktopWorkspaceFrame.tsx`
- `components/NavHeader.tsx`
- `components/SideBarLayout.tsx`
- `components/WorkspacePanel.tsx`
- `components/WorkflowCollapse.tsx`
- `floating-chat/FloatingChatPanel.tsx`
- `resource-manager/ResourceExplorer.tsx`
- `file-viewer/FileViewer.tsx`
- `store/index.tsx`
- `store/tool-store.ts`
- `types/index.ts`
- `types/message/common/index.ts`
- `types/support.ts`
- `scheduled-task/CronConfig.ts`
- `scheduled-task/SchedulerForm.tsx`
- `scheduled-task/TaskList.tsx`

External dependency versions are taken from the pinned commit's root
`package.json`: `fast-deep-equal ^3.1.3`, `immer ^11.1.8`, `type-fest ^5.7.0`,
`zod ^4.4.3`, `zustand 5.0.4`, and `zustand-utils ^2.1.1`.
The Company Files closure additionally uses `dayjs ^1.11.21`,
`es-toolkit ^1.49.0`, `pdfjs-dist 5.4.296`, `react-pdf ^10.4.1`, and
`react-virtuoso ^4.18.10`, matching the pinned commit.
