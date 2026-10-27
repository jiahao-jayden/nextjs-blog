# 工具安全执行：权限审批、Bash AST 分析与进程管控

前两章我们搭好了 `agentLoop` 和上下文压缩，Agent 已经可以在长任务里一轮接一轮地推进了。但在前两章的视角里，工具调用还只是一个抽象的 `await tool.execute(args)`。一旦把 `Read`、`Write`、`Edit` 和 `Bash` 这几个真能读写本地磁盘、启动操作系统子进程的工具接进主循环，马上就会遇到三个非常现实的工程问题：

1. **权限审批既不能全拦，也不能靠简单的字符串匹配放行**：如果每调一次工具都弹窗让用户点“允许”，Agent 查个代码跑十几次 `Read`、`grep`、`git status`，用户光点确认按钮就要点到手软；但如果为了省事写个简单的字符串前缀白名单（比如 `cmd.startsWith("git ")` 或 `cmd.startsWith("ls")` 就自动放行），模型一旦拼出 `git status && rm -rf dist`、`FOO=1 timeout 10s rm -rf build` 或者 `find . -delete`，简单的前缀匹配就会被轻易绕过。
2. **软链接（Symlink）越界与大输出撑爆内存**：对于文件读写，光检查字面路径有没有带 `../` 是不够的。如果工作区里有一个指向 `~/.ssh` 的软链接，字面路径看起来完全在项目目录内，实际读写的却是系统敏感文件；同时，如果模型调 `Read` 去读一个 2GB 的二进制文件或长日志，或者 `Bash` 命令一口气吐出几十万行输出，不仅会塞爆模型的上下文窗口，还会直接导致宿主 Node.js 进程内存溢出（OOM）崩溃。
3. **用户点取消时，杀不死派生的子孙进程**：在第 01 章讲 `agentLoop` 时，我们通过 `AbortSignal` 通知工具取消执行。但对于 `Bash` 工具来说，底层是通过 `/bin/sh -c "..."` 启动的子进程。如果在收到取消信号时只调一句普通的 `child.kill()`，死掉的往往只有最外层那个 `/bin/sh` 进程，它里面启动的 `npm test`、编译任务或死循环脚本会脱离父进程变成孤儿进程，继续在后台占用 CPU 和端口。

---

## 社区主流方案对比：OpenCode、Codex、Grok CLI 与 Pi

在动手写 `jai-mono` 之前，我们先横向对比了 **Pi、OpenCode、OpenAI Codex、Grok CLI** 四个项目的权限系统。虽然 OpenCode、Codex 和 Grok CLI 底层都用 `tree-sitter-bash` 来解析 Shell 命令，但四家在整体权限架构上的取舍完全不同：

| 项目 | 权限规则模型 | 命令与路径分析方式 | 审批与持久授权 | 执行层隔离 |
| :--- | :--- | :--- | :--- | :--- |
| **Pi** | 无内置动作权限 | 只做启动时的项目配置信任检查（`Project Trust`） | 无内置弹窗（交给扩展） | 交给外部容器或扩展 |
| **OpenCode** | `工具 + 通配符 -> allow / ask / deny`（最后匹配胜出） | 用 `tree-sitter` 提取 `command` 节点；识别外部目录访问 | `once` / `always`（通过 `BashArity` 存命令前缀） | 无内置沙箱，直接 `spawn` |
| **OpenAI Codex** | `ApprovalPolicy` + `PermissionProfile` + `exec_policy` | `tree-sitter` 节点白名单（含重定向/变量等直接拒绝自动匹配） | 区分本次、当前会话缓存与持久规则修改 | 内置 Seatbelt / Landlock + bwrap 沙箱 |
| **Grok CLI** | 固定 `deny > ask > allow` 优先级 + 只读白名单 | `tree-sitter` 剥离 `env/timeout` 前缀、递归解析 `bash -c`、对齐文件规则 | 区分本次、会话级与项目级 `permission.toml`（危险命令禁存 `always`） | 可选 Seatbelt / Landlock + bwrap 沙箱 |

