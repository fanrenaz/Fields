# Home 与 Room 聊天运行时重构

## 总结

- 以 LobeHub `11f7bc8d4434140557b2d8709979e5532233c864` 为固定基线，只把本次重构实际需要的源码及其内部依赖复制到 `desktop/vendor/lobehub`，不引入完整仓库。
- 直接复用 Lobe 的 Conversation Store、conversation-flow、消息类型、工具注册表、AssistantGroup、ProcessFold、WorkflowCollapse、MessageBranch 和 Composer。
- Lobe 负责聊天前端运行时与默认交互；Fields 继续负责公开协议、权限、持久化、Agent 执行、Codex App Server 和凭据边界。
- Home 与 Room 一次性原子切换，不长期维护新旧两套 Timeline、Composer 或消息状态机。

## 实现变更

### Lobe 源码引入与前端边界

- 不使用 git subtree、submodule 或独立 workspace package。将选中的 Lobe 模块及其可达内部依赖复制到 `desktop/vendor/lobehub`，保留必要的原始目录结构，并通过 TypeScript/Vite alias 从 Desktop 编译。
- 复制范围限定为 Conversation Store、conversation-flow、消息与工具类型、Tool Store/renderer、Conversation 消息组件和 Composer 所需源码；不复制 Lobe 的服务端、账号、插件市场、设置系统及其他无关页面。
- 在 Desktop 补齐复制源码需要的外部依赖，版本与固定的 Lobe 提交一致；不得为了规避依赖整理而复制整个 Lobe 仓库。
- Lobe 的 `UIChatMessage` 等类型只存在于浏览器适配层，不进入 Fields 公共接口、数据库或 Backend 领域模型。
- 在 vendor 目录外建立薄的 Fields 适配层，替换 Lobe 对自身 message service、Chat Store、工具执行服务和持久化服务的引用；除修复无法隔离的上游耦合外，不直接改写复制源码。
- `desktop/vendor/lobehub` 必须包含上游许可证和来源说明，记录固定 SHA、复制文件清单、复制命令及必要的本地补丁。后续升级重新从新固定 SHA 复制同一源码闭包，再核对文件差异、适配层和依赖变化。

### Store、消息流与工具注册表

- Lobe Conversation Store 成为当前 Home/Room 会话的唯一前端消息状态：历史加载、流式增量、AssistantGroup、分支版本、编辑态、生成态和工具展示。
- Home、Room 现有 XState 机器只保留领域编排：
  - Home：线程列表、Executor、模型与推理强度、文件系统。
  - Room：Room、成员、资源、权限、回复选择、文件、审批与线程面板。
- 从 XState 删除消息投影、Agent Turn 展开、流式消息合并和重复的生成状态。
- 复用 Lobe Tool Store 的 renderer、inspector、状态和 intervention 注册机制；由 Fields adapter 提供工具定义和结果。
- 浏览器仅展示经过 Fields 反腐层清洗的工具数据，不执行 Runtime 工具，不接触 MCP 或 Executor 凭据；未知工具使用安全的通用 Inspector。
- Home 的历史读取扩展为完整、provider-neutral 的 Turn 投影，保留 reasoning、tool、文件变更、错误、审批和流式状态，不再只返回用户与 Agent 文本。

### 消息版本、编辑与分支语义

#### 共享表现

- 复用 Lobe 的父子消息树、`activeBranchIndex` 和 `MessageBranch`，以 `1/2` 左右切换同一位置的不同版本。
- “重新生成”始终新增不可变版本，不物理覆盖旧结果；选中某个版本后，后续消息沿该版本对应的分支继续。
- “回复线程”和“生成版本”保持两个独立概念，适配层负责映射，避免把 Room reply 误当作生成分支。

#### Home

- 使用 Codex App Server 的正式 fork 语义：
  - 编辑历史用户消息：在该 Turn 之前 fork，使用新文本启动 Turn。
  - 重新生成回复：在原用户 Turn 之前 fork，并以原输入重新启动 Turn。
  - 显式分支：按选定 Turn fork。
- 每个生成版本对应一个不可变 Codex thread fork；左右切换版本同时切换当前底层 thread，之后继续对话也进入该 thread。
- 在 Company Runtime 的 Home 线程元数据中保存 provider-neutral 的根线程、来源线程、分支锚点和当前选择；不写入 `auth.json` 或复制凭据。
- 支持 Codex 的空 Composer 连按两次 Esc：进入最近一条可编辑用户消息，并通过上述 fork 流程提交。
- 不实现单条 Home 消息的物理删除；删除动作删除整个 Codex thread，并要求明确确认。不使用已废弃的 `thread/rollback`。

#### Room

