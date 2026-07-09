---
title: 第二章：实现 AI Provider 层（part2）
date: 2026-07-04
tags:
  - ai
  - agent
draft: false
summary: 在静态消息类型之上定义流式事件协议和 EventStream 容器，再实现 Anthropic 与 OpenAI-compatible adapter，把不同模型 API 的原生流统一成可被 UI 和 Agent Loop 消费的事件流。
---

## 事件协议

上一篇定义了静态的数据类型。但 Provider 调用 LLM 时，不会一次性拿到完整的 `AssistantMessage`——它是一段一段流过来的：

```text
start → text_start → text_delta → text_delta → text_end → done
```

所以我们需要定义：这些"一段一段"的数据叫什么，用什么容器承载它们。

事件协议就是一个联合类型。每种内容块（text、thinking、tool call）都有 `start → delta → end` 三段生命周期，最后以 `done` 或 `error` 结尾：

```ts title="packages/ai/src/types.ts"
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "error" | "aborted">; error: AssistantMessage };
```

两个关键设计：

- **`partial`**：每个事件都带"到目前为止的完整消息快照"。消费方拿到任何一个事件，直接读 `partial` 就能渲染当前状态，不需要自己拼接。
- **`contentIndex`**：一条消息可能有多个块交错（先 thinking，再 text，再 tool call），`contentIndex` 告诉你这个事件对应 `partial.content` 的第几个块。

`error` 也携带 `AssistantMessage`——中断时已经生成的部分内容不能丢。

## EventStream

事件协议定义了数据形状，但还需要一个容器。核心问题：adapter 在不断 push 事件，消费方在异步读取，两边节奏不同步。

可以把 `EventStream` 想成快递站：adapter 是快递员不断送包裹（`push`），消费者来取（`for await`）。货先到就放货架（`queue`），人先到就登记排队（`waiting`），下一个包裹到了立刻通知。

它支持两种消费方式：

```ts
// 实时消费（UI 渲染）
for await (const event of stream) { ... }

// 只等最终结果（agent loop）
const message = await stream.result();
```

核心就在 `push`：先看是不是终止事件（决定要不要兑现最终结果），再决定这个包裹是直接交给等在门口的人，还是先放货架：

```ts title="packages/ai/src/event-stream.ts"
push(event: TEvent): void {
  if (this.done) return;

  if (this.isComplete(event)) {            // done / error → 兑现最终结果
    this.done = true;
    this.resolveResult(this.extractResult(event));
  }

  const waiter = this.waiting.shift();
  if (waiter) waiter({ done: false, value: event }); // 有人在等，直接送
  else this.queue.push(event);                        // 没人等，先囤货架
}
```