快速总结这四家的核心设计：

1. **OpenCode（[`anomalyco/opencode`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts)）**：
   提供了最直观的 `permission + pattern` 规则表。执行 `bash` 前用 `tree-sitter-bash` 拆出子命令逐一查表；当用户点击“始终允许（`always`）”时，通过一张子命令词数表（[`BashArity`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/arity.ts)）把 `npm run test --watch` 自动截取成 `npm run test *` 存下来（避免只存 `npm *` 把 `npm publish` 也放行了）。但它的局限在于规则采用“最后一条匹配胜出（`findLast`）”容易因书写顺序被覆盖，且只提取了 `command` 节点（漏掉了外层的 `>` 重定向和 `bash -c "..."` 内部脚本）。
2. **OpenAI Codex（[`openai/codex`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs)）**：
   一方面在 AST 解析时采用严格的节点白名单（只要出现重定向 `>`、`$(...)`、变量 `$FOO` 就拒绝自动放行）；另一方面引入了**操作系统内核沙箱**（macOS 下用系统自带的 `sandbox-exec` 配合 Seatbelt 规则，Linux 下用 `bubblewrap` 配合 `--ro-bind / /` 与 `--bind workspace workspace`）。
   注意，这种本地 OS 沙箱操作的**依然是你真实的本地硬盘**——它把当前项目目录设为可读写（改代码直接在真硬盘生效），把其他目录设为只读，把 `~/.ssh` 设为禁读并默认断网。这样 **AST 检查负责防模型在工作区内明着删代码（如 `rm -rf src/`），OS 沙箱负责防测试脚本在内部暗着越界读私钥**。
3. **Grok CLI（[`xai-org/grok-build`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs)）**：
   固定采用 `deny > ask > allow` 优先级（不依赖配置顺序）；在命令分析上会先剥掉 `FOO=1`、`timeout`、`nohup` 等前缀，遇到语法报错或无法静态看清的命令一律回退到 `ask`，并且对 `rm` 或 `node / python` 等脚本解释器禁止勾选“始终允许”。
4. **Pi（[`earendil-works/pi`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md)）**：
   核心不内置动作弹窗，但专门卡住了**启动时的文件夹信任门（`Project Trust`）**：打开陌生仓库时先询问是否信任，防止自动加载仓库里的恶意配置或本地插件。

---

## 一、 权限系统的基础概念与完整生命周期

结合上面四家的经验，我们在 [packages/coding-agent/src/permissions](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions) 中把权限系统实现为了第 01 章提到的洋葱中间件 `createPermissionMiddleware`。

在看具体的流转代码之前，我们先理清三个最基础的问题：**判断结果有哪几种？权限规则怎么配？一次工具调用是怎么变成可检查的目标的？**

### 1. 为什么判断结果是 `allow / ask / deny` 三态？

在传统后端系统里，权限校验通常只有“通过（`true`）”和“拒绝（`false`）”两种结果。但在 Agent 场景下，二元布尔值是不够用的，必须拆成三种行为（`PermissionEffect`）：
- **`allow`（直接放行）**：像读取当前项目里的代码文件（`Read("src/index.ts")`）、执行 `git status`，没有任何破坏性，直接静默放行，不打扰用户；
- **`deny`（直接拒绝）**：像执行删根目录 `rm -rf /`、在只读的 `plan` 模式下尝试改文件，或者访问用户在配置里明确拉黑的敏感文件（如 `.env`），系统当场抛错拦截，把拒绝原因转成 `isError: true` 的 `ToolResultMessage` 回传给模型，**连弹窗都不弹**；
- **`ask`（挂起并弹窗询问用户）**：像修改代码（`Edit`）、删除构建目录（`rm -rf dist`）、或者读取工作区以外的文件。这些操作有风险，但往往又是完成任务必需的——系统不能替用户直接做主，必须把当前工具调用**挂起**，在界面上弹出确认框，等用户点选：
  - **允许一次（`allowOnce`）**：只放行当前这一次调用；
  - **始终允许（`alwaysAllow`）**：放行本次调用，并自动生成一条新的 `allow` 规则保存下来，下次遇到同类操作直接命中 `allow` 不再弹窗；
  - **拒绝（`deny`）**：拦截本次调用。