- 引入 Agent 回复版本组：同一原始触发消息下，每次重新生成创建新的执行、Agent 消息和版本序号，并保留原执行与输出。
- 重新生成严格复用原执行的 Agent、触发消息和上下文锚点，不把原回复之后的消息混入新版本。
- 任意具备发送权限的 Room 成员可以重新生成；执行仍经过现有 Controller、权限和幂等机制。
- 版本均为共享事实，但当前版本选择按成员持久化：
  - 发起重新生成者自动切换到新版本。
  - 未主动选择过的成员默认看到最新成功版本。
  - 已主动选择旧版本的成员保持自己的选择。
  - 切换版本不广播为全 Room 的内容变更。
- 只有本人发送的人类消息可以编辑或软删除；Agent 消息和他人消息不可修改。
- 编辑保留稳定消息 ID、revision、编辑标记及完整审计版本，不自动重跑已有 Agent 执行。
- 软删除保留消息、回复关系、版本关系和审计记录，正文以 tombstone 展示。
- 新增 Room 实时事件覆盖编辑、软删除、新生成版本和当前成员版本选择的同步。

### UI 原子切换与清理

- 保留 Fields 64px 全局导航；Home 内部直接采用 Lobe Agent Chat 布局，Room 内部直接采用 Lobe Group Chat 布局。
- Home 的线程导航进入 Lobe 左侧 NavPanel，文件与运行上下文进入右侧 WorkingSidebar；Room 的成员与资源进入 Group Sidebar，回复线程进入右侧 Portal。
- 沿用 Lobe 的面板宽度、拖动、折叠入口、44px Header、宽屏浮动 Header 和主框架内 Portal 行为，不再维护自制的 Home/Room Workspace 壳。
- Home 和 Room 都改用 Lobe Conversation/AssistantGroup 渲染消息、reasoning、工具调用、过程折叠、工作流、文件变更、错误和版本切换。
- Composer 改用 Lobe ChatInput/Composer 运行时，同时保留 Fields 插槽：
  - Home：Executor、模型、推理强度。
  - Room：成员/Agent mention、引用、回复、上传和审批。
- 使用 Lobe 默认消息动作与视觉，只按 Fields 权限和当前消息能力过滤不可用动作。
- 同一个原子改动中删除自研 `Timeline` 消息渲染、`AgentTurnActivityPanel`、`agent-turn-activity`、`home-turn-projector` 及对应重复状态和测试。
- 保留 Fields Markdown 安全策略及 HTML Preview sandbox，不允许 raw provider payload 穿透到浏览器。

## 接口与持久化

- 分别扩展现有 Home、Room contract，不新建跨包领域抽象：
  - Home thread read 返回 Turn ID、完整 `AgentTurnSnapshot` 和 provider-neutral 分支信息。
  - Home 增加 fork、编辑后 fork、重新生成后 fork、线程删除操作。
  - Room 增加本人消息编辑、软删除、Agent 回复重新生成和成员版本选择操作。
- Room 数据库增加：
  - Agent 回复版本组及版本序号。
  - 新执行与来源执行、触发消息的关联。
  - 成员级活动版本选择。
  - 人类消息 revision、删除状态和审计版本记录。
- 所有写操作包含权限校验、幂等键和乐观并发 revision；重复请求不得产生重复执行或版本。
- 继续执行公共契约的 provider-neutral 禁止字段检查；日志和遥测也不得记录原始 provider payload 或凭据。

## 测试与验收

- Conversation adapter：覆盖所有支持的 Codex Turn item、工具状态、reasoning、文件变更、错误、流式增量、未知工具降级和引用稳定性。
- Lobe tree：覆盖用户/Agent 多版本、嵌套分支、AssistantGroup、切换版本后继续发送，以及乐观新分支。
- Home：验证 edit/fork/regenerate、Esc Esc、版本切换后 thread 归属、完整历史恢复、线程删除确认及禁止 rollback。
- Room：验证本人权限、他人/Agent 消息不可编辑、软删除 tombstone、审计、并发 revision、重新生成幂等、成员独立版本选择和实时事件。
- 安全：验证浏览器契约无 provider 原始字段、Member workspace 无 `auth.json`、Runtime 凭据不会进入 Store 或日志。
- 对 contracts、backend、company-runtime、desktop 运行允许的定向测试、typecheck、lint 和 `git diff --check`。
- 数据库迁移、依赖解析和生产构建由远程 CI 验证；本地不运行应用构建、Docker 构建或 Playwright。
- 发布后再按单独授权更新运行环境，并验证健康检查、容器命令和挂载、日志、遥测以及 Home/Room 浏览器冒烟。

## 假设与实施约束

- 项目不进行商业分发，并接受 LobeHub 当前许可证对源码复用的要求。
- 固定上述 SHA；复制源码必须来自该提交，不从浮动 `canary` 获取，也不在安装或构建时联网拉取 Lobe 源码。
- 当前工作区已有的 Room 单消息 Agent Turn 与迁移改动属于实施基线，重构时整合而不回退；无关工作树文件不得纳入提交。
- Room 历史数据迁移采用向前兼容方式，不因开发环境可丢弃而默认清空正式数据。
- 一次切换完成后不存在长期兼容层；回退单位是完整提交或发布版本，而不是运行时混用两套聊天实现。
