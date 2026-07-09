---
title: 第二章：实现 AI Provider 层（part1）
date: 2026-07-03
tags:
  - ai
  - agent
draft: false
summary: 从不同厂商的 API 格式差异出发，解释为什么重度 Agent 不该完全依赖统一 LLM SDK，并设计一层薄而可控的 Provider 抽象来承载消息、工具、流式事件、用量和中断语义。
---

## 前言

2025 年 11 月,Armin Ronacher 和 Mario Zechner 先后写下了自己构建 AI Agent 的经验。前者在生产环境 agent 里踩过缓存、工具调用、消息历史和 provider 私有能力的坑;后者为了一个行为稳定、极简可控的编码 agent,从零实现了 pi 的 provider 层。两人的路径不同,结论却很接近:如果你在做重度 agent,不要把核心能力押在第三方统一 LLM SDK 上,最好自己实现 provider 这一层。

这听起来反直觉。统一 SDK 的卖点正是屏蔽差异:一套接口、多家模型、流式响应、工具调用、类型安全。但 agent 偏偏会踩在抽象漏水的地方。各家 API 的兼容细节并不一致:字段名、角色、reasoning 内容、token 用量、缓存读写、流式事件、服务端工具调用,都可能有自己的规则。普通聊天应用只需要最大公约数,agent 却经常需要最特殊的能力,例如缓存控制、thinking trace、provider 端搜索工具、签名内容块和中途中断后的部分结果回收。统一 SDK 为了统一这些差异,要么抹平能力,要么为每家 provider 打补丁,最后抽象本身就变成新的复杂度来源。

更关键的是控制权。长循环 agent 的成本和延迟,很大程度取决于上下文和缓存策略。Armin 一开始也不喜欢 Anthropic 那种显式 cache point 设计,后来却发现它让成本、命中率和分叉对话都变得可预测。Mario 也反复强调,写代码时要精确控制进入模型上下文的每一个字节。统一 SDK 往往会在背后转换、重排、注入消息,这会削弱可观测性,也让跨 provider 的上下文交接变得含糊。自己拥有 provider 层,才有资格决定 Claude 的 thinking trace 切到 GPT 时怎么表示,工具结果哪些给模型看、哪些给 UI 渲染,以及中断请求后如何保留已经生成的内容。

"一行代码换模型"在 agent 场景里也只是半个承诺。不同模型不是同一种能力的廉价替代品,而是适合不同任务:有的更会工具调用,有的适合长文档和多模态,有的适合给第二意见。真正有价值的多模型能力,不是把模型名换掉,而是在同一会话里切换模型并可控地交接上下文。做到这一点,前提正是你拥有自己的消息格式和序列化规则。

所以这一章的目标不是再包一层漂亮接口,而是实现一层足够薄、足够明确、可测试的 provider 适配层。它只需要覆盖少数主流 API 形态,承认各家差异,把 provider 私有数据原样保留下来,同时把 agent 自己关心的消息、工具、流式事件、用量统计和中断语义收拢到我们能控制的边界里。作为 Agent 框架最底层的基础，我们可以对 AI Provider 这一层有更加深刻的掌握。

## API 格式

当你开始写 Agent 框架时，第一个绕不开的问题就是：**模型怎么接进来？**

你可能会直接 `npm install openai` 然后开写，但很快会遇到这些问题：

- 想换成 Claude 试试效果，发现请求格式对不上，响应结构也不一样；
- 想加工具调用，发现每家的 schema 长得都不同；
- 想做流式输出，发现事件格式完全是两套体系；
- 想拿到 token 用量、缓存命中、reasoning 内容，发现每家的字段又不同。

所以在实现 Provider 抽象之前，我们要先搞清楚一件事：这里说的“API 格式”不是简单的 HTTP 路径差异，而是不同厂商对“模型调用”这件事的不同建模方式。

可以先用一句话记住：

