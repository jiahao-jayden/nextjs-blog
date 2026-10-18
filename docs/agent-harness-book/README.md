# Agent Harness 生产级工程实践与架构设计

> 目标：系统梳理面向生产环境的 Agent Harness 架构体系、核心工程实现、边界防御与生产级高可用设计，以 `jai-mono` 源码及工业级实战为基线。

---

## 目录索引

- [00. 模型流式抽象与兼容层基座 (packages/ai)](#00-模型流式抽象与兼容层基座-packagesai)
- [01. Agent Loop 核心流转与生命周期控制](#01-agent-loop-核心流转与生命周期控制)
- [02. 上下文管理、KV Cache 断点与 Compaction](#02-上下文管理kv-cache-断点与-compaction)
- [03. 权限系统、Bash AST 静态分析与审批拦截](#03-权限系统bash-ast-静态分析与审批拦截)
- [04. 树形 Journal、T1/T2 效果边界与崩溃恢复](#04-树形-journalt1t2-效果边界与崩溃恢复)
- [05. 执行环境、Kill Boundary 竞态与 OOM 熔断](#05-执行环境kill-boundary-竞态与-oom-熔断)
- [06. 控制面解耦、Director 调度栈与 Steering 打断](#06-控制面解耦director-调度栈与-steering-打断)
- [07. Skills 级联、MCP 传输层与 ToolCatalog 二阶段](#07-skills-级联mcp-传输层与-toolcatalog-二阶段)
- [08. 单向状态投影、推测流渲染与 PTY 逻辑行缓冲](#08-单向状态投影推测流渲染与-pty-逻辑行缓冲)
- [09. 工业级评测体系与全链路可观测性](#09-工业级评测体系与全链路可观测性)

---

## 00. 模型流式抽象与兼容层基座 (packages/ai)

### 1. 核心问题与工程边界
- **协议分裂与语义漂移**：OpenAI Chat Completions、Responses API 与 Anthropic Messages 的消息模型、流式分块（SSE）、工具调用协议差异巨大；开源网关/第三方转发商常出现 `max_tokens` 与 `max_completion_tokens` 参数冲突、流式丢 usage、thinking delta 格式混乱。
- **KV Cache 命中基座被破坏**：供应商要求严苛的前缀确定性与断点标注（Cache Breakpoint）。若在底层未对 System Prompt、静态 Tool Definitions 和尾部动态 Turn 实施精准物理打点，上层上下文微调将导致全量缓存击穿，引发时延与 Token 成本翻倍。
- **流式半路截断与协议伪造注入**：新一代推理模型（Thinking）在多轮对话中要求必须回传 `thinkingSignature`；非原生微调模型（如某些 DeepSeek 衍生模型）常在文本正文中输出 `<invoke name="...">` 假冒工具调用，导致上层状态机错乱或执行未授权动作。

### 2. `jai-mono` 关键实现与数据流 (`packages/ai/src/`)
- **统一流式事件总线 (`event-stream.ts`, `adapter.ts`)**：
  - 封装 `AssistantMessageEventStream`：将增量文本（`text_delta`）、思考过程（`thinking_delta`）、工具调用片段拼装（`tool_call_delta`）与 `usage` 统计统一归一化为不可变事件序列。
  - 错误清洗与领域错误映射：`normalizeProviderError()` 将网络抖动、速率限制（429）、上下文超限（400/413）统一收敛为带上下文的 `TaggedError`。
- **多层级兼容性级联系统 (`compatibility.ts`)**：
  - 五层优先级解析：`dialect -> provider -> family -> identity -> override`。
  - 自动化裁决 `maxTokensField` 适配、流式 Usage 支持能力、Strict Tools 支持策略以及思考格式（`openai` / `deepseek` / `none`）。
- **三级物理 KV Cache 断点机制 (`providers/anthropic.ts`)**：
  - **Breakpoint 1 (System Prompt)**：静态全局指令末尾打点。
  - **Breakpoint 2 (Tool Definitions)**：`convertTools()` 在最后一个静态工具定义处打点，固定 Schema 缓存。
  - **Breakpoint 3 (Dynamic Turns Tail)**：`applyCacheBreakpointToLastUser()` 从后往前扫描，在最后一条 `user` 或 `toolResult` 消息末尾注入 `cache_control: { type: "ephemeral" }`。
- **协议防伪与输入安全转换 (`tool-protocol.ts`, `transform-messages.ts`)**：
  - **非原生工具调用拦截**：`assertNativeToolCallProtocol()` 识别模型输出中假冒的 XML/DSML 工具语法，抛出 `ModelOutputProtocolViolation`，通过 `discardProtocolViolationContent` 清洗脏文本，防止非法注入。
  - **多模态非视觉降级**：`transformMessagesForModel()` 依据目标模型能力自动将不可见图片替换为结构化占位符，消除 Provider 400 校验异常。

### 3. 生产级故障防御与权衡
- **核心权衡**：在工业级 Agent 中，为什么绝不能依赖单一官方 SDK，也绝不能让 Agent Loop 直接操作裸模型客户端？
- **设计解法**：官方 SDK 仅负责单一连接协议，不承担跨供应商流式事件归一化、严苛三级 Cache 断点排版、多层级兼容性规则打补丁（Stream Healing）与假冒 ToolCall 拦截过滤。将 `packages/ai` 作为确定性基座，上层 Agent Loop 才能保持纯粹、可测试且无供应商锁定的状态流转。

---

## 01. Agent Loop 核心流转与生命周期控制

### 1. 核心问题与工程边界
- **状态机流转**：`Prompts -> Model Call -> Tool Dispatch -> Tool Execution -> Append Messages -> Next Turn`。
- **终止条件判定**：
  - 正常终态：模型输出无 `tool_calls` 的最终文本响应。
  - 协作式中断：接收外部 `AbortSignal` 信号退出。
  - 保护性硬顶：`maxIterations` 轮次预算耗尽强制收尾。

### 2. `jai-mono` 关键实现与数据流 (`packages/agent/src/core/agent-loop.ts`)
- **不可变运行时上下文**：`AgentLoopRuntime`（`context`, `newMessages`, `config`, `signal`, `emit`）在单次 run 内部逐层传递，避免上下文污染。
- **原子 Turn 流转 (`runTurn`)**：
  1. `beforeModelCall` 钩子阶段执行上下文前置变换。
  2. Provider 流式响应消费与出向事件映射（`translateEvent`），维护实时 `AssistantMessage`。
  3. 工具调用参数强校验（`validateToolArguments`）。
  4. 工具批量执行（`ExecutedToolBatch`）：区分串行与并行批次，捕获执行异常并封装为 `ToolResultMessage`。
  5. 产出 `TurnResult`（`hasMoreToolCalls` 与 `stopped`）决定循环推进。

### 3. 生产级故障防御与权衡
- **核心权衡**：主循环如何处理模型输出协议违规（如模型在文本中夹带伪造的 XML/JSON 工具调用字符串）？
- **设计解法**：通过协议拦截层（如 `isModelOutputProtocolViolation` 与 `discardProtocolViolationContent`）识别非原生 ToolCall 文本，阻断伪造执行，进行受控报错或纠正，防止非法参数注入。

---

## 02. 上下文管理、KV Cache 断点与 Compaction

### 1. 核心问题与工程边界
- **KV Cache 命中率劣化**：动态内容前置导致缓存前缀频繁失效，引起 Token 消耗剧增与首字延迟（TTFT）恶化。
- **长会话上下文溢出**：窗口超限导致模型拒绝服务，传统同步压缩造成 30s~60s 交互阻塞。

### 2. `jai-mono` 关键实现与数据流
- **Anthropic 三级缓存断点 (`packages/ai/src/providers/anthropic.ts`)**：
  - **Breakpoint 1 (System Prompt)**：`params.system` 静态系统提示词打点，确保全局系统指令缓存命中。
  - **Breakpoint 2 (Tool Definitions)**：`convertTools()` 在最后一个工具定义打点，锁定静态工具集 Schema。
  - **Breakpoint 3 (Dynamic Turns Tail)**：`applyCacheBreakpointToLastUser()` 从后往前扫描，在最后一条 `user` 或 `toolResult` 消息的最后一个 content block 打点，锁定历史对话前缀。
- **上下文压缩算法 (`packages/agent/src/harness/compaction/projection.ts`)**：
  - **切点推导 (`CompactionCut`)**：基于 Token 预算从后往前保留最新 $K$ 条消息，计算 `firstKeptEntryId`，保证 ToolCall 与 ToolResult 成对保留不被截断。
  - **双 User 角色冲突规避**：`buildCompactedMessages` 中使用 `mergeIntoUserMessage` 将生成的摘要与紧邻的 User 消息合并为一个 content 块，避免连续两个 User 角色导致 Provider 报 400 错误。
- **投机性后台压缩 (Speculative Compaction)**：
  - 在 Token 占用达到阈值（如 90%）时，在后台轻量分支异步触发摘要生成。主进程达到硬限制时原子切换就绪摘要，消除用户侧等待。

### 3. 面试考点与防御
- **问题**：如何在长会话中兼顾 KV Cache 缓存命中率与上下文压缩的准确性？
- **解答要点**：遵循 Prefix 稳定性原则，严格按照 `System -> Tools -> History -> Ephemeral` 顺序编排；压缩时通过纯函数单向投影（`projectCompactedMessages`）维护线性逻辑视图，同时利用后台推测压缩隐藏摘要计算延迟。

---

## 03. 权限系统、Bash AST 静态分析与审批拦截

### 1. 核心问题与工程边界
- **正则匹配的不可靠性**：字符串正则无法识别包装命令（`nohup`, `time`, `stdbuf`）、环境变量前缀（`FOO=1 cmd`）、复合命令（`|`, `&&`, `;`）、子 Shell 及别名。
- **文件越权与路径逃逸**：相对路径（`../../`）与符号链接（Symlink）穿透工作区沙箱。

### 2. `jai-mono` 关键实现与数据流 (`packages/coding-agent/src/permissions/`)
- **基于 `tree-sitter-bash` 的 AST 扫描 (`evaluate.ts`, `bash-parser.ts`)**：
  - **Wrapper 剥离**：递归剥离 `strippedWrappers`（`builtin`, `command`, `nice`, `noglob`, `nohup`, `stdbuf`, `time`, `timeout`），定位真实可执行命令索引 `executableIndex`。
  - **复合命令展开**：递归拆解管道与复合语句，将整句 Bash 命令解构为平铺的 `PermissionTarget` 列表。
  - **命令分类与风险打标**：内置 `readOnlyCommands` 白名单与只读 Git 子命令判定；区分 `file.read` 与 `file.write` / `destructive`。
- **路径规范化与模式执行**：
  - 使用 `realpathSync` 解析真实物理路径，配合 `relative(workspaceRoot, targetPath)` 判定是否越出工作区。
  - 权限模式：`default`（按策略审批）、`acceptEdits`、`bypassPermissions` 与 `plan` 模式（写操作一票否决）。

### 3. 面试考点与防御
- **问题**：Agent 在执行 `node -e "fs.unlinkSync('/etc/passwd')"` 时，Bash AST 无法深入分析 Node 内部代码，如何防御？
- **解答要点**：AST 扫描负责第一层命令特征识别（识别出 `node` 为通用代码执行器，标记为高风险 `destructive` 并强制触发人机审批）；底层兜底依赖 OS 级沙箱隔离与非特权用户隔离，不依赖单一防线。

---

## 04. 树形 Journal、T1/T2 效果边界与崩溃恢复

### 1. 核心问题与工程边界
- **双重事实源状态撕裂**：将会话模式、动态配置游离在 Journal 之外，导致 Rewind（回退）后状态残留。
- **崩溃恢复的副作用不确定性**：工具已在外部执行，但结果尚未持久化时进程崩溃，重启后盲目重试非幂等操作导致资损。

### 2. `jai-mono` 关键实现与数据流
- **Append-Only 树形存储 (`packages/agent/src/harness/session/tree.ts`)**：
  - 不可变条目：`TreeEntry = MessageEntry | AppStateEntry | CompactionEntry | BranchEntry`。
  - 纯函数分支派生：`branchOf(entries, leafId)` 沿着 `parentId` 向上回溯构建当前活跃分支链，杜绝废弃分支幽灵复活。
- **两阶段效果边界 (T1 / T2)**：
  - **T1 意图落盘 (`beforeToolEffect`)**：在工具实际执行前，将 `tool_dispatched`（参数哈希、调用 ID、预分配结果 entry ID）写入 Operation Journal。
  - **T2 结果落盘**：工具执行完成，将输出写入 Session Journal。
- **纯函数恢复 Reducer (`packages/agent/src/harness/operations/recovery.ts`)**：
  - 存在 T1 记录但无对应结果 entry：判定为 `indeterminate_tool`（结果未知），挂起等待人工确认，严禁自动重放。
  - 仅有输入无 attempt -> `ready`；存在 attempt 但无 assistant entry -> `provider_interrupted`；终态已写入 -> `terminal`。

### 3. 面试考点与防御
- **问题**：Agent 正在写文件时断电，重启后系统如何确保数据一致性且不引发重复写入？
- **解答要点**：依靠 T1/T2 两阶段日志分离。恢复时通过纯函数 Reducer 识别出处于 T1 与 T2 之间的未决操作，将其标记为 `indeterminate_tool` 并阻塞自动执行，由 Host 协调状态核对，保证不会误把“未决”当作“未执行”进行二次重放。

---

## 05. 执行环境、Kill Boundary 竞态与 OOM 熔断

### 1. 核心问题与工程边界
- **进程取消中的孤儿进程泄漏**：协作式取消无法终止死循环脚本；父 Shell 退出后子孙进程脱管。
- **大文件载入引发宿主 OOM**：读取数 GB 大文件导致宿主 Node.js 进程内存爆裂崩溃。

### 2. `jai-mono` 关键实现与数据流 (`packages/agent/src/harness/node/environment.ts`)
- **Kill Boundary 竞态防御**：
  - 漏洞根因：父进程收到 `SIGTERM` 退出触发 `child.once("close")`，`finally` 块清除了 1 秒后的 `forceKillTimer`，导致未响应 `SIGTERM` 的子孙进程永久存活。
  - 修复机制：使用 POSIX 进程组（`detached: true`），向负 PID 发送信号（`process.kill(-pgid, 'SIGKILL')`）；Windows 环境绑定原生 `JobObject`（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。
- **有界执行与内存防护**：
  - **前置 OOM 熔断**：`Read` / `Edit` 工具在 `stat.size` 阶段校验文件大小，超过阈值（如 5MB）立即熔断返回错误，禁止全量载入内存。
  - **统一输出截断**：框架层统一限制输出为 50KB / 2000 行，超限输出转储至临时文件。

### 3. 面试考点与防御
- **问题**：JavaScript 中的 `AbortSignal` 与操作系统的进程 Kill 机制在 Agent 系统中如何分工？
- **解答要点**：`AbortSignal` 属于协作式取消，适用于网络请求与支持取消 token 的异步调用；对于外部 Shell 命令、编译任务等黑盒执行，必须依赖 OS 级进程组硬杀死机制（Kill Boundary）作为终极兜底。

---

## 06. 控制面解耦、Director 调度栈与 Steering 打断

### 1. 核心问题与工程边界
- **多意志并发冲突**：Plan 模式要求强制规划、Todo 扩展要求全部打勾才准退出、用户中途发送新指令——硬编码 `if-else` 导致逻辑混乱与死锁。
- **插话时序歧义**：用户输入究竟是打断当前步还是任务后排队。

### 2. 架构设计与状态机
- **Director（导演）栈原语**：
  - 责任链堆栈结构：`Base -> TodoContinue -> Plan -> ForceTool`。
  - `onYield` 决策协议：
    - `Pass`：放行给外层 Director 处理。
    - `Continue`：消费 Yield 并开启下一轮推理。
    - `Yield`：交还控制权给用户。
    - `Push`：压入子 Director 接管控制。
    - `Done`：完成任务并从栈中弹出自身。
- **交互通道分类**：
  - **Steering**：单 Turn 间抢占式插入，直接改变下一轮模型思考输入。
  - **Follow-up**：当前完整 Task 结束后排队执行后续任务。

### 3. 面试考点与防御
- **问题**：如何实现一个既能在执行中实时响应用户修改，又能自主推进多步复杂规划的 Agent 控制流？
- **解答要点**：将外层主循环抽离为单层状态机，通过 Director 栈处理退出仲裁；将用户输入区分为 Steering（抢占队列）与 Follow-up（任务队列），在每轮推理前置阶段优先消费 Steering 消息。

---

## 07. Skills 级联、MCP 传输层与 ToolCatalog 二阶段

### 1. 核心问题与工程边界
- **常驻 Schema 膨胀**：常驻暴露 15+ 工具对每轮请求征收沉重的 Attention Tax，降低模型遵循指令能力并破坏 KV Cache。
- **外部扩展动态热更新**：外部配置更新导致工具集变动时的版本一致性与防逃逸。

### 2. `jai-mono` 关键实现与数据流
- **Skills 级联与安全沙箱 (`packages/extension/src/skills/catalog.ts`)**：
  - **优先级合并**：Project 级（`.jai/skills`）覆盖 User 级（`~/.jai/skills`）。
  - **Shadow 诊断与防逃逸**：同名覆盖生成 `shadowed` 诊断；通过 `await realpath()` 校验物理路径，阻断通过 Symlink 逃离 Catalog Root（`SkillPathEscape`）。
  - **不可变快照**：基于 `fs.watch` 防抖，计算全局 SHA-256 `revision` 并以不可变 Snapshot 广播。
- **MCP 运行时治理 (`packages/extension/src/mcp/`)**：
  - 传输层支持：`stdio`、`sse`、`streamable-http`。
  - 异常自愈：`stdio` 子进程退出触发指数退避自动重连；监听 `tools/list_changed` 动态原子替换工具集。
- **ToolCatalog 二阶段检索**：
  - 裁剪常驻核心工具至最简；长尾工具通过 `SearchTools` 检索出带生命周期的 opaque `toolRef`，再通过 `ExecuteTool` 间接调用。

### 3. 面试考点与防御
- **问题**：系统接入上百个 MCP 工具时，如何避免 Prompt 溢出并保持调用的准确率？
- **解答要点**：采用 ToolCatalog 二阶段调用机制。模型首轮仅感知 Catalog 检索原语，动态匹配后再基于返回的 `toolRef` 进行结构化分发，将常驻 Schema 开销降为常数级。

---

## 08. 单向状态投影、推测流渲染与 PTY 逻辑行缓冲

### 1. 核心问题与工程边界
- **前端状态回流污染**：将 UI 临时状态反写回持久化存储导致状态分叉。
- **终端与长流式渲染卡顿/撕裂**：高频流式更新导致全量 DOM 重排；ANSI 裸字节缓冲在窗口缩放时发生重影。

### 2. 架构设计与渲染管线
- **单向读取模型 (Projection Pattern)**：
  - UI 严格作为 Session Journal 和 OperationEvent 的只读投影，禁止 UI 派生状态写回 Journal。
- **弹性推测流式渲染**：
  - **解耦已提交与推测态**：历史消息 DOM 节点绝对冻结；仅对活跃的推测尾部执行增量 Markdown 解析与合批渲染（`requestAnimationFrame`）。
  - **PTY 逻辑行缓冲 (Logical Rows)**：淘汰裸字节切片缓存，在主进程维护与物理列宽无关的逻辑文本行，容器缩放或组件重挂载时基于逻辑行按新宽度重排，消除 ANSI 截断乱码。

### 3. 面试考点与防御
- **问题**：在包含数万行实时工具日志的会话中，前端如何保证 60fps 流畅滚动与打字机效果？
- **解答要点**：结合虚拟列表（`@tanstack/react-virtual`）与逻辑行缓冲；历史块完成状态固化后脱离响应式监听，流式更新通过 RAF 在推测槽位合批处理，避免深层组件树无效 Diff。

---

## 09. 工业级评测体系与全链路可观测性

### 1. 核心问题与工程边界
- **评测指标的统计欺骗性**：Temperature > 0 时单次运行（Pass@1）存在随机方差；合成 Benchmark 与真实生产环境脱节。
- **故障排查溯源困难**：长链路多轮会话中难以定位单次耗时异常或 Token 突增的根因。

### 2. 评测与观测体系
- **三层测试分层**：
  1. 单元级：纯函数 Reducer 状态机测试（如 `recovery.test.ts`、`projection.test.ts`）。
  2. 集成级：故障注入测试（模拟断电、SIGKILL 强制杀进程、网络抖动）。
  3. 任务级：真实工作区沙箱验收（如 `frontier-smoke`），结合 Pass@k 统计显著性评估。
- **全链路追踪打点**：
  - 端到端串联三元组：`operationId` -> `attemptId` -> `toolCallId`。
  - 细粒度记录各阶段用时（TTFT、工具执行时延、网络传输）与 Cache Read / Write Token 分布。

### 3. 生产级故障防御与权衡
- **核心权衡**：线上多轮长会话任务时延突增或成本失控时，如何通过 Trace 实现根因定位？
- **设计解法**：基于 `operationId -> attemptId -> toolCallId` 的全链路 Span 追踪，精确分离模型推理等待（TTFT）、工具执行开销与框架序列化时延；同时将 Cache Read/Write Token 纳入可观测性监控指标，第一时间捕获 Prompt 编排导致的缓存击穿。

