---
title: 第二章：实现 AI Provider 层（part3·收尾）
date: 2026-07-07
tags:
  - ai
  - agent
draft: false
summary: 收尾 AI Provider 层：用 TypeBox 完成工具参数转换、去噪和校验，再用轻量 ModelRegistry 把 provider 与 model 路由收拢起来，让上层可以用统一字符串选择模型并发起流式调用。
---

## 工具参数校验

上一篇写完两个 adapter，provider 层可以把模型返回的 tool call 事件透传给消费方了。但 `ToolCall.arguments` 还是一堆 `Record<string, unknown>`。

在执行工具之前，要做三件事：类型转换、去噪、校验。为什么要做这些，因为模型会犯错，我们不能完全信任模型：

1. 转换，因为模型经常犯低级类型错误。schema 要求 `number`，它给 `"42"`；要求 `boolean`，它给 `"true"`。JSON.parse 不区分这些——`"42"` 解析后就是字符串 `"42"`，不会自动变成数字。如果不先转换就直接校验，一堆合理的调用会被误判为失败，模型还要重试一轮。
2. 去噪排。模型有时会往参数里塞 schema 之外的字段。handler 不应该看到它们——多余字段可能干扰解构或者 spread 操作。
3. 校验。转换和去噪做完，能救的都救了，剩下的如果还不合法，就给出准确的错误路径和期望类型，让模型有足够信息修正。

### pi 怎么做

pi 的 `validation.ts` 有 325 行，其中约 200 行是手写的 JSON Schema coercion。它按 `type` 字段递归遍历 schema，处理 `allOf` / `anyOf` / `oneOf`，把 `"42"` → `42`、`"true"` → `true`。

之所以这么长，是因为 pi 要兼容两种 schema 来源：TypeBox 生成的（带内部 Symbol 元数据）和纯 JSON Schema 反序列化回来的（没有 TypeBox 元数据）。TypeBox 自带 `Value.Convert`，但它只认自己生成的 schema。对纯 JSON Schema，pi 只能手写一套。

### 我们的选择

我们只用 TypeBox 定义工具，没有纯 JSON Schema 场景。TypeBox 提供了四个现成的 API：

| API | 作用 |
|---|---|
| `Value.Convert(schema, args)` | 类型转换：`"42"` → `42`，`"true"` → `true` |
| `Value.Clean(schema, args)` | 去掉 schema 之外的多余字段 |
| `Value.Check(schema, args)` | 布尔校验 |
| `Value.Errors(schema, args)` | 返回每个错误的 path + message |

四个 API 串起来，整个管线：

```text
structuredClone(args) → Convert → Clean → Check
                                            ↓
                                    true → 返回 data
                                    false → 格式化错误信息
```

`structuredClone` 放在最前面。Convert 和 Clean 都是 in-place 操作，但 `toolCall.arguments` 还在 `output.content` 的 partial 快照里，不能被改掉。

校验失败时返回 `{ success: false, error }`，不抛 Error。agent loop 里参数校验失败是正常路径（模型写错参数太常见了），不该用异常控制流程。

核心函数只有一个签名：

```ts
function validateToolArguments(tool, toolCall): ValidationResult
```

失败时的 `error` 带三条信息：哪个工具、哪个字段错了、期望什么类型，再附上原始参数——够模型自行修正。