```
Completions:       prompt -> text
Chat Completions:  messages -> assistant message
Responses:         input + tools + state -> output items
Anthropic Messages: messages -> content blocks
Gemini:            contents/parts，或 Interactions execution steps
```

这些格式的核心差异，不在于谁的字段多，而在于它们认为一次模型调用到底是什么。


| 层级 | 格式 | 提供方 | 定位 |
|---|---|---|---|
| 遗留 | Completions | OpenAI | 纯文本续写，现代 agent 很少直接使用 |
| **原生格式** | Chat Completions | OpenAI | 事实上的行业标准 |
| | Responses | OpenAI | 面向 Agent 的新一代 |
| | Messages | Anthropic | Claude 原生接口 |
| | generateContent / Interactions | Google | Gemini 原生接口，先了解即可 |
| 聚合层 | Converse | AWS Bedrock | 跨模型统一格式 |
| | (各类网关) | LiteLLM / Portkey / Vercel AI SDK 等 | 格式互转 |

注意：**格式和厂商不是一一对应的。** Chat Completions 格式被 DeepSeek、Mistral、xAI、vLLM、Ollama 等广泛兼容；Gemini 也提供 OpenAI 兼容层；一些模型服务还会同时提供自家原生格式和 OpenAI-compatible 端点。写 Provider 时你面对的是“格式 × 端点”的矩阵，而不是简单的“每家厂商一个适配器”。

下面按格式逐个拆解设计差异。

### Completions：最早的文本续写

Completions 是最早的形态：传一段文本，模型接着写。

```ts
const result = await client.completions.create({
  model: "gpt-3.5-turbo-instruct",
  prompt: "把下面这句话翻译成英文：你好，世界",
  max_tokens: 64,
});
```

它没有“对话”的概念，没有 `system` / `user` / `assistant` 角色，也没有原生工具调用。你当然可以把历史对话拼成一个长 prompt：

```text
System: 你是一个助手
User: 你好
Assistant:
```

但这只是字符串约定，协议本身并不知道这些角色是什么意思。

对 agent 来说，Completions 的价值主要是历史参考。它解释了为什么很多 API 一开始都像“prompt 进、文本出”，但现代 agent 通常不应该以它为核心。

### Chat Completions：把输入变成消息数组

Chat Completions 的核心变化，是把输入从“一段文本”变成了 **消息数组**。每条消息都有角色和内容：

```ts
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "你是一个乐于助人的助手。" },
    { role: "user", content: "你好!" },
  ],
});
console.log(completion.choices[0].message.content);
```

这套格式的心智模型很简单：你把完整聊天记录发给模型，模型返回下一条 assistant 消息。

它有几个关键特征：

- **无状态**：模型不会记住上一次请求，你要自己保存历史，并在下一次请求里全量传回。
- **system 是一条消息**：`role: "system"` 和 `user`、`assistant` 平级，都在 `messages` 数组里。
- **新模型还有 developer 角色**：在 o1 及更新模型里，OpenAI 文档建议用 `developer` message 承载开发者指令，它取代了过去很多 `system` message 的用途。旧的 `system` role 仍在格式里，但写 provider 时不能假设所有 OpenAI-compatible 服务都支持 `developer`。
- **响应在 `choices[0].message` 里**：这个结构是为了支持一次生成多个候选，实际业务里通常只取第一个。
- **工具调用是 assistant message 的附加字段**：模型不是直接执行工具，而是返回“我想调用哪个工具、参数是什么”。

看一个天气工具的例子：

```ts
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "你是一个天气助手。" },
    { role: "user", content: "北京今天适合跑步吗？" },
  ],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "查询城市天气",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
        required: ["city"],
      },
    },
  }],
});
```