### 2. 什么是 `PermissionAction` 与 `PermissionTarget`？

模型发来的原始工具调用 `ToolCall(name, args)` 五花八门：`Write` 和 `Edit` 都是改文件但参数结构不同，而一次 `Bash` 调用里可能用 `&&` 或 `|` 串了好几条子命令。

为了不让规则表和具体的工具参数结构绑死，系统先在 [`permissions/types.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/types.ts) 中定义了 **4 种标准动作（`PermissionAction`）**：
- `file.read`：读文件（对应 `Read`）
- `file.write`：写/改文件（对应 `Write`、`Edit`）
- `process.exec`：执行终端命令（对应 `Bash`）
- `tool.invoke`：调用外部扩展或 MCP 工具

这样用户的权限配置就可以写成一张结构统一的字典：

```json
{
  "defaultMode": "ask",
  "permission": {
    "file.read": { "**/.env": "deny" },
    "file.write": { "src/**": "allow" },
    "process.exec": { "git status *": "allow", "git push *": "deny" }
  }
}
```

当模型真正发起一次工具调用时，权限系统的第一步（`createPermissionRequest`）就是把原始的 `ToolCall`，拆解成一个或多个格式统一的**最小检查单元 `PermissionTarget`**：

```ts
export interface PermissionTarget {
  readonly toolName: string;                // 原始工具名，如 "Edit" 或 "Bash"
  readonly action: PermissionAction;        // 标准动作："file.read" | "file.write" | "process.exec" | "tool.invoke"
  readonly resource: PermissionResource;    // 具体目标资源（文件路径 path 或 单条子命令 command）
  readonly risk?: "destructive" | "opaque"; // 静态分析打上的风险标签（高危破坏性 / 语法不明）
}
```

举两个具体的转换例子就一目了然了：
- **例子 A（改文件）**：模型调用 `Edit({ path: "src/a.ts", old_string: "1", new_string: "2" })`
  $\rightarrow$ 忽略具体的修改文本，转换成 **1 个** `PermissionTarget`：
  `{ toolName: "Edit", action: "file.write", resource: { kind: "path", path: "src/a.ts" } }`
- **例子 B（跑复合命令）**：模型调用 `Bash({ command: "git status && rm -rf dist" })`
  $\rightarrow$ 为什么一次调用会拆出多个 Target？因为前半句是只读的，后半句是删除操作！经过 `tree-sitter-bash` 拆解后，它会生成 **2 个** `PermissionTarget`：
  1. `{ toolName: "Bash", action: "process.exec", resource: { kind: "command", command: "git status" } }`（查表得 `allow`）
  2. `{ toolName: "Bash", action: "process.exec", resource: { kind: "command", command: "rm -rf dist" }, risk: "destructive" }`（查表得 `ask`）
  最后把这两个 Target 的判断结果按 **`deny > ask > allow`** 合并，得出整次 `Bash` 调用的最终结论是 **`ask`**。

### 3. 一次工具调用的 6 阶段完整生命周期

理解了上面的基础概念，我们再顺着 [`middleware.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/middleware.ts) 的主干代码，把**“当模型发起一次工具调用时，它在权限系统里从头到尾经历了哪 6 个阶段”**拉通看一遍：

