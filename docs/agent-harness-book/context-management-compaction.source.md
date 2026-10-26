# 上下文管理、KV Cache 断点与 Compaction (packages/agent)

上一章我们搭好了 `agentLoop` 的多轮调度骨架。只要模型还想调工具，主循环就会一直把 `ToolResultMessage` 追加到 `context.messages` 里，发起下一轮请求。

在跑三五轮的简单任务时，这个机制没有任何问题。但只要拿它去跑一个稍微真实点的编码任务——比如让 Agent 重构一个模块，前前后后读了十几个源码文件、跑了五六次测试——马上就会撞上两堵墙：
1. **输入 Token 随轮次累加**：大模型的 HTTP 接口是无状态的，每一轮 Turn 都要把从第 1 轮开始攒下的所有消息重新发一遍。因为每一步都在往上下文里塞文件内容和终端输出，Agent 的输入与输出 Token 比例极度悬殊（往往达到 100:1），越往后跑，单次请求越贵、首字延迟（TTFT）越慢。
2. **上下文窗口有上限**：几个大文件的 `Read` 输出加上几次长日志的 `Bash` 报错，迟早会把上下文窗口塞满，触发 `400 Bad Request: prompt is too long`。

如果把时间拨回 **2023 年初到 2024 年上半年（Prompt Caching 诞生之前）**，那时候所有发给模型的 Input Token 都要按全价计费，多发一个字就多花一个字的钱。为了在有限的窗口和昂贵的账单下活下来，当时的开源项目探索出了四套方案：