如果模型决定调用工具，返回的 assistant message 可能长这样：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "id": "call_123",
    "type": "function",
    "function": {
      "name": "get_weather",
      "arguments": "{\"city\":\"北京\"}"
    }
  }]
}
```

注意这里的 `arguments` 是一个 JSON 字符串，不是对象。你的 agent 要自己解析、执行工具，再把结果作为 `role: "tool"` 消息塞回下一轮：

```ts
messages.push({
  role: "tool",
  tool_call_id: "call_123",
  content: JSON.stringify({ temperature: 28, condition: "晴" }),
});
```

这就是 Chat Completions 的 agent 循环：**模型提出工具调用，客户端执行工具，再把结果回传给模型。**

它的优点是通用。很多厂商都兼容这套格式，换模型时经常只需要改 `baseURL` 和 `model`。代价是表达力有限：缓存控制、thinking trace、服务端工具、复杂流式事件等新能力，很难自然塞进这套结构里，只能靠各家扩展字段补丁。

### OpenAI Responses：把一次调用变成事件和条目

Responses 是 OpenAI 面向新 agent 应用的接口。它不再把返回值理解成“一条 assistant message”，而是理解成一组有类型的 output items。

```ts
const response = await client.responses.create({
  model: "gpt-5",
  instructions: "你是一个天气助手。",
  input: "北京今天适合跑步吗？",
});
console.log(response.output_text);
```

和 Chat Completions 相比，最直观的变化有三个。

- `system` 不再是一条消息，而是 `instructions`。
- 输出不再是 `choices[0].message`，而是 `output` 数组。
- 它可以通过 `previous_response_id` 使用服务端保存的上下文，不一定每轮都全量回传历史。

工具定义也更平铺：

```ts
const response = await client.responses.create({
  model: "gpt-5",
  input: "北京今天适合跑步吗？",
  tools: [{
    type: "function",
    name: "get_weather",
    description: "查询城市天气",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
      },
      required: ["city"],
    },
  }],
});
```

如果模型要调用工具，返回结果不是塞在一条 assistant message 里，而是 output 里的一个 `function_call` 条目。这里要注意：Responses 的 function call 参数目前仍是 JSON 字符串，不是对象；客户端执行完工具后，要把结果作为 `function_call_output` input item 回传，并用 `call_id` 对上那次调用。

你可以把 Responses 理解成：

```text
一次响应 =
  文本条目 +
  reasoning 条目 +
  function_call 条目 +
  web_search 条目 +
  其他内置工具条目
```

这对 agent 很重要。因为真实 agent 的一次模型调用，往往不只是“说一句话”，而是“思考、调用工具、继续思考、再输出”。Responses 把这些东西显式建模成事件和条目。

一个常见 case：用户问“帮我查某个新项目的资料并总结”。在 Chat Completions 里，你通常要自己写循环：

```text
模型请求 web_search -> 客户端执行 -> 回传结果 -> 模型继续
```

在 Responses 里，如果使用内置 web search，模型可以在一次请求里完成搜索和总结。你的代码关注的是声明工具、读取结果、记录事件，而不是手写每一步循环。

但如果是你自己定义的函数工具，循环仍然在客户端：模型返回 `function_call`，你的代码执行函数，再把 `function_call_output` 发回去。这个设计的代价是：它更像 OpenAI 自己的 agent runtime。你得到更多能力，也更容易依赖它的语义。如果你的目标是跨 provider，自定义 Provider 层就必须把这些 output item 映射回自己的内部事件模型，而不是假装它和 Chat Completions 一样。

### Anthropic Messages：一条消息可以由多个内容块组成

Claude 的 Messages API 乍看也像 Chat Completions：同样有 `messages` 数组。但它真正的核心不是 messages，而是 **content blocks**。

```ts
const message = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  system: "你是一个天气助手。",
  messages: [{ role: "user", content: "北京今天适合跑步吗？" }],
});
```

最容易混淆的点有两个。

- `system` 是顶层参数，不是 `messages` 里的一条 system message。
- `content` 可以是字符串，也可以是内容块数组。

当工具调用出现时，内容块模型就非常明显了：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "我先查一下北京天气。"
    },
    {
      "type": "tool_use",
      "id": "toolu_123",
      "name": "get_weather",
      "input": { "city": "北京" }
    }
  ],
  "stop_reason": "tool_use"
}
```

