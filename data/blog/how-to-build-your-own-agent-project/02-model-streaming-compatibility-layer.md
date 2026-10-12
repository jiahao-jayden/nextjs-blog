---
title: '在写 Agent Loop 之前：模型流式接入与兼容层设计 (packages/ai)'
date: '2026-10-13'
tags:
  - ai
  - agent
  - infra
draft: false
summary: '从 OpenAI Chat、Responses 与 Anthropic Messages 三种协议出发，拆解流式事件归一化、兼容性适配、KV Cache 断点与工具调用协议防御。'
images:
  - /static/images/model-streaming-compatibility-cover.webp
---


前几天看到 [@chasen_liao](https://x.com/chasen_liao) 发的那篇学习路线，想起这段时间一直在学习 Agent 相关的 Harness 工程，所以也想把自己的经验和踩坑的地方沉淀出来，也是呼应上这篇学习路线了。

[@chasen_liao](https://x.com/chasen_liao) 在文章里提到，要“先把一次模型调用看明白”，还要“分开理解模型类型和 API 协议”。

很多做 Agent 的项目一开始通常直接引用现成的 AI SDK（比如 Vercel AI SDK 或各种上层库）。但在开始写 [jai-mono](https://github.com/jiahao-jayden/jai-mono) 的时候，我没有直接用那些重型 SDK。一方面觉得它们封装层级太多、过于臃肿，隐藏了太多底层的通信细节，反而不利于深入理解真实的协议流转；另一方面，在读 Pi 的一位开发者的文章[Agent Design Is Still Hard](https://lucumr.pocoo.org/2025/11/21/agents-are-hard/) 时，作者也提到了为什么要坚持自己封装一套极简的模型接入层：
1. 不同的模型之间差异非常显著（缓存控制 `cache_control`、强化提示词、服务端原生工具如 `web search`）
2. 高阶 SDK 积累了大量历史包袱，你不得不迁就它的半成品抽象
3. 面对 Agent 这种长链路系统，“Directly targeting their SDKs keeps you fully in control” —— 自己基于各家底层 SDK 构建极简的确定性接入层，错误信息更清楚，缓存管理也更直接
当然，我觉得现在的 AI SDK、Lite LLM 都非常成熟，尽管如此，抱着学习的目的，可以直接从自己封装 AI SDK 开始写起。

但只要你决定自己写这一层，直接对接各家原生协议时，就会发现底层的接口差异比预期要繁琐得多：

1. **流式事件结构不统一**：OpenAI Chat API、Responses API 和 Anthropic Messages 的 SSE 增量事件定义完全不同。
2. **多轮对话协议约束**：像支持显式思考过程（Thinking / Reasoning）的模型，在多轮对话时要求必须把带签名的思考内容（`thinkingSignature`）原样回传，否则直接返回 400 校验错误；同时，某些开源的蒸馏或者微调模型有时会在正文里用 XML 文本模拟工具调用，如果不做协议拦截，可能会导致模型的注意力转移，直接污染会话历史。
3. **KV Cache 命中依赖精准断点**：为了控制长会话的延迟和费用，Anthropic 等供应商提供了 Prompt Cache 能力，但这依赖在请求中显式设置断点。
4. **参数与方言兼容性问题**：不同的供应商网关对输出上限参数的叫法不一致（`max_tokens` 与 `max_completion_tokens`），流式请求下有些网关不返回 `usage`，有些模型不支持结构化工具参数，这些差异如果不做处理，很容易导致请求失败或数据获取不一致。

如果把这些适配逻辑直接写在 Agent Loop 里面，主循环很快就会充斥着针对具体厂商的分支判断（`if (provider === 'anthropic') ...`），导致代码难以维护和测试。

为了直观看到这些底层差异，我们可以用同一个模型（以 Claude Sonnet 为例），分别通过目前最主流的三种协议请求一次，看看它们的返回结构究竟有什么区别。

---

## 真实环境下的三种协议分析

这里我统一传入同一个 get_weather(city: string) 工具：
* OpenAI Chat API：必须套两层结构：`{ type: "function", function: { name, description, parameters } }`。
* OpenAI Responses API：扁平了一层，但保留了 `type：{ type: "function", name, description, parameters }`。
* Anthropic Messages：直接就是工具本身，且参数字段名不叫 parameters，叫 `input_schema：{ name, description, input_schema }`。

向模型提问：“*What is the weather in Shenzhen?*”，各协议返回的真实结果：
### 1. OpenAI Chat Completion (`/v1/chat/completions`)

这是目前开源社区使用最广泛的接口：

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "toolu_bdrk_01J1aGt...",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"Shenzhen\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 450,
    "completion_tokens": 53,
    "total_tokens": 503,
    "prompt_tokens_details": {
      "cached_tokens": 0
    }
  }
}
```

这个协议其实不是最早的接口，它前面还有更早的纯文本续写接口（`/v1/completions`）。2023 年 ChatGPT 爆发时，OpenAI 在旧接口上改造出了基于角色的多轮对话协议。但因为历史包袱，它保留了 `choices` 数组（老一代允许一次生成多个候选），文本默认为平铺字符串。后来行业开始做 Agent，OpenAI 又在上面陆续打了 `functions`、`tools`、`response_format` 等补丁，导致字段嵌套层级很深。

它的结构特点：
- 工具调用挂在 `message.tool_calls` 旁路数组里，而不是正文内容块；当模型触发工具调用时，`content` 经常为 `null`。
- `arguments` 返回的是**未解析的 JSON 字符串**（`"{\"city\": \"Shenzhen\"}"`），业务层必须自行 `JSON.parse`，并承担解析失败的异常捕获。
- 停止原因是通用的字符串标记 `finish_reason: "tool_calls"`。
- 字段嵌套层级极深：取工具名需要一路点查到 `choices[0].message.tool_calls[0].function.name`。
- 缓存属于“自动隐式匹配”：和 Anthropic 显式缓存不同的是，OpenAI 在服务端根据前缀自动匹配并返回 `usage.prompt_tokens_details.cached_tokens`，调用方无法在请求体中显式指定在哪个位置打缓存断点。

这里存在一个大坑，即使在使用类似 Seed、DeepSeek 的模型时，如果走的是 completions 协议，在遇到一些复杂的工具时，经常会出现 json 格式错误的情况。

### 2. Anthropic Messages (`/v1/messages`)

Anthropic 推出 API 较晚（2024），没有背负 OpenAI 从 GPT-3 续写时代遗留下来的历史包袱：

```json
{
  "id": "msg_bdrk_jcdb...",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_bdrk_01G4yXm...",
      "name": "get_weather",
      "input": {
        "city": "Shenzhen"
      }
    }
  ],
  "stop_reason": "tool_use",
  "usage": {
    "input_tokens": 449,
    "output_tokens": 52,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

它的结构更加扁平，直接去掉了无用的 `choices[0]`。内容天然采用块状结构（Content Blocks）：
- 工具调用不是挂在 message 的旁路字段，而是作为 `content` 数组里的一个一等公民块（Block，`type: "tool_use"`）。
- 参数字段叫 `input`，并且 Anthropic 在服务端已经解析成了完整的 JSON 对象（不需要上层业务手动 `JSON.parse`）。
- 停止原因具有明确的领域语义：在 chat completion 中超出长度是“length”，而 anthropic 里面是“max_tokens”，更符合直觉。
- 显式返回了 `cache_creation_input_tokens` 与 `cache_read_input_tokens`，让上层能明确感知到 Prompt Cache 的命中状态。

### 3. OpenAI Responses API (`/v1/responses`)

OpenAI 近期推出的新协议，旨在推倒重来，解决 Chat API 补丁过多的问题：

```json
{
  "id": "resp_msg_bdrk_sewr...",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "function_call",
      "id": "fc_18dd84...",
      "call_id": "toolu_bdrk_01Fb6G...",
      "name": "get_weather",
      "arguments": "{\"city\": \"Shenzhen\"}",
      "status": "completed"
    }
  ],
  "usage": {
    "input_tokens": 449,
    "output_tokens": 52,
    "total_tokens": 501
  }
}
```

请求字段从 `messages` 变成了更通用的 `input`，参数名换成了 `max_output_tokens`。在工具调用上：
- 工具调用变成了顶层的 output item（`type: "function_call"`）。
- 参数依然保留为未解析的 JSON 字符串 `arguments`，但同时存在 `id` 和 `call_id` 两个 ID 字段。
- 引入了明确的生命周期状态字段 `status: "completed"`。

当然还有 Google Gemini。早期的 Gemini 原生协议（`generateContent`）自成一派，字段叫法极为繁琐（`contents`、`parts`、`functionDeclarations`），在工程适配上很折磨人；不过 Google 新推出的 Interactions API（`/v1beta/interactions`）也换成了类似 Responses 的扁平设计（`input` + `tools: [{ type: "function" }]`）。这里先不做过多讲述了。

---

## 流式（SSE）切片对比：最大的工程陷阱

如果说非流式下各协议的字段差异还能靠写几个适配函数勉强对齐，那么到了流式传输（SSE）时，工具调用的碎片拼装才是最容易出问题的地方。

还是以模型调用 `get_weather(city: "Shenzhen")` 为例，看看三种协议真实推送给客户端的 SSE 事件流差异：

### 1. OpenAI Chat Completions 流式切片

```text
data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null,"index":0}],"usage":null}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"toolu_01...","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null,"index":0}],"usage":null}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\": \"Sh"}}]},"finish_reason":null,"index":0}],"usage":null}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"enzhen\"}"}}]},"finish_reason":null,"index":0}],"usage":null}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}],"usage":null}

data: {"choices":[],"usage":{"prompt_tokens":450,"completion_tokens":53,"total_tokens":503,"prompt_tokens_details":{"cached_tokens":0}}}

data: [DONE]
```

**特点与陷阱**：
- 没有事件命名（没有 `event:` 前缀），全是裸的 `data: {...}`，最后以 `data: [DONE]` 结尾。
- 工具名和 ID 只在第一帧提供，后续碎片的 JSON 字符串直接散落在 `choices[0].delta.tool_calls[0].function.arguments` 中；如果模型并发调用多个工具，需要依靠每个元素里的 `index` 字段在本地维护一个并行 buffer 字典去聚合。
- **流式默认不返回 Token Usage（大坑）**：按照 [OpenAI 官方文档对 `stream_options`](https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream_options) 的说明，开启流式时若不显式传 `"stream_options": { "include_usage": true }`，所有 chunk 的 `usage` 全是 `null`。而在传了该参数后，API 会在 `[DONE]` 之前额外推送一个专用的 usage chunk，但其 `choices` 是一个空数组 `[]`，如果业务代码未经保护直接访问 `choices[0]` 就会直接运行时报错。

### 2. Anthropic Messages 流式切片

```text
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01...","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"city\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":": \"Shen"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"zhen\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":52}}

event: message_stop
data: {"type":"message_stop"}
```

**特点**：
- 严格的状态机块模型：`content_block_start`（带上 `type: "tool_use"`、`id` 与 `name`）-> 多个 `content_block_delta`（字段叫 `partial_json`）-> `content_block_stop`。
- 每个块的生命周期边界极其明确，上层很容易写出基于 Block 的聚合状态机。
- 终态信息分工明确：`message_delta` 返回 `stop_reason: "tool_use"` 和输出 token 统计，最后由 `message_stop` 结束。

### 3. OpenAI Responses API 流式切片

```text
event: response.created
data: {"response":{"id":"resp_...","status":"in_progress",...},"type":"response.created"}

event: response.output_item.added
data: {"item":{"type":"function_call","id":"fc_...","call_id":"toolu_01...","name":"get_weather","arguments":"","status":"in_progress"},"output_index":0,"type":"response.output_item.added"}

event: response.function_call_arguments.delta
data: {"item_id":"fc_...","output_index":0,"delta":"{\"city\": \"S","type":"response.function_call_arguments.delta"}

event: response.function_call_arguments.delta
data: {"item_id":"fc_...","output_index":0,"delta":"henzhen\"}","type":"response.function_call_arguments.delta"}

event: response.function_call_arguments.done
data: {"item_id":"fc_...","output_index":0,"arguments":"{\"city\": \"Shenzhen\"}","name":"get_weather","type":"response.function_call_arguments.done"}

event: response.output_item.done
data: {"item":{"type":"function_call","id":"fc_...","arguments":"{\"city\": \"Shenzhen\"}","status":"completed"},"output_index":0,"type":"response.output_item.done"}

event: response.completed
data: {"response":{"status":"completed","usage":{"input_tokens":450,"output_tokens":53,"total_tokens":503}},"type":"response.completed"}
```

**特点**：
- 采用细粒度的 RPC 式事件名：`response.output_item.added` -> `response.function_call_arguments.delta` -> `response.function_call_arguments.done` -> `response.completed`。
- 每一帧事件在顶层自带 `sequence_number`，适合在不稳定网络下进行乱序重排与对齐。
- 服务端在触发 `response.function_call_arguments.done` 时已经把完整的 `arguments` 拼好返回了一次，降低了客户端拼接出错的概率。

如果让 Agent Loop 直接面对这三套完全不同的原生事件流，主循环里就必须常驻大量的累加缓冲区、流式状态机以及异常捕获逻辑。

---

## 统一抽象层：packages/ai 的职责

看完上面的三种真实返回，就不难理解为什么我们需要单独构建 `packages/ai`：

如果 Agent Loop 直接面对这三套不同的协议，不仅非流式的响应字段对不上，到了流式传输（SSE）时，Anthropic 的 `content_block_delta`、OpenAI 的 `choices[0].delta` 以及工具调用参数碎片的拼接逻辑，会把整个主循环彻底拖垮。

因此，`packages/ai` 的核心职责主要收敛在以下四个关键设计上：
1. **统一流式事件契约（双模 `EventStream`）**：对外只抛出标准化的文本、思考、工具碎片与终态消息，业务层免去拼装缓冲。
2. **三级 KV Cache 自动化排版**：出向序列化时自动推导断点，上层无需感知供应商私有标记。
3. **多模型输入安全转换（`transformMessages`）**：多模态非视觉降级与思维链签名保留。
4. **协议防伪与非原生工具调用拦截**：在底层清洗模型伪造的 XML 假调用，防止状态污染。

---

## 核心设计与技术切片
### 上层的调用者最期望的接口长什么样

面对分裂的底层，我们退后一步思考：如果抛开各家厂商的实现细节，上层 Agent 最理想的调用姿势是什么？

上层的诉求（业务层）非常纯粹：
> 我给你我当前的系统提示词（systemPrompt）、对话历史（messages）和可用工具（tools），你帮我流式跑起来，告诉我模型说了什么、要调什么工具。”

所以在 [packages/ai/src/types.ts](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/ai/src/types.ts) 里，我们首先确立的是一个完全 Provider-neutral（供应商中立）的纯净契约：

```ts
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools: Tool[];
}

export interface Provider {
  readonly id: string;
  readonly adapter?: ProviderAdapter;
  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
}
```

注意这个 `Context` 非常纯粹简单，他只有提示词、消息、工具，没有 OpenAI 的 `response_format` ，也没有 Anthropic 的 `cache_control`，无论上层切的是什么模型，Agent 实际上就关心这些，其他的都属于业务。

### 如何抹平请求差异
既然通用 Context 没有任何供应商私有字段，那脏活就必须在“离开本地、发往网络的前一步”由各家 Provider 适配器（Adapter）完成，这里会列出几个主要的差异：

#### A. 参数名与方言冲突的动态路由
- **输出上限参数打架**：Anthropic 至今依然严格使用必填字段 [`max_tokens`](https://docs.anthropic.com/en/api/messages#body-max_tokens)；OpenAI 的老模型叫 `max_tokens`，但在 o1 等新模型上官方已将其废弃，强制要求传 [`max_completion_tokens`](https://platform.openai.com/docs/api-reference/chat/create#chat-create-max_completion_tokens)（传错直接 400）；而在新的 Responses API 中又统一改名为 [`max_output_tokens`](https://platform.openai.com/docs/api-reference/responses/create#responses-create-max_output_tokens)。
- **流式 Usage 丢失**：按照 [OpenAI 官方对 stream_options 的说明](https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream_options)，流式默认不吐 Token 统计，必须显式附加 `"stream_options": { "include_usage": true }`；但部分开源本地网关（如早期版本的 vLLM）遇到这个未定义字段又会直接抛出 400 校验异常。
底层必须通过一套兼容性策略（`compatibility.ts`），根据当前模型的 `dialect` 自动决定字段名字与参数裁剪。

#### B. 工具定义 Schema 的物理重构
上层注册的工具只是普通的结构体，但发出去时：
- OpenAI 要求套两层结构：`{ type: "function", function: { ... } }`（参见 [OpenAI Function Calling 指南](https://platform.openai.com/docs/guides/function-calling)）；
- Anthropic 要求直接以顶层声明，且参数字段必须更名为 `input_schema`（参见 [Anthropic Tool Use 规范](https://docs.anthropic.com/en/docs/build-with-claude/tool-use#defining-a-tool)）；
- 如果开启了 [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)，Schema 允许打上 `strict: true`，但面对不支持该特性的第三方兼容网关，这一层必须自动剥离 `strict`，避免非法参数阻断。

#### C. 多模态能力的安全降级（transformMessages）
当对话历史里包含了图片，如果后续某些步骤切换到了纯文本代码模型，直接把带 `image` 块的消息发过去会直接导致 API 报错崩溃。

> 从技术角度考虑，可能就是报个错，错误丢给用户，但是从产品层面出发，Agent Harness 大部分也需要从产品角度思考，我们不能把模型的错误交给用户去评判（“我是否要切换模型”），而是交给 Agent，让 Agent 告诉用户当前没有视觉的能力。

适配器在序列化前必须做一次纯函数检查：如果模型能力（`model.input`）不支持图片，自动将图片块平滑替换为结构化占位符，保证长任务链路不中断。

#### D. 推理模型（Thinking）的档位映射与签名保全
- **思考预算归一化**：OpenAI 接受离散的 [`reasoning_effort`](https://platform.openai.com/docs/guides/reasoning)（`low` / `medium` / `high`），而 Anthropic 在开启 [Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) 时要求指定确切的整数预算 `budget_tokens`。上层只感知统一的档位枚举，由底层分别换算。
- **签名防崩防线**：支持显式思考过程的模型在多轮对话中，要求上一轮的 Thinking 块必须携带 `thinkingSignature` 原样送回；而如果跨厂商切换模型，这道转换层又必须负责将带签名的思考块降级为普通文本块，防止跨 Provider 校验失败。

#### E. 供应商专有的缓存断点自动排版
按照 [Anthropic 官方对 Prompt Caching 的规定](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)：
- 单个请求**严格限制最多只能设置 4 个断点**（`cache_control`）；
- 断点必须精确挂在对应的块级节点上。
适配器在序列化完成的瞬间，会自动按数学确定性打满 3 个核心位置（静态 System 末尾、最后一个 Tool Schema、以及最后一条 User 消息）。外部调用方完全不需要感知 `cache_control` 的存在，只要保持消息追加（Append-Only），底层就会自动压出最高的缓存命中率。

当然在实际开发的时候，可以不需要过多深入这些细节，毕竟都是脏活，我们只需要前人栽树，后人乘凉就可以了。

## 返回结果处理
请求发出去之后，网络层开始源源不断地吐 SSE 字节流（也就是前文实测抓包看到的那些 content_block_delta、choices[0].delta 碎片）。

这时候调用方内部产生了工程矛盾：
* 前端 UI 需要打字机效果，巴不得每个 text_delta 一到达就立刻触发重绘；
* Agent 状态机 根本没法消费碎片——在工具参数没有被拼成一个合法完整的 JSON 之前，Agent 既不能跑校验，也不能做执行。

如果把底层的原生 SSE 直接暴露给上层，调用方就得自己写死循环去累加字符串 buffer、自己用 Map 暂存 chunk，这会把主循环逻辑彻底拖垮。为了兼顾这两重诉求，我们在 packages/ai/src/event-stream.ts 中设计了支持“双模消费”的 EventStream：
```ts
export class EventStream<T, R = T> implements AsyncIterable<T> {
  // 1. 满足 UI：作为异步迭代器，实时抛出归一化后的增量事件
  [Symbol.asyncIterator](): AsyncIterator<T> { ... }

  // 2. 满足 Agent 状态机：作为 Promise，直接等待最终拼装校验完的完整结果
  result(): Promise<R> { ... }
}
```

底层适配器在后台静默完成那些繁琐的拼接工作（把 Anthropic 的 input_json_delta 累加成合法的 JSON 字符串）。 对外，调用方的代码变得极其优雅：
```ts
const stream = provider.stream(model, context);

// 前端需要打字机时：只管实时消费标准化的事件
for await (const event of stream) {
  if (event.type === "text_delta") updateUI(event.delta);
}

// Agent 主循环需要推进下一步时：直接一句话拿完整结果
const message = await stream.result(); // 拿到不可变且校验通过的 AssistantMessage
```

同时，这也是协作式取消（Abort）的安全边界：如果中途收到 AbortSignal，底层不会粗暴地把 Promise 抛出异常崩溃，而是捕获已接收的局部内容，附带 stopReason: "aborted" 生成部分消息返回，为后续任务保留断点续传的可能。

## 结果防伪
进出数据流都闭环了，最后还需要一道防线：模型输出的协议违规（Protocol Violation）。
在接入某些开源模型或微调蒸馏模型时，模型受训练数据污染，有时明明没有触发原生 Function Calling，却在文本正文里自作聪明地输出 XML：
```xml
我来帮你查询天气：
<invoke name="get_weather">
  <parameter name="city">Shenzhen</parameter>
</invoke>
```

如果没有底层防御，这段伪造文本就会被当作普通文字原样存进对话历史。在随后的几轮交互中，模型的注意力会被彻底带偏，甚至引发安全风险。

在 packages/ai/src/tool-protocol.ts 里，我们在出流的最后做了一道纯函数协议审计（assertNativeToolCallProtocol）：
```ts
export function assertNativeToolCallProtocol(message: AssistantMessage, tools: readonly Tool[]): void {
  // 已经走原生 toolCall 的正常放行
  if (tools.length === 0 || message.content.some((part) => part.type === "toolCall")) return;

  const text = message.content.filter(isText).map(t => t.text).join("");
  const invoke = INVOKE_TAG_PATTERN.exec(text);
  if (!invoke || isInsideCodeFence(text, invoke.index)) return; // 排除代码块示例

  const name = INVOKE_NAME_PATTERN.exec(invoke[0])?.[1];
  if (!name || !tools.some((t) => t.name === name)) return;

  // 命中已注册工具名的假文本调用，直接抛出协议违规错误
  throw new ModelOutputProtocolViolation({
    format: "xml_text_tool_call",
    message: `Model emitted a text-based tool call for "${name}" instead of a native tool call.`,
    toolName: name,
  });
}
```

配合 discardProtocolViolationContent，底层在捕获该错误后会原子性丢弃掉伪造的文本内容，通知上层模型出现了协议违规，要求其纠正重试，杜绝了脏文本渗入持久化会话。

## 小结
packages/ai 的核心定位，并不是造一个庞大的全能框架，仅作为学习作用，已经足够。有了这一层看起来坚固的底座，下一章，我们来写真正驱动多轮任务推进的 Agent Loop。