```text
[模型发起工具调用 ToolCall(name, args)]
   │
   ├─► 阶段 1：拆解与归一化 (createPermissionRequest)
   │     ├─ Read / Write / Edit ──► 转成 file.read / file.write + 目标 path
   │     └─ Bash 命令 ──► 经 tree-sitter-bash 拆成多条子命令 process.exec 目标
   │
   ├─► 阶段 2：初次规则求值 (Initial Evaluate)
   │     └─ 合并用户配置、项目授权与当前会话授权，按 deny > ask > allow 算出初次结果
   │        (若命中 deny，当场抛错拦截，转成 isError: true 的 ToolResultMessage 回给模型)
   │
   ├─► 阶段 3：解析真实物理路径并二次求值 (Canonical Path Check)
   │     └─ 对文件操作调用 fs.realpath 解开软链接，签发一次性 PathCapability 通行证，
   │        再用真实物理路径跑一遍 evaluatePermission（防止软链接指向工作区外）
   │
   ├─► 阶段 4：自动放行或进入排队审批 (Approval Queue)
   │     ├─ 若第 2、3 步全为 allow ──► 直接跳到阶段 6 执行
   │     └─ 若存在 ask ──► 进入 approvalQueue 串行排队，向前端发送 approval_requested 事件，
   │        挂起等待用户点击：[拒绝 (deny)] / [允许一次 (allowOnce)] / [始终允许 (alwaysAllow)]
   │
   ├─► 阶段 5：执行前二次核验与规则持久化 (Recheck & Persist Grant)
   │     ├─ 拿到用户同意后，立刻调 recheckOrDeny() 重算一次：
   │     │  防止等待用户点击的那几秒里，会话被切成了只读 Plan 模式或路径被篡改
   │     └─ 若用户选了 alwaysAllow，按作用域写入当前会话内存 (session) 或项目配置 (project-local)
   │
   └─► 阶段 6：带作用域受控执行 (executeApproved)
         └─ 将一次性 PathCapability 和编译后的 ShellExecutionPolicy 绑定到 AsyncLocalStorage，
            调用 next() 放行到底层 tool.execute()
```

对照上面这张流程图，[`packages/coding-agent/src/permissions/middleware.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/middleware.ts) 的主干代码其实非常直白：

```ts
export function createPermissionMiddleware(options: PermissionMiddlewareOptions): ToolMiddleware {
  return async (context, next) => {
    const workspaceRoot = currentWorkspaceRoot(options.workspaceRoot);
    const effective = withSessionRules(await currentSettings(options.settings), sessionAllowRules, /* ... */);

    // 阶段 1 & 2：拆解请求目标（Bash 先跑 AST 扫描），做初次规则求值
    const permissionArgs = await argsForPermission(toolName, context.args);
    const call = createPermissionRequest(toolName, permissionArgs, workspaceRoot);
    const initial = evaluatePermission(call, effective);
    if (initial.behavior === "deny") throw permissionDeniedError(toolName, initial.reason);

    // 阶段 3：解析软链接背后的真实物理路径 canonicalPath，签发通行证并做二次求值
    const capability = await createPathCapability(options.pathCapabilities, toolName, permissionArgs, workspaceRoot, context.signal);
    const canonicalDecision = capability ? evaluatePermission(canonicalCall(call, capability.canonicalPath), effective) : initial;
    if (canonicalDecision.behavior === "deny") throw permissionDeniedError(toolName, canonicalDecision.reason);

    // 若两遍检查都通过，直接带通行证放行执行
    if (initial.behavior === "allow" && canonicalDecision.behavior === "allow") {
      return executeApproved(options, toolName, capability, next);
    }

    // 阶段 4 & 5：需要 ask 时进入审批队列排队，用户同意后做 recheckOrDeny 重验并保存 alwaysAllow 规则
    const approval = await approvalQueue.enqueue(async (queueSignal) => {
      if (await recheckOrDeny()) return undefined; // 排队期间可能已被前一个同类请求的 alwaysAllow 覆盖，无需再弹窗
      const decision = normalizeApprovalDecision(await requestApproval(request, queueSignal));
      if (decision !== "deny") {
        await recheckOrDeny(); // 防等待审批期间模式或路径发生变化
        if (decision === "alwaysAllow" && suggested) await persistGrant(suggested);
      }
      return decision;
    }, context.signal);

    if (approval === "deny") throw permissionDeniedError(toolName, "User denied the permission request");
    // 阶段 6：挂载沙箱与路径通行证作用域，调用 next() 真正执行工具
    return executeApproved(options, toolName, capability, next);
  };
}
```

把这 6 个阶段的骨架立住之后，我们再来看里面最关键的几个环节是怎么实现的。

---

## 二、 规则求值引擎与审批交互细节 (`evaluate.ts` & `rules.ts`)

拿到拆解好的 `PermissionTarget` 后，阶段 2 的 `evaluateTarget` 是怎么给单个目标算出 `allow`、`ask` 或 `deny` 的？

### 1. 五层固定优先级 (`evaluateTarget`)

对于每一个 `PermissionTarget`，`evaluateTarget` 严格按照 **五层固定优先级** 从高到低裁决（位于 [`evaluate.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/evaluate.ts)）：