这和 Chat Completions 的心智模型不同。Chat Completions 更像“一条 assistant 消息 + 额外的 tool_calls 字段”；Anthropic 更像“一条 assistant 消息由多个异构内容块组成”。文本、工具调用、thinking、引用、图片，都可以作为 block 扩展进去。

工具定义也不一样：

```ts
tools: [{
  name: "get_weather",
  description: "查询城市天气",
  input_schema: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  },
}]
```

模型返回的 `input` 已经是对象，不是 JSON 字符串。工具结果回传时，也不是 `role: "tool"`，而是下一条 user 消息里的 `tool_result` block：

```json
{
  "role": "user",
  "content": [{
    "type": "tool_result",
    "tool_use_id": "toolu_123",
    "content": "{\"temperature\":28,\"condition\":\"晴\"}"
  }]
}
```

这个设计背后的语义是：工具结果是“下一轮输入给模型的内容”，不需要额外发明一个 `tool` 角色。

Anthropic 还有两个非常适合 agent 的机制。

第一是显式缓存。你可以用 `cache_control` 标记缓存断点。例如系统提示、工具说明、项目文档这些长期不变的内容，可以放在前面并打缓存点；当前时间、用户最新问题这类经常变化的内容，放在后面，避免污染缓存前缀。对长上下文 agent 来说，这会直接影响成本和延迟。**如果是我们个人使用的 agent，日常可能难以体现出缓存的重要性，一旦作为产品，多用户场景下，如何节省成本，是个至关重要的问题。所以我们的 Anthropic adapter 第一版就默认开启 prompt caching：自动在 system prompt、最后一个工具定义、最后一条 user message 上打缓存断点。**

第二是 prefill。因为历史中的 assistant 消息可以由客户端构造，你可以在最后放一条 assistant 开头，让 Claude 接着写。例如你想强制它输出 JSON，可以把最后一条 assistant 消息设成 `{`，模型会从这个位置继续生成。这是 Anthropic 格式里很实用但容易被忽略的控制技巧。

### Gemini

Gemini 在 Agent 框架里没有 OpenAI 和 Anthropic 常见，但它的格式只需要简单了解，个人非常不喜欢谷歌的设计。传统原生接口是 `generateContent`，核心不是 `messages`，而是 `contents` 和 `parts`。

```ts
const result = await ai.models.generateContent({
  model: "gemini-2.5-pro",
  contents: [{
    role: "user",
    parts: [{ text: "北京今天适合跑步吗？" }],
  }],
});
```

可以把 `generateContent` 理解成：

```text
一次输入 =
  多个 content
每个 content =
  多个 part
每个 part =
  文本 / 图片 / 文件 / functionCall / functionResponse
```

这套结构天然适合多模态。比如用户同时发文字和图片时，在 Gemini 里不是“消息里挂一个附件”，而是同一个 content 里放多个 part：

```ts
contents: [{
  role: "user",
  parts: [
    { text: "这张截图里的报错是什么意思？" },
    { inlineData: { mimeType: "image/png", data: imageBase64 } },
  ],
}]
```

工具调用也是 part：

```json
{
  "functionCall": {
    "name": "get_weather",
    "args": { "city": "北京" }
  }
}
```

工具结果再作为 `functionResponse` part 回传：

```json
{
  "functionResponse": {
    "name": "get_weather",
    "response": {
      "temperature": 28,
      "condition": "晴"
    }
  }
}
```

所以 Gemini 最适合用“多模态内容容器”来理解。文本、图片、文件、函数调用和函数结果，都是 part 的不同形态。

