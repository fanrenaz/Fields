# Local patches

All local changes keep provider access, persistence, credentials, and tool
execution outside the vendored browser runtime.

- `agent-builder/AgentBuilder.tsx`: generalize the vendored Lobe Agent Builder
  conversation, history, welcome, and composer presentation for Agent and
  Asset Builder modes; Fields adapters continue to own persistence and tools.
- `floating-chat/FloatingChatPanel.tsx`: retain Lobe's fixed-context
  `ChatBody` plus `InputRow` composition inside the existing Fields right
  Portal. Replace Lobe global stores and document topics with explicit
  Room-side-chat messages, store, draft, and send callbacks; the Fields
  Backend and Company Runtime own the private fixed Thread and Executor.
- `conversation-flow/assistantGroupContent.ts`: replace the unrelated Lobe
  constants package import with the same local loading marker.
- `conversation-flow/*`: point type imports at the selected local type closure.
- `components/MessageBranch.tsx`: replace the Lobe global Conversation Store
  lookup with an explicit `onSwitch` callback.
- `components/AssistantGroup.tsx`: retain the Lobe assistant-group/process-fold
  composition while rendering Fields-sanitized Markdown and browser-safe tool
  blocks.
- `components/ConversationColumn.tsx`: retain the Lobe Agent Chat floating
  header and Group Chat in-flow header compositions while accepting explicit
  title, action, toggle, and content slots.
- `components/ConversationPanelHeader.tsx`: retain Lobe's 44px sidebar header,
  tabs, actions, and panel-toggle presentation with callbacks supplied by the
  Fields adapter.
- `components/DesktopWorkspaceFrame.tsx`: retain Lobe's inset desktop frame,
  while removing Electron platform checks and accepting the Fields-controlled
  left NavPanel state as an explicit prop. It also accepts a presentation-only
  flush mode so the Electron shell can remove the nested frame while Web keeps
  the upstream inset treatment. The right Portal remains inside the frame,
  matching Lobe's Agent and Group layouts.
- `components/NavHeader.tsx`: retain Lobe's three-slot 44px header without
  reading its Global Store or rendering its application-specific panel toggle.
- `components/SideBarLayout.tsx`: retain Lobe's header/body composition and add
  a non-scrolling body mode for Fields panels that already own their scroll
  containers.
- `components/WorkspacePanel.tsx`: retain Lobe's draggable NavPanel structure
  and styling while accepting width, placement, expansion, and accessible
  resize-handle slots from the Fields shell adapter.
- `features/shell/LobeWorkspaces.tsx`: compose the upstream Agent Chat and Group
  Chat layouts with explicit Fields panel, header, stage, and Portal slots. It
  contains no data fetching, persistence, routing, or runtime execution.
- `components/WorkflowCollapse.tsx`: retain Lobe's collapsible workflow
  interaction while reading generation state and renderer registrations from
  the scoped browser stores.
- `agent-builder/AgentBuilder.tsx`: retain Lobe's Agent Builder panel, topic
  selector/history, Welcome, suggestion chips, ChatList, and ChatInput
  composition. Lobe global stores, cloud services, and permissions are replaced
  by explicit Fields callbacks; persistence and Executor resolution remain
  outside the vendored view.
- `store/index.tsx`: adapt the Lobe Conversation Store data and display-message
  flow to an explicitly provided Fields database-message snapshot. It has no
  network or persistence methods.
- `store/tool-store.ts`: retain renderer, inspector, status, and intervention
  registration only. It cannot execute a tool and accepts only
  provider-neutral display content.
- `types/index.ts`, `types/message/common/index.ts`, and `types/support.ts`:
  provide the minimal reachable exports needed by the copied message and
  conversation-flow types.
- `resource-manager/ResourceExplorer.tsx`: retain Lobe's Explorer header,
  breadcrumb, search, list/masonry switcher, virtualized list, selection,
  sorting, drag/drop, and item-menu composition. Replace Lobe router, knowledge
  stores, permissions, services, and pagination with explicit Fields callbacks.
- `file-viewer/FileViewer.tsx`: retain Lobe's MIME/extension renderer routing
  and Office Online behavior. Replace Lobe file services and global loading
  components with explicit short-lived RustFS preview/download URLs.
- `features/company-files/CompanyFilesWorkbench.tsx`: owns the Fields adapter
  for Company Files contracts, RustFS uploads, optimistic boundaries, sharing,
  permissions, and localized dialogs. The vendored presentation has no direct
  persistence or authorization access.
- `scheduled-task/CronConfig.ts`, `SchedulerForm.tsx`, and `TaskList.tsx`:
  retain the pinned Lobe task schedule form, grouped list, and Task Item
  presentation concepts while replacing Task Store, permissions, routing, and
  server types with explicit Fields contract values and callbacks. The adapter
  adds the approved once, weekdays, advanced five-field Cron, 10-minute
  granularity, IANA timezone, heartbeat, and provider-neutral status shapes.
  Backend remains the only schedule validator and execution authority.

Upgrade procedure:

1. Check out a new explicitly approved fixed SHA.
2. Re-copy the same source closure listed in `SOURCE.md`.
3. Review every upstream diff for the copied files and external dependencies.
4. Reapply or retire each patch above deliberately.
5. Run the desktop typecheck and targeted conversation tests locally; validate
   the production build only in the approved remote CI workflow.