```ts
function evaluateTarget(request: PermissionRequest, target: PermissionTarget, settings: ResolvedPermissionSettings): PermissionDecision {
  // 优先级 1：用户的显式 deny 规则，或当前处于只读的 Plan 模式（写操作一票否决）
  if (rule?.action === "deny") return ruleDecision(target, rule);
  if (settings.defaultMode === "plan" && !isReadOnlyTarget(target)) {
    return decision("deny", "mode", "Plan mode only allows read-only work", target);
  }
  // 优先级 2：删库熔断（如 rm -rf / 或 ~），直接 deny，连弹窗都不弹
  if (target.resource.kind === "command" && isCircuitBreakerCommand(target.resource.command)) {
    return decision("deny", "danger-layer", "Deleting the filesystem root or home directory is not allowed", target);
  }
  // 优先级 3：高危层（destructive 删除/写命令 或 AST 解析失败的 opaque 命令），强制弹窗 ask
  if (target.risk === "destructive" || target.risk === "opaque") {
    return decision("ask", "danger-layer", "Destructive or opaque operation requires approval", target);
  }
  // 优先级 4：用户配置的规则 (rule) 与已记住的授权 (projectGrant / sessionGrant)
  if (rule?.action === "ask" && grant?.action === "allow") return ruleDecision(target, grant);
  if (rule) return ruleDecision(target, rule);
  if (grant?.action === "allow") return ruleDecision(target, grant);

  // 优先级 5：默认模式兜底（内置安全只读命令与工作区内 Read 自动 allow，其余全部 ask）
  return builtInDecision(request, target, settings);
}
```

这个优先级顺序保证了两个安全底线：
- **只读规划模式（`plan` mode）与显式 `deny` 永远在最顶层**：一旦切进 `plan` 模式，除了只读文件读取和 `ls / git status / rg` 等少数只读子命令外，任何修改操作在第一层就会被拦下；
- **危险层（`danger-layer`）排在用户普通 `allow` 和自动模式之前**：哪怕用户开启了免打扰的 `allow` 模式，遇到 `rm`、`git reset --hard`、`sudo`、`node -e`、重定向写文件 `>`，或者 `tree-sitter-bash` 解析报错（`opaque`）的命令，也一定会停在优先级 3 触发弹窗确认。

### 2. Bash 命令的拆解与前缀剥离

至于 `Bash` 命令是怎么喂给上面这套规则引擎的，我们在 [`bash-parser.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/bash-parser.ts) 和 [`rules.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/rules.ts) 里只做了三件最必要的事：
1. **`tree-sitter-bash` 拆解子命令**：把复合命令（如 `git status && rm -rf dist`）拆成多个 `process.exec` 目标，并保留外层的重定向文本（`redirected_statement`）；只要有一个子命令算出来是 `deny` 就整体拒绝，有一个是 `ask` 就整体弹窗。
2. **剥离环境变量与包装词**：在判断一条子命令是不是只读或高危时，先跳过开头的 `FOO=1` 变量赋值和 `timeout 10s`、`nohup`、`env`、`command` 等包装前缀，并用 `commandBasename` 把 `/bin/rm` 还原成 `rm`。
3. **按命令类型区分“始终允许（`alwaysAllow`）”的作用域**：
   当弹窗让用户审批时，如果这条命令属于 `danger-layer`（高危命令），`suggestedRules` 直接返回 `undefined`，界面上不显示“始终允许”按钮；如果是普通操作：
   - **文件读写（`Read` / `Edit` / `Write`）**：点击“始终允许”只记在**当前会话内存（`scope: "session"`）**里，关掉会话即失效；
   - **普通 `Bash` 命令（如 `npm run test`）**：通过 `bashArity` 词数表生成 `process.exec:npm run test *`，持久化保存到**当前项目的本地配置（`scope: "project-local"`）**中。