Google 现在也推荐新项目优先使用 GA 的 Interactions API。它和 OpenAI Responses 的方向更像：一次调用不只是返回文本，而是创建一个 `Interaction`，里面按时间顺序记录执行步骤。

```text
一次 Interaction =
  user_input +
  model thoughts +
  tool calls +
  tool results +
  model_output
```

它支持可选的服务端状态，下一轮可以传 `previous_interaction_id` 延续上下文。对我们这篇文章来说，Gemini 先记到这个程度就够了：老接口是 `contents -> parts`，新接口更像“带状态的执行步骤”。真正实现时再查文档即可。

### 同一个天气工具，四种格式怎么想？

假设用户问：“北京今天适合跑步吗？”模型需要调用 `get_weather({ city: "北京" })`。

| 格式                 | 模型怎么表达工具调用                             | 你怎么回传工具结果                                        |
| ------------------ | -------------------------------------- | ------------------------------------------------ |
| Chat Completions   | assistant message 里的 `tool_calls`      | 追加 `role: "tool"` 消息                             |
| Responses          | `output` 里的 `function_call` item       | 自定义函数回传 `function_call_output`；内置工具由平台执行         |
| Anthropic Messages | assistant content 里的 `tool_use` block  | 下一条 user 消息里的 `tool_result` block                |
| Gemini             | `functionCall` part，或 Interaction step | `functionResponse` part，或 `function_result` step |

这张表很重要。它说明 provider adapter 不能只做“字段改名”。同样是工具调用，不同协议对它的理解完全不同：

- OpenAI Chat 把工具结果看成一种特殊 role。
- Anthropic 把工具调用和工具结果看成内容块。
- Gemini 传统接口把它们看成多模态 part，新接口把它们看成 execution step。
- Responses 把它们看成响应过程中的类型化 item。

如果你的内部抽象只定义成：

```ts title="packages/ai/src/types.ts"
type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};
```

那很快就会不够用。因为它表达不了 content block、part、reasoning item、缓存点、引用、服务端工具执行记录这些东西。

更实际的做法，是给自己的 agent 定义一个更接近“事件和内容块”的内部模型。例如：

```ts title="packages/ai/src/types.ts"
type AgentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; callId: string; content: unknown }
  | { type: "reasoning"; text: string; providerRaw?: unknown }
  | { type: "provider_raw"; provider: string; value: unknown };

type AgentMessage = {
  role: "system" | "user" | "assistant";
  blocks: AgentBlock[];
};
```

这个内部模型不需要一开始就完美，但要留两个余地：

- 能表达“同一条消息里有多种内容”。
- 能保留 provider 私有内容，避免你暂时不理解的块在多轮对话里丢失。

### 写 Provider 时真正要统一什么？

读完这些格式，很容易想做一个超级统一接口，把所有差异都抹平。但 provider 层真正应该统一的不是“所有字段”，而是 agent 主循环真正需要依赖的语义。

所以这一层的目标不是做一个“看起来很干净”的 SDK，而是做一个**能承认差异、保留差异、隔离差异**的 adapter。上层 agent 只依赖自己的内部事件和消息模型；下层 provider adapter 负责把不同 API 的格式翻译进来、翻译出去。

## 技术选型

到此，我们技术选型有两个重要的选择：

1. 调用 AI 我们统一使用各大平台提供的 sdk，先支持 openai 和 anthropic 的协议
2. 一个生产和消费 json schema 的工具：TypeBox，看下面的代码就知道是做什么的了

```ts title="packages/ai/src/types.ts"
import { Type, type Static } from "@sinclair/typebox";

const ReadInput = Type.Object({
  path: Type.String({ description: "文件路径" }),
  offset: Type.Optional(Type.Number()),
});

type ReadInput = Static<typeof ReadInput>;
// => { path: string; offset?: number }
```

## Spec1 数据类型

### 内容块 Content Blocks