完整实现 40 行，见 [`validation.ts`](https://github.com/jiahao-jayden/jai-mono/blob/main/packages/ai/src/validation.ts)。测试覆盖了类型转换、多余属性去除、必填缺失、不可转换类型、原始参数不被污染六个场景，见 [`validation.test.ts`](https://github.com/jiahao-jayden/jai-mono/blob/main/packages/ai/test/validation.test.ts)。

## 轻量 Registry

现在用一个 provider 是这样的：

```ts
const provider = new AnthropicProvider({ apiKey });
provider.stream(claudeModel, context);
```

调用方得自己拿着 provider 实例和 model 对象。单个模型没问题，但 agent 要支持多模型（换模型、给第二意见、按任务选模型）时，就得自己维护"哪个 model 归哪个 provider"。Registry 把这层映射收起来——调用方只报一个字符串 `"anthropic/claude-opus-4-8"`。

### 两个参考的取舍

pi 分两层：`pi-ai` 是 `Map<providerId, Provider>`，`coding-agent` 再叠一层管内置模型 + `models.json` + extension 动态注册。opencode 更重：路由 key 是 `provider/model` 字符串，provider 靠动态 npm import 加载，model 元数据从远程 `models.dev` 拉。

两边路由核心是一样的：key 是 `(providerId, modelId)`，先定位 provider 再查 model。我们只要这个核心，其余全砍——不拉远程目录、不动态装包、不分两层。model 元数据由调用方注册时提供，provider 实例由调用方 `new` 好再塞进来。

### 实现

内部两个 Map：`Map<providerId, Provider>` 存实例，`Map<"provider/model", Model>` 存元数据，靠 `model.provider` 字段关联。这也是为什么 `Model` 类型从第一篇就带了 `provider` 字段——留给 registry 反查。

```ts title="packages/ai/src/registry.ts"
stream(ref: string, context: Context, options?: StreamOptions) {
  const model = this.models.get(ref);
  if (!model) throw new Error(`Model "${ref}" not registered`);
  const provider = this.providers.get(model.provider);
  if (!provider) throw new Error(`Provider "${model.provider}" not registered`);
  return provider.stream(model, context, options);
}
```

一个细节：model ref 用**第一个** `/` 拆分，不是全部。因为 modelId 本身可能含斜杠（OpenRouter 的 `openrouter/anthropic/claude`），拆过头就路由错了。

校验失败用 Result（正常路径），这里查不到 model 直接抛错——调用方写错 model ref 是编程错误，不是运行时正常路径，两种错误处理策略要分清。

完整实现见 [`registry.ts`](https://github.com/jiahao-jayden/jai-mono/blob/main/packages/ai/src/registry.ts)。

## 测试

```
# 跑真实模型集成测试需要的 key。
# 复制此文件为 .env 并填入 key；没有 key 时 test/integration 下的用例会自动 skip。

ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# 可选：覆盖集成测试使用的模型 / baseURL（默认用便宜的小模型控制费用）
ANTHROPIC_TEST_MODEL=claude-3-5-haiku-latest
ANTHROPIC_BASE_URL=https://api.anthropic.com
OPENAI_TEST_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1

```

完整测试代码见仓库 [`packages/ai/test`](https://github.com/jiahao-jayden/jai-mono/tree/main/packages/ai/test)。

---

到这里，整个 `@jai/ai` 包收尾了。回顾 provider 层做了什么：

| 文件 | 职责 |
|---|---|
| `types.ts` | 静态数据契约：消息、内容块、Context、Tool、Model、Usage |
| `event-stream.ts` | AsyncIterable 事件流容器 |
| `provider.ts` | Provider 接口 + StreamOptions |
| `adapter.ts` | 生命周期 driver `runAdapterStream` |
| `providers/anthropic.ts` | Anthropic Messages adapter |
| `providers/openai.ts` | OpenAI-compatible adapter |
| `validation.ts` | 工具参数校验（Convert → Clean → Check） |
| `registry.ts` | 轻量 ModelRegistry，按 `provider/model` 路由 |
| `utils.ts` | `zeroUsage` / `zeroCost` |
| `test/*.test.ts` | 35 个用例，adapter 用 `mock.module` 端到端测 |

两个 adapter 把不同 API 的格式差异封装掉，上层只看 `provider.stream(model, context)` 返回的统一事件流。validation 在 tool call 执行前做一道校验，把模型的类型错误尽量修正，修不了的给出准确错误让模型重试。registry 再往上收一层，让调用方用一个字符串就能选模型发起调用。

下一篇进入阶段二：Agent Loop——工具调用循环、工具执行、多轮对话的 steering。provider 层是地基，agent loop 才是让它跑起来的引擎。