### 3. 四种权限模式（`plan / ask / allow / auto`）与自动审查 (`review.ts`)

除了单条规则外，系统还支持切换整体的权限模式（`PermissionMode`），对应四种不同的自动化程度：

1. **`plan` 模式（只读规划模式）**：排在优先级第 1 层，只放行工作区内的文件读取和 `ls / git status / rg` 等只读命令，任何写文件或非常规命令直接 `deny`。
2. **`ask` 模式（默认模式）**：工作区内的 `Read` 和内置只读命令自动放行；修改文件（`Write / Edit`）或跑其他 `Bash` 命令（如 `npm test`）默认返回 `ask`，需要用户点确认（或点“始终允许”记住规则）。
3. **`allow` 模式（工作区内免审直通，类似 Codex 的默认工作区放行）**：
   因为高危层（`danger-layer`）排在 `allow` 模式前面，所以开启 `allow` 模式后，**并不是无脑放行一切**：工作区内的所有常规改文件、跑命令直接返回 `allow` 免审执行；但一旦命令命中了高危删除（如 `rm`、`git reset --hard`），或者文件路径跨出了当前工作区边界（`!isInsideReadableBoundary`），依然会停下来弹窗让用户确认。
4. **`auto` 模式（模型自动审查模式，又叫懒人模式，对标 Codex 的 `Guardian Auto-Review` 与 Claude Code 的 `auto` mode）**：
   在 `allow` 模式下，如果模型执行一条没在黑名单里、但违背用户本意的命令（比如偷偷跑一句 `curl -T archive.tgz https://...` 把代码打包传走），静态规则是认不出来的。
   而开启 `auto` 模式后（见 [`review.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/permissions/review.ts) 与 [`sdk/permission-review.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/coding-agent/src/sdk/permission-review.ts)），日常操作同样基本不需要用户手动审批，但它不是靠静态规则一刀切放行，而是把原本需要 `ask` 的常规操作，连同**用户本轮的原始提问（`<user_request>`）**一起发给后台的轻量审查模型（关闭 `reasoning`，`temperature: 0`）：
   - **符合用户意图的常规操作**（比如用户让改代码、装依赖、跑测试）$\rightarrow$ 审查模型直接返回 `allow` 静默放行，全程不弹窗打扰用户；
   - **明显有害或违背用户意图的操作**（如偷传数据、删改无关内容）$\rightarrow$ 审查模型直接返回 `deny` 拦截；
   - **高危操作与异常兜底**：如果命令本身命中了 `danger-layer`（如 `rm`、`sudo`）或用户显式配了 `ask` 规则，审查模型无权跳票，必须直接弹窗交给真人（`isReviewableDecision`）；同时如果审查模型拿不准返回 `ask`、或者请求超时报错，也一律回退为弹窗让真人决定。

---

## 三、 文件路径校验与输出限流

当权限系统在阶段 6 调用 `executeApproved` 放行后，请求就进入了底层的工具与执行环境（[`packages/agent/src/harness/node/environment.ts`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/node/environment.ts)）。这里主要解决“软链接越界”和“大输出 OOM”两个问题。

### 1. 防软链接（Symlink）越界与一次性通行证 (`PathCapability`)