一条 assistant 消息的正文不是一段纯文本，而是一个**有序的块序列**：可能先是一段 thinking，再是一段 text，再夹几个 tool call

```ts title="packages/ai/src/types.ts"
export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	/**
	 * 部分模型多轮对话时需要把 thinking signature 原样回传，
	 * 否则 provider 可能拒绝请求。
	 */
	thinkingSignature?: string;
}

export interface ImageContent {
	type: "image";
	image: string;
	mimeType: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}
```

| 类型 | 用在哪 | 说明 |
|------|--------|------|
| `TextContent` | assistant / user / toolResult | 普通文本 |
| `ThinkingContent` | assistant | 推理内容；`thinkingSignature` 用于多轮回传 |
| `ImageContent` | user / toolResult | 图片，如 read 工具读取图片文件的返回 |
| `ToolCall` | assistant | 模型请求调用一个工具 |

`ToolCall.arguments` 用 `Record<string, unknown>`，因为这里保存的是模型返回的、尚未校验的原始参数。校验和类型收窄是工具执行前的事。

顺带说一下：为什么要保留 `thinkingSignature`

`thinkingSignature?: string` 看起来像一个很 provider-specific 的字段，但它其实是在给多家模型的 reasoning 状态回传机制留位置。不同厂商叫法不一样，语义也不完全相同，但核心问题一致：**某些模型会把内部 reasoning 的可验证状态放进响应里，后续多轮对话需要原样带回去。**