其余部分都是围绕这个模型的机械实现：`[Symbol.asyncIterator]`（让 `for await` 能取货）、`result()`（只等最终结果）、`end()` 与终止时唤醒所有等待者。完整代码见 [`event-stream.ts`](https://github.com/jiahao-jayden/jai-mono/blob/main/packages/ai/src/event-stream.ts)。

`EventStream` 本身不知道什么是 LLM 事件——它通过构造器的两个函数来判断"哪个事件是终止事件"和"怎么提取最终结果"。对应到我们的场景，只需要一个薄子类：

```ts
export class AssistantMessageEventStream
  extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}
```

## Provider 接口

数据类型、事件流都有了，最后一步：调用方用什么签名发起调用？

```ts title="packages/ai/src/provider.ts"
export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface Provider {
  readonly id: string;
  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
}
```

通用字段只保留四个——这是各家 API 都支持的最大公约数。Anthropic 的 thinking 预算、OpenAI 的 `reasoning_effort` 这些私有参数，走 `providerOptions`，按 provider id 分组，adapter 只读自己那组，其余忽略。这个设计借鉴了 opencode。

最重要的契约：**`stream()` 不抛异常。** 任何失败（网络、API 报错、abort）都变成 `error` 事件，保留已生成的部分内容。

## Anthropic Adapter

第一个真实的 adapter。一句话概括它做的事：**把统一的 `Context` 翻译成 Anthropic SDK 请求，把 SDK 的原生流翻译成统一事件。**

```ts title="packages/ai/src/providers/anthropic.ts"
export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    const stream = new AssistantMessageEventStream();
    this.run(stream, model, context, options);
    return stream;
  }

  private async run(stream, model, context, options): Promise<void> { /* ... */ }
}
```

`stream()` 同步返回——它启动 `run()` 但不 await，调用方拿到 stream 后再 `for await` 消费。

### 入向翻译

把统一 `Context` 翻译成 Anthropic 请求参数，核心是三件事：

1. **system prompt** 是顶层参数，不在 messages 里。
2. **消息映射**：`UserMessage` → `user`，`AssistantMessage` → `assistant`，`ToolResultMessage` → 合并进 `user` 的 `tool_result` block。
3. **工具定义**：TypeBox schema 本身是 JSON Schema，直接作为 `input_schema`。

### 缓存控制

Anthropic 的 prompt caching 是显式的——你在内容块上标 `cache_control: { type: "ephemeral" }`，告诉 API"从这里往上请缓存"。命中后 input token 便宜约 90%。对多轮 agent 来说这直接关系成本。

我们默认自动打 3 个缓存断点，不需要调用方操心：

1. **system prompt** — 整个 session 不变，命中率最高
2. **最后一个工具定义** — 工具列表通常固定
3. **最后一条 user message** — 让之前的全部历史进入缓存前缀

Anthropic 限制每个请求最多 4 个断点，我们固定用 3 个，留有余量。

### 出向翻译

Anthropic SDK 返回的原生流有六种事件（`message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`）。adapter 在一个 `for await` 循环里把它们翻译成统一事件，同时维护 `partial` 快照。整个 `run()` 包在 try/catch 里：正常结束发 `done`，异常发 `error`。

### blockStates：SDK 索引到统一索引的桥梁

出向翻译的核心难点：Anthropic SDK 用自己的 `event.index` 标识各 content block，但我们的 `output.content` 数组索引可能跟它对不上（比如跳过了不认识的 block 类型）。更关键的是，每个 block 在流式过程中有需要累积的临时状态。

我们用一个 `Map<number, BlockState>` 来解决：

```ts
interface BlockState {
  contentIndex: number;       // 对应 output.content 的位置
  partialJson?: string;       // tool call 的 JSON 碎片累积
  partialSignature?: string;  // thinking 的 signature 碎片累积
}

const blockStates = new Map<number, BlockState>();
```

流程是这样的：

```text
content_block_start { index: 0, type: "thinking" }
  → output.content.push({ type: "thinking", thinking: "" })
  → blockStates.set(0, { contentIndex: 0, partialSignature: "" })
  → 发 thinking_start

content_block_delta { index: 0, delta: { thinking: "让我想想..." } }
  → state = blockStates.get(0)  → contentIndex = 0
  → output.content[0].thinking += "让我想想..."
  → 发 thinking_delta

content_block_stop { index: 0 }
  → 发 thinking_end
  → blockStates.delete(0)  // 生命周期结束，清理状态
```

对于 tool call，`partialJson` 的作用更明显——SDK 把 JSON 参数拆成很多碎片发送：

```text
content_block_delta { index: 2, delta: { partial_json: '{"path":' } }
content_block_delta { index: 2, delta: { partial_json: '"/src/main.ts"}' } }
content_block_stop { index: 2 }
  → JSON.parse(state.partialJson)  // 最后一次性解析
```

这个设计的好处是：**对外暴露的 `output.content` 保持干净**（纯数据，没有临时字段），所有流处理的内部状态都收在 `blockStates` 里，block 结束时 `delete` 掉，互不污染。

对比 OpenAI adapter 的做法会有趣：OpenAI 没有显式的 block 生命周期事件，delta 里直接塞内容，需要我们用布尔标记（`textStarted`）和 `Map<index, ToolCallState>` 自行管理 start/end 时机。Anthropic 的协议更"结构化"，适配反而更直观。

### Usage 归一化

有一个容易踩的坑：Anthropic 报的 `input_tokens` **不包含**缓存部分，而我们的 `Usage.input` 要求是 inclusive total。adapter 必须做加法：

```ts
const input = usage.input_tokens
  + (usage.cache_read_input_tokens ?? 0)
  + (usage.cache_creation_input_tokens ?? 0);
```

## OpenAI-compatible Adapter

第二个 adapter，覆盖 OpenAI 以及所有兼容其 Chat Completions API 的提供商（DeepSeek、Groq、Together、OpenRouter 等）。

```ts title="packages/ai/src/providers/openai.ts"
export class OpenAIProvider implements Provider {
  readonly id = "openai-compatible";
  private readonly client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    const stream = new AssistantMessageEventStream();
    this.run(stream, model, context, options);
    return stream;
  }
}
```

`id` 是 `"openai-compatible"` 而不是 `"openai"`——因为这个 adapter 不只服务 OpenAI 官方，任何遵循 Chat Completions 协议的 API 都能用。

### 入向翻译

和 Anthropic 做同样的事（`Context` → SDK 请求参数），但映射规则不同：

| 差异点 | Anthropic | OpenAI |
|--------|-----------|--------|
| system prompt | 顶层 `system` 参数 | `{ role: "system", content: "..." }` 消息 |
| 图片 | base64 source 对象 | data URI（`data:image/png;base64,...`） |
| tool result | 合并进 `user` 消息的 `tool_result` block | 独立的 `{ role: "tool" }` 消息 |
| 工具 schema | `input_schema` | `parameters`（直接传 JSON Schema） |

还有一个兼容性分支：`max_tokens` vs `max_completion_tokens`。OpenAI 新 API 用后者，但一些兼容提供商（DeepSeek 等）还是要前者。我们从 `Model.compatibility.maxTokensField` 读取：

```ts
const maxTokens = options?.maxTokens ?? model.maxTokens;
if (compat.maxTokensField === "max_tokens") {
  params.max_tokens = maxTokens;
} else {
  params.max_completion_tokens = maxTokens;
}
```

另外，OpenAI 不需要我们手动打缓存标记——它的 prompt caching 是自动触发的。

### 出向翻译：没有显式 block 生命周期

这是和 Anthropic 最大的区别。Anthropic 的流是"结构化"的：

```text
Anthropic: content_block_start → delta → delta → content_block_stop
```

每个 block 有明确的开始和结束。但 OpenAI 的 `ChatCompletionChunk` 是"扁平"的——所有内容塞在一个 `delta` 对象里：

```text
OpenAI: chunk.delta = { content: "Hello", reasoning_content: null, tool_calls: null }
```

没有 block_start，没有 block_stop。这意味着**我们得自己管理 block 的生命周期**。

用三组状态标记来解决：

```ts
let textStarted = false;
let thinkingStarted = false;
const toolCalls = new Map<number, ToolCallState>();
```

规则很简单：
- 第一次收到 `delta.reasoning_content` → 发 `thinking_start`，标记 `thinkingStarted = true`
- 第一次收到 `delta.content` → 如果 thinking 还开着就先发 `thinking_end`，然后发 `text_start`
- 第一次收到 `delta.tool_calls[index=N]` → 发 `toolcall_start`
- 流结束时（`finish_reason` 到达）→ 关闭所有还开着的 block，发 `done`

### Tool call 累积

OpenAI 的 tool call 流式格式比较特别——它用数组 + index 来支持**并行工具调用**：

```text
chunk 1: delta.tool_calls = [{ index: 0, id: "call_abc", function: { name: "read_file" } }]
chunk 2: delta.tool_calls = [{ index: 0, function: { arguments: '{"path":' } }]
chunk 3: delta.tool_calls = [{ index: 0, function: { arguments: '"/src"}' } }]
chunk 4: delta.tool_calls = [{ index: 1, id: "call_def", function: { name: "ls" } }]
chunk 5: delta.tool_calls = [{ index: 1, function: { arguments: '{}' } }]
```

`index` 在这里的角色和 Anthropic 的 `event.index` 类似——标识"这个碎片属于第几个 tool call"。区别是：
- Anthropic 给每个 block（text/thinking/tool_use 都算）统一编号
- OpenAI 的 index 只在 `tool_calls` 数组内部编号，text 和 reasoning 没有 index

我们用 `Map<number, ToolCallState>` 按 index 累积：

```ts
interface ToolCallState {
  contentIndex: number;  // 对应 output.content 的位置
  id: string;
  name: string;
  partialArgs: string;   // JSON 碎片拼接
}
```

流结束时一次性 `JSON.parse(state.partialArgs)` 得到完整参数。

### Reasoning / Thinking

OpenAI 和 DeepSeek 在流式 chunk 的 delta 里用不同字段发送 reasoning tokens：

- OpenAI：`delta.reasoning_content`
- DeepSeek：也是 `delta.reasoning_content`（兼容）
- 某些提供商：`delta.reasoning`

我们嗅探两个字段，取第一个非空的：

```ts
const reasoningDelta =
  (delta.reasoning_content as string) ??
  (delta.reasoning as string);
```

同时记住用了哪个字段名（存在 `thinkingSignature` 里），以便下次请求时能正确回传。

### Usage 归一化

OpenAI 的 usage 在流的最后一个 chunk 里到达（需要请求时设 `stream_options: { include_usage: true }`）。

和 Anthropic 的关键区别：**OpenAI 的 `prompt_tokens` 已经是 inclusive 的**（包含了 cached 部分），不需要做加法。

```ts
export function makeUsage(raw) {
  const input = raw.prompt_tokens ?? 0;       // 已经包含 cached
  const output = raw.completion_tokens ?? 0;
  const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  return { input, output, cacheRead, cacheWrite: 0, reasoning, totalTokens: input + output, ... };
}
```

对比 Anthropic adapter：

| | Anthropic | OpenAI |
|--|-----------|--------|
| `input` 含义 | 需要 `input_tokens + cache_read + cache_write` | `prompt_tokens` 本身已经 inclusive |
| cache write | 有（`cache_creation_input_tokens`） | 无（OpenAI 不区分） |
| reasoning tokens | 无（thinking 不单独计费） | `completion_tokens_details.reasoning_tokens` |

### 两个 adapter 的对比总结

写完两个 adapter，可以感受到两大 API 协议的设计哲学差异：

|              | Anthropic                        | OpenAI                                 |
| ------------ | -------------------------------- | -------------------------------------- |
| 流事件结构        | 结构化（每个 block 有 start/delta/stop） | 扁平（所有内容塞在一个 delta 对象里）                 |
| Block 生命周期   | API 告诉你                          | 需要 adapter 自己管理                        |
| 状态管理         | `Map<sdkIndex, BlockState>` 统一映射 | 布尔标记 + `Map<toolIndex, ToolCallState>` |
| Tool call 编号 | 和 text/thinking 统一编号             | 仅在 tool_calls 数组内部编号                   |
| 缓存控制         | 显式标记 `cache_control`             | 自动，无需干预                                |
| Usage 口径     | `input_tokens` 不含缓存              | `prompt_tokens` 已含缓存                   |

但从调用方视角看，两个 adapter 暴露的接口完全相同：`provider.stream(model, context, options)` 返回 `AssistantMessageEventStream`。所有差异被封装在 adapter 内部，上层 agent loop 不需要关心底层是 Anthropic 还是 OpenAI。

## 让翻译函数简化

写完两个 adapter，我回头看 `run()` 时注意到一个问题：`eventStream` 是暴露给消费方的公共 API，却被当参数传进了每一个内部翻译函数。Anthropic 的 `applyBlockStart`、`applyBlockDelta`、`applyBlockStop`，OpenAI 的 `closeThinking`、`finalizeBlocks`，全都收一个 `eventStream`，一边翻译 SDK 数据一边 `eventStream.push()`。

这样写有三个麻烦。翻译和投递耦合在一个函数里，两个职责混着。想单测 `applyBlockDelta` 的翻译逻辑，得先造一个真的 `eventStream`。内部实现还知道了外层契约——按分层，只有 `run()` 该碰 `eventStream`。

opencode 的处理方式可以借鉴：它的 `step()` 是纯函数，接收 `(state, sdkEvent)`，返回 `(newState, events[])`，不碰任何 stream，上层 pipeline 负责把返回的事件推进流。

我把翻译函数改成同样的形状。签名从：

```ts
function applyBlockDelta(
  eventStream: AssistantMessageEventStream,  // 外层 API 侵入进来
  output: AssistantMessage,
  blockStates: Map<number, BlockState>,
  event: RawContentBlockDeltaEvent,
): void
```

改成：

```ts
function applyBlockDelta(
  output: AssistantMessage,
  blockStates: Map<number, BlockState>,
  event: RawContentBlockDeltaEvent,
): AssistantMessageEvent[]  // 只返回事件，不推
```

`run()` 里的循环收集返回值，统一投递：

```ts
for await (const event of response) {
  let events: AssistantMessageEvent[] = [];
  switch (event.type) {
    case "content_block_start": events = applyBlockStart(output, blockStates, event); break;
    case "content_block_delta": events = applyBlockDelta(output, blockStates, event); break;
    // ...
  }
  for (const e of events) eventStream.push(e);
}
```

OpenAI adapter 改动更大，因为它原来把 per-chunk 逻辑全塞在 `run()` 里，用了 `textStarted`、`thinkingStarted`、`toolCalls` 三个散落的局部变量。我把这些收进一个 `StreamState`，再把整段逻辑抽成 `applyChunk`：

```ts
interface StreamState {
  textStarted: boolean;
  thinkingStarted: boolean;
  toolCalls: Map<number, ToolCallState>;
}

function applyChunk(
  output: AssistantMessage,
  state: StreamState,
  chunk: ChatCompletionChunk,
  reasoning: boolean,
): AssistantMessageEvent[]
```

改完之后，整个包里 `eventStream.push()` 只出现在两个 `run()` 的那几行。翻译函数可以直接 `assert.deepEqual` 测返回的事件数组，不用 mock stream。`output` 还是那个可变快照，负责给每个事件带 `partial`；`eventStream` 退回它该在的位置，只在 adapter 和消费方之间传事件。

这套形状就是我们前面提过的 reducer：`(state, sdkEvent) → events[]`。区别是我们保留了 `output` 这个可变快照供 `partial` 用，没有像 opencode 那样把状态也做成不可变。

## 抽出统一的生命周期

翻译函数变纯之后，两个 `run()` 露出了一模一样的骨架：造一个空的 `output` 快照 → 发请求 → push `start` → 循环把每个 chunk 翻译成事件并 push → 检查 abort → 收尾 → push `done`；任何一步抛错就 push `error`。真正不同的只有三处：**怎么发请求、怎么翻译一个 chunk、流跑完后要不要收尾。**

既然骨架相同、差异明确，就把骨架抽成一个 driver，把差异做成三个回调：

```ts title="packages/ai/src/adapter.ts"
export interface AdapterSpec<TChunk> {
  request(): Promise<AsyncIterable<TChunk>>;    // 发起 SDK 请求
  step(chunk: TChunk): AssistantMessageEvent[]; // 翻译一个 chunk（纯函数）
  finalize(): AssistantMessageEvent[];          // 收尾，没有则返回 []
}

async function runAdapterStream(eventStream, output, signal, spec) {
  try {
    const response = await spec.request();
    eventStream.push({ type: "start", partial: output });

    for await (const chunk of response)
      for (const e of spec.step(chunk)) eventStream.push(e); // 翻译 + 投递

    for (const e of spec.finalize()) eventStream.push(e);
    eventStream.push({ type: "done", reason: output.stopReason, message: output });
  } catch {
    // 任何失败（含 abort）都转成 error 事件，保留已生成内容
    eventStream.push({ type: "error", reason: output.stopReason, error: output });
  }
}
```

（省略了 abort 判定、把错误信息写回 `output`、以及 `done`/`error` 的类型收窄——完整实现见 [`adapter.ts`](https://github.com/jiahao-jayden/jai-mono/blob/main/packages/ai/src/adapter.ts)。）

这下整个包里 `eventStream.push()` 只剩这一个地方——生命周期的唯一入口。上一节费劲把翻译函数从 `eventStream` 里摘出来，正是为了这一步能成立：`step` 是纯函数，driver 才能替它统一投递。

于是两个 provider 的 `run()` 塌缩成"注入三个回调"：

```ts title="packages/ai/src/providers/anthropic.ts"
private async run(eventStream, model, context, options): Promise<void> {
  const output = createAssistantMessage(this.id, model.id);
  const blockStates = new Map<number, BlockState>();

  await runAdapterStream(eventStream, output, options?.signal, {
    request: () => client.messages.create(/* buildParams(...) */),
    step: (event) => translateEvent(output, blockStates, event),
    finalize: () => [], // Anthropic 每个 block 都有显式 stop，不需要收尾
  });
}
```

OpenAI 的 `run()` 形状一模一样，只是换上自己的 `request`、`step`（`applyChunk`）和 `finalize`（`finalizeBlocks`——流结束时关闭还开着的 block、把累积的 tool call JSON 一次性 parse）。两个 adapter 最本质的差异——Anthropic 有显式的 block stop 事件、OpenAI 没有——现在浓缩成 `finalize` 一行就能看懂。

顺带把"造一个空快照"的 `createAssistantMessage` 也收进了 `adapter.ts`，两个 provider 共用，不再各写一遍。

---

到这里，两个 adapter 都完成了。下一篇进入工具参数校验和 Model Registry，把整个 `@jai/ai` 包收尾。