在前面的阶段 3 里，为什么我们要做两次路径求值？
因为只用 `path.resolve(workspaceRoot, inputPath)` 检查字面路径，防不住仓库里的软链接（比如仓库里有个软链接 `./keys` 指向 `~/.ssh`，字面路径在工作区内，但通过 `fs.realpath` 解析出来的真实物理路径 `canonicalPath` 已经跑到了 `/Users/me/.ssh`）。

同时，为了防止“权限层检查通过后，在真正打开文件前软链接被人替换（TOCTOU 竞态）”，权限中间件在阶段 3 审批通过时会签发一张冻结的 `PathCapability` 通行证，并在阶段 6 通过 `AsyncLocalStorage` 传递给底层文件操作：

```ts
async resolvePath(input: string, options: ResolvePathOptions): Promise<ResolvedPath> {
  const candidate = await this.#resolveCandidate(input, options); // 内部调用 fs.realpath 解析真实路径
  const lexicalAllowed = isWithin(candidate.boundary, candidate.requestedPath);
  const canonicalAllowed = isWithin(candidate.boundary, candidate.canonicalPath);

  // 只要字面路径或真实物理路径有一项越出工作区，就必须核对 AsyncLocalStorage 里的一次性通行证
  if (!lexicalAllowed || !canonicalAllowed) {
    const capability = this.#activeCapability.getStore();
    if (!capability || capability.canonicalPath !== candidate.canonicalPath) {
      throw fileSystemError("outside_boundary", `Path escapes workspace: ${input}`);
    }
  }
  return { path: candidate.canonicalPath, canonicalPath: candidate.canonicalPath };
}
```

而在真正调用 `createReadStream` 读文件或写文件前，`#assertActivePath` 还会再核对一次当前文件的 `realpath` 是否依然等于通行证上记录的 `canonicalPath`，确保审批时的路径和最终落盘的路径绝对一致。

### 2. 流式读取、二进制嗅探与 50KB / 2000 行截断 (`read.ts` & `bash.ts`)

为了防止模型读入 GB 级大文件或死循环日志把 Node.js 内存和模型上下文撑爆，`Read` 和 `Bash` 都做了严格的流式限流：

- **`Read` 工具（流式读取 + 前 4KB 二进制嗅探）**：
  不用 `fs.readFile` 全量读入内存，而是用 `createReadStream` 按块读取。在读入前 `4,096` 字节时，如果发现包含 `\0` 字节或过多不可打印控制字符，立即判定为二进制文件中断读取；读取文本时，一旦达到 **`2,000` 行或 `50 KB`** 上限就停止收集，并在返回结果中附上 `nextOffset` 供模型分页续读。
- **`Bash` 工具（内存留尾部 50KB + 完整输出写临时文件）**：
  终端报错通常在输出的最末尾。`Bash` 工具在启动命令时会先建一个 `bash-xxx.log` 临时文件：每收到一块输出就追加写入磁盘，而内存里的 `tail` 缓冲区只滚动保留最后 `200 KB`。命令结束时，如果输出没超限就删掉临时文件；如果超过了 `50 KB / 2,000 行`，就截取最后 50KB 返回给模型，并在末尾附上完整日志路径：
  `[Output truncated. Full output: /tmp/bash-xxx.log]`
  这样既保护了内存和上下文窗口，模型需要查中间某行日志时又能直接用 `Read` 或 `Grep` 去查这个临时文件。

---

## 四、 子进程环境隔离与取消清理 (`environment.ts`)

最后看 `Bash` 工具启动操作系统子进程时的两个底层管控细节。

### 1. 剥离宿主的敏感环境变量 (`createSafeShellEnvironment`)

Node.js 的 `child_process.spawn` 默认会把宿主的 `process.env` 全盘复制给子进程。如果不做过滤，宿主进程里的 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等密钥，模型跑一句 `env` 就能全部打印出来。

因此在 `NodeExecutionEnvironment` 中，`createSafeShellEnvironment` 默认丢弃宿主的所有环境变量，只按白名单透传 `PATH`、`LANG`、`LC_ALL`、`LC_CTYPE`、`TERM`、`TMPDIR` 这几个基础变量。