- **Anthropic Claude**：Claude 的 extended thinking 会返回 `thinking` block，其中包含 `signature`。在多轮、尤其是 tool use 场景里，Anthropic 要求把完整的 thinking block 原样传回去；文档也说明 `signature` 是加密的 thinking 内容，用来验证 thinking block 确实由 Claude 生成。参考：[Anthropic extended thinking docs](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)。
- **Google Gemini**：Gemini 有类似机制，叫 `thought_signature` / thought signatures。Google 文档把它描述为模型内部思考过程的加密表示，用来在多轮调用之间维持 reasoning 连续性。参考：[Gemini thinking docs](https://ai.google.dev/gemini-api/docs/thinking)。
- **OpenAI reasoning models**：OpenAI 通常不叫 `thinkingSignature`，而是通过 Responses API 的 reasoning items、`encrypted_content` 和 `previous_response_id` 处理推理状态。在 stateless、ZDR、function calling 等场景下，应用需要保留并回传相关 reasoning item，或者使用 `previous_response_id` 让服务端衔接上下文。参考：[OpenAI reasoning models docs](https://platform.openai.com/docs/guides/reasoning)。

所以这里的 `thinkingSignature` 更像是一个 provider 抽象字段，用来兼容不同厂商对“可回传 reasoning 状态”的表达：

| Provider | 原生字段 / 机制 | 作用 |
|---|---|---|
| Claude | `thinking.signature` | 验证并延续 Claude 生成的 thinking block |
| Gemini | `thought_signature` | 在多轮调用中延续 Gemini 的内部 reasoning 状态 |
| OpenAI | `reasoning.encrypted_content` / reasoning item / `previous_response_id` | 在 Responses API 中保留或衔接 reasoning 上下文 |

普通模型通常不需要这个字段。比如 GPT-4o 这类非 reasoning 状态回传协议，或者 DeepSeek R1 这类主要输出 `<think>` 文本的接口，通常没有这种“加密签名必须原样回传”的要求。

### 消息 Message

三种角色构成一个联合类型：

```ts title="packages/ai/src/types.ts"
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  provider: string;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

### 上下文 Context 与工具 Tool

`Context` 是发起一次调用时喂给模型的全部输入：

```ts title="packages/ai/src/types.ts"
export interface Tool<T extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: T;
}

export interface Context {
	systemPrompt: string;
	messages: Message[];
	tools: Tool[];
}
```

`Tool` 做成泛型，是为了让工具定义处保留参数的精确类型。后续工具执行器可以用 `Static<typeof schema>` 拿到类型安全的参数。

### 模型 Model

`Model` 是第一版就要认真设计的核心类型。它会被 provider、registry、session、UI、context window 判断、未来的成本统计共同引用；如果先砍掉结构性字段，后面补回来会造成连锁返工。

我们保留那些会造成结构性返工的模型元数据，比如 `api`、`baseUrl`、`cost`、`compatibility`

- 基础别名

```ts title="packages/ai/src/types.ts"
export type Api = "anthropic-messages" | "openai-chat-completions" | (string & {});
export type ProviderId = "anthropic" | "openai-compatible" | (string & {});

export type ModelInput = "text" | "image";
```

`(string & {})` 是一个 TypeScript 小技巧：既保留已知字面量的自动补全，又允许传入任意字符串（未来新 API / 新 provider 不需要改类型定义）。

- 成本信息
```ts title="packages/ai/src/types.ts"
export interface ModelCost {
  /** 每百万 input tokens 的价格 */
  input: number;
  /** 每百万 output tokens 的价格 */
  output: number;
  /** 每百万 cache read tokens 的价格 */
  cacheRead: number;
  /** 每百万 cache write tokens 的价格 */
  cacheWrite: number;
}
```

- 兼容性配置：OpenAI-compatible 和 Anthropic-compatible 的麻烦在于：很多服务“长得像某个 API”，但参数细节不完全一样。`compatibility` 用来把这些差异显式记录在模型元数据上，而不是散落在 adapter 里。

```ts title="packages/ai/src/types.ts"
export interface OpenAICompatibility {
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  supportsUsageInStreaming?: boolean;
  supportsStrictTools?: boolean;
  reasoningFormat?: "openai" | "deepseek" | "none";
}

export interface AnthropicCompatibility {
  supportsThinking?: boolean;
}

export type ModelCompatibility = OpenAICompatibility | AnthropicCompatibility;
```

这些字段先只作为数据契约；adapter 可以逐步消费它们。这样做的好处是：**Model 的结构先稳定，兼容行为可以渐进实现**。

- 主要结构
```ts title="packages/ai/src/types.ts"
export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  input: ModelInput[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  compatibility?: TApi extends "openai-chat-completions"
    ? OpenAICompatibility
    : TApi extends "anthropic-messages"
      ? AnthropicCompatibility
      : ModelCompatibility;
}
```

### 用量 Usage 和 StopReason

```ts title="packages/ai/src/types.ts"
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

`cost` 是本次请求的成本拆分（美元），第一版 adapter 可以统一填 0，未来做成本统计时只补计算逻辑、不改结构。

各家 provider 报告 token 的口径并不一致，所以必须在类型这里把语义定死（这一段借鉴自 opencode 的 Usage 注释，是几个参考框架里定义最严谨的）：

- **inclusive totals**：`input` 是完整 prompt token 数，**包含** `cacheRead` / `cacheWrite`；`output` **包含** `reasoning`。与 OpenAI / AI SDK 口径一致。
- **不变式**：`cacheRead + cacheWrite ≤ input`；`reasoning ≤ output`；`totalTokens = input + output`。
- **归一化是 adapter 的责任**：OpenAI 系报的本来就是 inclusive 值，直接用；Anthropic 报的 `input_tokens` **不含**缓存部分，adapter 必须做加法（`input = input_tokens + cache_read + cache_write`）。

这样下游消费方（成本、context 压力计算）永远不需要做减法，也就不会出现"减出负数"这类 bug。

错误原因的详细解释如下：

| `StopReason` | 含义               |
| ------------ | ---------------- |
| `stop`       | 正常结束             |
| `length`     | 触达 max tokens 截断 |
| `toolUse`    | 停下来等工具调用结果       |
| `error`      | 出错               |
| `aborted`    | 被 AbortSignal 中断 |