- **AutoGPT（2023 年 4~6 月）：短期 FIFO 队列 + 向量检索 / 批次滚动摘要**
  在 `gpt-3.5-turbo` 只有 4k 窗口的时期，早期 AutoGPT（[0.2.1 架构](https://www.georgesung.com/ai/autogpt-arch/)）在内存里只保留最近 9 条短期消息，把其余历史用 `ada-002` 转成向量存进 Pinecone / FAISS，每轮检索 Top-10 塞回 Prompt；后来因为向量检索频繁丢失关键步骤，又在 2023 年 6 月的 [PR #4652](https://github.com/Significant-Gravitas/AutoGPT/pull/4652) 中改成 `update_running_summary`，每攒够一小批消息就调模型更新一次头部的滚动摘要。
- **MemGPT（2023 年 10 月）：仿操作系统虚拟内存的分页换入换出**
  UC Berkeley 在 [MemGPT 论文 (arXiv:2310.08560)](https://arxiv.org/abs/2310.08560) 中把上下文当成有限的物理内存：当 Token 达到 70% 水位线时注入一条 `"memory pressure"` 系统警告，让模型自己调函数把关键信息写进外部数据库；达到 100% 时强制驱逐队列前 50% 的消息并生成递归摘要。
- **Aider（2023 年 ~ 2024 年初）：基于 PageRank 每轮动态重算 Repo Map**
  Aider 在 [Repository Map 设计](https://aider.chat/docs/repomap.html) 中用 `tree-sitter` 提取代码库符号并构建依赖图，在**每一轮对话时根据当前聊到的文件动态跑一次 PageRank**，挑出当前最相关的代码签名塞进 1k tokens 的预算里。
- **SWE-agent（2024 年 5 月）：滑动折叠 5 步之前的工具输出（Observation Collapsing）**
  到了 2024 年 5 月，即使有了 128k/200k 窗口的 GPT-4 Turbo 和 Claude 3 Opus，普林斯顿团队在 [SWE-agent 论文 (arXiv:2405.15793)](https://arxiv.org/abs/2405.15793) 第 3 节中依然采用了一套精打细算的策略：**只保留最近 5 步（Last 5 Observations）的完整终端输出，每往前走一步，就把倒数第 6 步的工具输出原地折叠成一行 `"Old output omitted (N lines)"`**。在当时的消融实验（Table 3）里，这种“每步原地删减旧输出”的做法既省下了大量全价 Token，还把 SWE-bench Lite 的解决率从 15.0% 提到了 18.0%。

直到 **2024 年 8 月 14 日** Anthropic 上线 [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)（随后 OpenAI 在同年 10 月 1 日上线自动 Prefix Caching），整套成本账的底层逻辑被彻底改写了。

在支持 KV Cache 的接口上，命中缓存的输入 Token 价格直接降到了正常价格的 **1/10**（以 Claude Sonnet 为例，未命中 `$3.00 / MTok`，命中缓存读取仅 `$0.30 / MTok`），首字延迟也能缩短 70% 以上。但 KV Cache 有一个铁律：**由于自回归模型的注意力计算依赖前序全部 Token 的键值状态，缓存命中要求发过去的文本前缀必须与上一轮从第 1 个 Token 开始一字不差。**

在这个铁律下，2023~2024 上半年那套“每轮动态修剪上下文”的最佳实践，一夜之间变成了毁掉缓存的反模式：
- 如果像 AutoGPT 或早期 Aider 那样，每轮在 Prompt 头部动态替换向量检索结果或重排 Repo Map，你的请求前缀从开头就变了，每一轮的缓存命中率都是 0%；
- 如果像 SWE-agent 那样，在第 15 轮去把第 10 轮的工具输出原地改成 `"Old output omitted"`，那么从第 10 轮往后的几万 Token 缓存瞬间全部作废——为了省第 10 轮那几百个 Token，反而要为后面几万个 Token 重新支付 10 倍的全价。正如 Armin Ronacher 后来在 [Agent Design Is Still Hard](https://lucumr.pocoo.org/2025/11/21/agents-are-hard/) 中总结的那样：*“Unfortunately, context editing will automatically invalidate caches. There is really no way around it.”*

因此，在 Prompt Caching 出现之后，现代 Agent Harness 的上下文工程彻底转向了**“平时保住前缀吃缓存、快满时一次性压缩”**的两步设计：
1. **平时只往末尾追加消息，不动前面的内容**：哪怕旧的工具输出有点长，只要它已经进了缓存（只收 1/10 的钱），就原封不动留着它；
2. **快撑满窗口时，再集中做一次压缩（Compaction）**：一直攒到上下文真正逼近窗口上限，才把前面的长历史总结成一段摘要，开启下一个缓存周期。

这篇笔记我们结合 [packages/ai/src/providers/anthropic.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/ai/src/providers/anthropic.ts) 和 [packages/agent/src/harness/compaction](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/compaction) 的源码，一步步拆解这两部分的实现。

---

## 第一步：给请求打缓存标记

先看第一步：在没有触发压缩的日常轮次里，怎么让每一轮请求都吃满 90% 的缓存折扣？

大模型的输入按顺序由三部分拼成：`System Prompt -> Tools 工具定义 -> Messages 消息列表`。
像 OpenAI 的接口是服务端自动按前缀匹配缓存，而 Anthropic 则要求调用方在请求体里显式塞入 `cache_control: { type: "ephemeral" }` 标记（最多允许打 4 个点）。

非常容易想到，我们会最先在系统提示词上面打一个缓存点，因为系统提示词是不容易发生改变的。在 [packages/ai/src/providers/anthropic.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/ai/src/providers/anthropic.ts) 中，我们在把请求发往网络前，固定在三个位置打上了缓存标记：

```text
[1. System Prompt]  ──►  [2. Tool Definitions]  ──►  [3. Messages: msg_1, msg_2, ..., msg_N]
        ▲                          ▲                                                    ▲
   缓存点 1 (固定)            缓存点 2 (固定)                               缓存点 3 (每轮跟着最后一条 user 消息往后挪)
```

1. **缓存点 1（系统提示词末尾）**：锁死全局指令。这也要求我们**绝不能把当前时间（如 `new Date()`）或随时变化的 Git 分支状态直接拼进 System Prompt**，否则每一秒发出的请求从第 1 段起就无法命中缓存。
2. **缓存点 2（最后一个工具定义末尾）**：在 `convertTools` 里给数组最后一个工具打上标记，锁死整套工具的 JSON Schema。因此工具列表的顺序必须固定，不能在每轮之间随便增删或乱序排列工具。
3. **缓存点 3（最后一条 `user` / `toolResult` 消息末尾）**：这是让多轮对话滚动命中缓存的关键。

来看看 `applyCacheBreakpointToLastUser` 的代码：

```ts
// 从后往前找最后一条 user 消息（Anthropic 协议里 toolResult 也归在 user 角色下）
function applyCacheBreakpointToLastUser(params: MessageParam[]): void {
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i];
    if (p.role !== "user" || !Array.isArray(p.content)) continue;
    const last = p.content[p.content.length - 1];
    if (last) {
      last.cache_control = { type: "ephemeral" };
    }
    break;
  }
}
```

它为什么能省钱？我们看连续两轮请求的変化：
- **第 1 轮**：消息列表是 `[user_1, assistant_1, toolResult_1]`。函数在 `toolResult_1` 末尾打上标记，服务端把这 3 条消息缓存起来。
- **第 2 轮**：模型刚回复了 `assistant_2`，工具跑完追加了 `toolResult_2`，现在列表变成了 `[user_1, assistant_1, toolResult_1, assistant_2, toolResult_2]`。函数把标记挪到了 `toolResult_2` 末尾。

服务端收到第 2 轮请求时，发现前 3 条消息 `[user_1, assistant_1, toolResult_1]` 和上一轮缓存的内容一字不差，直接按 1/10 的价格走 `cache_read`；只有新追加的 `assistant_2` 和 `toolResult_2` 需要计算并写入新缓存。

---

## 第二步：何时触发压缩

靠着上面的缓存标记，Agent 可以低成本地跑几十轮。但缓存只能省钱和提速，不能突破模型的上下文窗口上限（比如 200k tokens）。我们得在每一轮发请求前算一下当前攒了多少 Token，快满的时候提前触发压缩。

这里马上会遇到一个实际问题：**怎么在本地知道当前上下文有多少 Token？**

如果引入 `tiktoken` 这样的本地分词库，一来不同厂商（Claude、OpenAI、Gemini、DeepSeek）的词表各不相同，二来工具定义的 JSON Schema 和图片在服务端拼装后的实际 Token 数本地根本算不准；但如果纯靠“字符数除以 4”来硬猜，误差又可能高达 20%~30%。

仔细想一下，其实我们手里有一个**绝对准确的数字**：上一轮模型刚返回的那条 `AssistantMessage` 里，自带了服务端结账时算好的 `usage.totalTokens`！

所以在 [packages/agent/src/harness/compaction/estimate.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/compaction/estimate.ts) 中，`estimateContextTokens` 采用了**“上一轮真实账单 + 本轮新增估算”**的做法：

```ts
export function estimateContextTokens(context: AgentContext, entries?: readonly SessionEntry[]): ContextTokenEstimate {
  const fullEstimateTokens = estimateTokens(context); // 全量按 chars / 4 粗估兜底
  const lastUsageIndex = findLastUsageIndex(context.messages);
  const stale = entries !== undefined && compactedAfterLastUsage(entries);

  // 如果还没有调过模型，或者上一轮之后刚发生过压缩（旧账单已作废），就用粗估值
  if (lastUsageIndex === undefined || stale) {
    return { tokens: fullEstimateTokens, /* ... */ };
  }

  // 拿上一轮服务端返回的真实 totalTokens，加上上一轮之后新增消息的估算值
  const usageTokens = (context.messages[lastUsageIndex] as AssistantMessage).usage.totalTokens;
  const trailingTokens = context.messages
    .slice(lastUsageIndex + 1)
    .reduce((total, message) => total + estimateTokens(message), 0);

  return {
    tokens: Math.max(usageTokens + trailingTokens, fullEstimateTokens),
    // ...
  };
}
```

这个算法非常务实：前几十轮攒下的几万个 Token 直接采信服务端的精确 `usageTokens`，只有刚刚追加在最后的那一两条 `toolResult` 或用户新消息（`trailingTokens`）才用 `字符数 / 4` 估算。

拿到当前的 Token 数后，只要满足下面这个条件就触发压缩：

```ts
export function shouldCompact(contextTokens: number, model: Model, settings: CompactionSettings): boolean {
  return contextTokens > model.contextWindow - settings.reserveTokens;
}
```

这里的 `reserveTokens`（默认取 `model.maxTokens + 4096`，夹在 8k 到 20k 之间）是特意留出来的安全缓冲：不能等 200k 窗口填到 199k 才去压缩，因为当前这一轮模型自己还要输出几千个 Token 的回复。

---

## 第三步：压缩时怎么才不会触发 400 报错

假设现在 200k 的窗口已经用到了 185k，触发了自动压缩。

这时候如果把全部 100 条历史消息一锅端，统统压成一段几百字的摘要，Agent 马上就会傻掉——因为它刚读完的源码行号、刚看到的报错堆栈全变成了笼统的概括，下一轮根本没法精确调用 `Edit` 修改代码。

所以在压缩时，必须**把前面老的历史压成摘要（`messagesToSummarize`），同时原封不动地保留最近几轮对话的原文（`messagesToKeep`，默认保留最近 2 个 Turn、最多 8,000 tokens）**。

但在切分“哪些拿去压、哪些留下来”以及把摘要拼回去的时候，有两个非常容易引发 `400 Bad Request` 的坑（代码位于 [packages/agent/src/harness/compaction/projection.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/compaction/projection.ts)）：

### 1. 切分位置不能把 `toolCall` 和 `toolResult` 劈成两半

这里首先要澄清一个常见的直觉误区：在前端聊天界面（UI）上，我们看到的“调用 `Read("a.ts")`”和它返回的“文件内容”通常是合并在同一个折叠卡片里展示的，看起来好像结果是直接回写进工具调用对象里的。

但在底层的 `context.messages` 数组和大模型 API 协议里，**它们并不是同一条消息，而是前后相邻的两条独立消息**：
1. 先是一条模型发出的 `role: "assistant"` 消息，里面装着 `toolCall`（比如 `id: "call_1"`，请求读 `a.ts`）；
2. 工具跑完后，并不是去修改刚才那条 `assistant` 消息，而是往数组末尾新 `push` 一条独立的 `role: "toolResult"` 消息（带着 `toolCallId: "call_1"` 和文件内容）。

理解了这个底层结构，就能明白切分数组时为什么会踩坑了。假设一轮对话在 `messages` 数组里有这么 5 条消息：

```text
0. [user]:       "帮我看看 a.ts 并修掉 bug"
1. [assistant]:  发起工具调用 Read("a.ts")    (id: "call_1")
2. [toolResult]: "a.ts 的文件内容..."         (对应 toolCallId: "call_1")
3. [assistant]:  发起工具调用 Edit("a.ts")    (id: "call_2")
4. [toolResult]: "修改成功"                   (对应 toolCallId: "call_2")
```

如果我们在做压缩切分时，不小心在 **下标 1 和下标 2 中间** 切了一刀（把 `0, 1` 压成摘要，保留 `2, 3, 4`），那么拼出来发给模型的列表就会变成：

```text
0. [user]:       "之前对话的摘要：用户让我修 a.ts..."
1. [toolResult]: "a.ts 的文件内容..."         (对应 toolCallId: "call_1")  <-- 💥 报错！
2. [assistant]:  发起工具调用 Edit("a.ts")    (id: "call_2")
3. [toolResult]: "修改成功"                   (对应 toolCallId: "call_2")
```

你看新的第 1 条消息：它上来就说“我是 `call_1` 的返回结果”，但它的上一条（第 0 条）是摘要，刚才那条发起 `call_1` 的 `assistant` 消息已经被压进摘要里消失了。OpenAI 和 Anthropic 的接口一旦看到一条 `toolResult` 前面没有对应的 `assistant(toolCall)`，就会当场拒绝请求并返回 `400 Bad Request`。

因此在寻找切分点时，源码里专门加了一条边界检查 `isSafeBoundary`：

```ts
/**
 * toolResult 绝不能作为保留历史的第一条消息：声明它的 assistant 消息已经被压进摘要了。
 */
function isSafeBoundary(message: AgentMessage): boolean {
  return message.role !== "toolResult";
}
```

只要发现切分位置落在了 `toolResult`（比如上面的下标 2）上，就继续往后找，退到下标 3（`assistant`）再切，让下标 1 的调用和下标 2 的结果一起进摘要，确保保留下来的第一条消息永远是 `user` 或 `assistant`。

### 2. 摘要拼回去时，不能出现连续两条 `user` 消息

模型生成好摘要文本后，我们要把它包装成一条消息放到保留历史（`tail`）的最前面，格式大概是：
> `"The conversation history before this point was compacted into the following summary:\n\n<summary>...</summary>"`

这条摘要消息的角色自然是 `role: "user"`。但问题来了：如果后面保留下来的第一条消息（`tail[0]`）刚好也是用户的提问（`role: "user"`），直接拼在一起就会变成 `[user(摘要), user(提问), ...]`。

Anthropic 的接口要求 `user` 和 `assistant` 角色严格交替，不会替我们自动合并相邻的两条 `user` 消息。所以在 `buildCompactedMessages` 中，只要看到保留的尾巴是以 `user` 开头，就会把摘要直接合并进那条 `user` 消息里：

```ts
export function buildCompactedMessages(
  summary: string,
  timestamp: number,
  tail: readonly AgentMessage[],
): AgentMessage[] {
  const head = tail[0];
  // 如果保留的第一条消息本身就是 user，把摘要文本直接拼进它的开头，避免出现连续两个 user role
  if (head?.role === "user") return [mergeIntoUserMessage(summary, head), ...tail.slice(1)];
  return [toCompactionMessage(summary, timestamp), ...tail];
}
```

---

## 第三步：压完之后原历史怎么存？第二次再满怎么办？

摘要生成好了，切点也找好了。接下来是很多初次写 Compaction 的人最容易犯错的地方：**直接用 `messages.splice(...)` 把原数组里的老消息删掉，替换成那条摘要。**

### 1. 原消息一条不删，只追加一条压缩记录

在真实的桌面端或 CLI 产品里，你绝不能把用户的历史消息真删了：一来用户在界面上往上滚动时，还要看之前的完整对话和代码改动；二来用户随时可能点击某条旧消息“从这里回退（Rewind / Navigate）”。

所以在 `jai-mono` 里，原始消息记录（Session Entries）是 **只追加、绝不删改** 的。完成一次压缩，只是往日志末尾追加一条类型为 `"compaction"` 的记录，里面记下两个关键字段：**生成的摘要 `summary`**，以及**保留原文的起点 ID `firstKeptEntryId`**：

```text
Session 日志账本 (原消息一条不删):
  [msg_1] -> [msg_2] -> [msg_3 (id: "entry_3")] -> [msg_4] -> [compaction (summary, firstKeptEntryId: "entry_3")] -> [msg_5]
                                   ▲
                                   └────── 每次发请求前，只取 summary + 从 entry_3 开始往后的消息
```

每次准备向大模型发请求时，`projectCompactedMessages` 函数就从日志末尾倒着找到最新那条 `compaction` 记录，把它的 `summary` 和 `firstKeptEntryId`（即图中的 `msg_3`）往后的所有消息拼起来发给模型：

```ts
export function projectCompactedMessages(entries: readonly SessionEntry[]): AgentMessage[] {
  const index = entries.findLastIndex((entry) => entry.type === "compaction");
  if (index < 0) return contextEntries(entries).map((entry) => entry.message); // 没压过就全量返回

  const compaction = entries[index] as CompactionEntry;
  const before = contextEntries(entries.slice(0, index));
  const keepFrom = before.findIndex((entry) => entry.id === compaction.firstKeptEntryId);

  // 用最新一条摘要 + firstKeptEntryId 之后保留的消息，拼出本次发给模型的列表
  return buildCompactedMessages(compaction.summary, Date.parse(compaction.timestamp), [
    ...(keepFrom < 0 ? [] : before.slice(keepFrom).map((entry) => entry.message)),
    ...contextEntries(entries.slice(index + 1)).map((entry) => entry.message),
  ]);
}
```

这样一来，磁盘和 UI 里保存的永远是完整的原始历史，而模型看到的则是压缩后的轻量上下文。同时，这也开启了一个新的 KV Cache 周期：在接下来的第 51、52、53 轮里，`[summary + msg_3 + msg_4]` 又成了固定不变的新前缀，继续享受 1/10 的缓存读取价格。

### 2. 触发第二次、第三次压缩时，不重读整份历史

如果一个大型重构任务跑了上百轮，触发了第二次、第三次压缩，该怎么生成新摘要？

既然原消息一条没删，最笨的办法是把第 1 条到第 100 条消息全部拿出来重新总结一遍——但这会让压缩请求本身越变越慢，最后连压缩请求自己都超出了上下文窗口。

观察一下上面的结构就能发现：第 1 次压缩生成的 `previous.summary`，其实已经概括了 `firstKeptEntryId` 之前的所有历史。所以到了第 2 次压缩时，我们只需要把**“上一次的旧摘要（`<previous-summary>`）”**和**“上次 `firstKeptEntryId` 之后新产生的消息”**喂给模型，让它把这两部分合并（Fold）成一份新摘要即可（代码位于 [packages/agent/src/harness/compaction/compact.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/compaction/compact.ts)）：

```ts
function buildSummaryPrompt(input: {
  messages: readonly AgentMessage[]; // 只包含上次 firstKeptEntryId 之后的新增消息
  previous?: string;                 // 上一次压缩生成的旧摘要
  instructions?: string;
}): string {
  return [
    `<conversation>\n${serializeConversation(input.messages)}\n</conversation>`,
    input.previous ? `<previous-summary>\n${input.previous}\n</previous-summary>` : undefined,
    SUMMARY_CONTRACT,
    input.previous
      ? "The previous summary covers everything before the conversation above. Fold it into one complete summary; do not refer back to it."
      : undefined,
    // ...
  ].filter(Boolean).join("\n\n");
}
```

这样每次压缩要读的文本量只取决于“两次压缩之间新增了多少消息”，哪怕会话跑上千轮，每次压缩的耗时和成本也是恒定的。

>当然，这种压缩办法，会随着压缩的次数，模型逐渐失真，对前面了解的信息越来越少，因此也衍生出了各种压缩或者让模型外挂记忆的办法，这里只做最简单的办法。

---

## 兜底：要是没算准，还是超限了怎么办？

虽然我们在请求前做了 Token 估算，但有两类突发情况是前置估算拦不住的：
1. **输出时撞墙截断（`stopReason === "contextOverflow"`）**：发请求时离上限还有点距离，结果模型这一轮一口气吐了很长的内容，半路把窗口撑满被服务端截断了。
2. **输入时直接被拒（`400 prompt is too long`）**：比如本轮刚刚读入了一个包含大量特殊符号或 Base64 的文件，`字符数 / 4` 低估了实际 Token 数，请求发出去直接被模型接口 400 拒绝。

针对这两种情况，[packages/agent/src/harness/agent.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/agent/src/harness/agent.ts) 和 `overflow.ts` 做了最后两道自动恢复：

- **遇到上一轮输出被截断（`hasUncompactedTruncation`）**：
  还记得上一章 `runTurn` 里收到 `stopReason === "contextOverflow"` 时会保留半截消息并停止吗？到了下一轮 `prepareContext` 时，一旦检查到最后一条 `assistant` 消息是 `contextOverflow` 且后面还没有跟过 `compaction` 记录，就不再走普通的阈值判断，**无条件强制执行一次压缩**，把空间腾出来再发请求。
- **遇到请求直接报 400 超限（`isContextOverflow`）**：
  当模型请求报错时，进入 `onModelError` 回调。如果检查发现是明确的上下文超限错误（OpenAI 的 `code === "context_length_exceeded"` 或 Anthropic 的 `400 prompt is too long`），当场触发一次 `"overflow"` 压缩，并在确认压缩后的 Token 数确实变小且降到安全线以下后，自动拿着压缩后的新上下文重发一次请求：

```ts
private async onModelError(error: AssistantMessage, context: AgentContext): Promise<RetryModelCall | undefined> {
  // ...
  if (!compaction?.automatic || !isContextOverflow(error)) return undefined;

  const before = estimateTokens(context);
  const outcome = await this.runCompaction("overflow", { context, entries: this.ledger.log, /* ... */ });
  if (outcome.status !== "success") return undefined;

  const compacted = await this.projectContext(context, "overflow_retry");
  const after = estimateTokens(compacted);

  // 只有压缩后确实变小、且降到了阈值以下，才发起那唯一一次自动重试
  if (after >= before || shouldCompact(after, this.model, compaction.settings)) return undefined;
  return { type: "retry", context: await this.measured(compacted) };
}
```

这里有一个很关键的防死循环细节（Claude Code 官方文档曾把这种故障称为 `Autocompact is thrashing`）：如果压缩完之后算出来 `after >= before`（比如整段对话只有 1 条消息，但这 1 条消息本身就塞了一个 300k 的巨型文件，怎么压都压不小），就绝不发起重试，直接把错误抛出来，避免陷入“报错 -> 压缩没变小 -> 重试又报错”的死循环。

---

到现在为止，我们的 Agent 已经能调模型、能跑多轮循环、也能在长任务里管好自己的上下文和钱包了。但在让它真正动手修改本地代码、执行终端 `Bash` 命令之前，还有一个绕不开的安全问题：怎么知道模型发出的那条 `Bash` 命令是不是在偷偷删库或者越权访问工作区之外的文件？下一章，我们来聊权限系统、基于 `tree-sitter-bash` 的 AST 静态分析与审批拦截。