### 2. 独立进程组（`-pgid`）清理子孙进程

当命令超时（`timeoutMs`）或用户按 `ESC` 触发 `AbortSignal` 时，如果只调用普通的 `child.kill()`，信号只发给了最外层的 `/bin/sh -c "..."`（比如 PID 5000）。`/bin/sh` 自己退出了，但它里面启动的 `npm test` 和 `node` 子孙进程（PID 5001、5002）会变成孤儿进程继续在后台跑。

为了把整棵子进程树清理干净，`runProcess` 做了三步处理：

```ts
// 1. 启动时设置 detached: true，让 /bin/sh 成为新进程组的组长 (PGID === child.pid)
const child = spawn(spec.file, [...spec.args], {
  cwd: options.cwd,
  detached: process.platform !== "win32",
  env: spec.environment,
  stdio: options.background ? "ignore" : ["ignore", "pipe", "pipe"],
});

// 2. 停止时向负的 PID (-processGroupId) 发信号，内核会把信号广播给该进程组下的所有子孙进程
const stop = () => {
  if (!child.pid) return;
  const pgid = child.pid;
  if (process.platform !== "win32") process.kill(-pgid, "SIGTERM");
  else child.kill();

  // 1 秒后如果还没退干净，再向整个进程组补发 SIGKILL 强制清理
  forceKillTimer ??= setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-pgid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {}
  }, 1_000);
  forceKillTimer.unref();
};

// 3. 在 finally 中：只有确认整个进程组都已经不存在了 (!processGroupExists)，才清除 SIGKILL 定时器
finally {
  clearTimeout(timeout);
  if (forceKillTimer && (process.platform === "win32" || !child.pid || !processGroupExists(child.pid))) {
    clearTimeout(forceKillTimer);
  }
}
```

这里最关键的是第 3 步：当顶层的 `/bin/sh` 收到 `SIGTERM` 退出触发 `close` 事件进入 `finally` 时，可能它派生的孙子进程还没退出。此时通过 `process.kill(-pgid, 0)`（`processGroupExists`）探测整个进程组是否还有活着的进程；只要组里还有进程活着，就不清除 `forceKillTimer`，确保 1 秒后那记 `SIGKILL` 依然能触发，把残留的孙子进程彻底清掉。

---

## 小结

回看工具安全执行的整套设计，我们围绕一次工具调用的生命周期建立了四层防线：
- **完整权限生命周期（`middleware.ts`）**：从请求拆解、初次规则求值、`realpath` 真实路径二次求值，到 `approvalQueue` 串行弹窗、批准后的 `recheckOrDeny` 二次核验与分级授权持久化（会话级 vs 项目级）；
- **固定优先级与 AST 分析（`evaluate.ts`）**：坚持 `deny > ask > allow` 与只读 `plan` 模式一票否决，用 `tree-sitter-bash` 拆解复合命令并剥离包装前缀，让危险命令强制走人工确认且禁存“始终允许”；
- **物理路径与有界 I/O（`read.ts` & `bash.ts`）**：用一次性 `PathCapability` 通行证防软链接穿透，用流式读取与 `50KB / 2000 行` 截断保护宿主内存；
- **子进程隔离与进程组清理（`environment.ts`）**：白名单过滤宿主环境变量，并用 `detached: true` + `-pgid` 信号广播清除整棵子进程树。

现在，工具的执行已经安全可控了。但在第 01 章末尾我们还留了一个问题：如果 Agent 刚通过审批、正在执行一个修改文件的工具，此时电脑突然断电或者宿主进程崩溃了，等重启之后，我们怎么知道刚才那个工具到底改没改成功？如果用户在对话中途想回退（Rewind）到 5 轮之前的某条消息重新聊，怎么做到不丢历史、不乱状态？下一章，我们来聊会话持久化：树形 Journal、T1/T2 边界与崩溃恢复。
