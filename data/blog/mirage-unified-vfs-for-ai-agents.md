---
title: 'Mirage: 给 AI agent 一个它已经会用的世界'
date: '2026-05-09'
tags: ['ai', 'agent', 'infra']
draft: false
summary: 'Strukto 的 Mirage 把 S3、Slack、GitHub 等异构系统投影成统一文件系统，让 agent 用 bash 操作一切。'
---

## 前言

这半年看 AI agent 相关的项目，一个感受越来越强烈：模型本身跑得够快了，真正拖后腿的是它碰外部世界的方式。

你让 agent 去读 S3 里的日志、翻 Slack 的消息、查 GitHub 的 PR、改 Notion 文档、往 Linear 里建 issue。看起来是一件事，背后其实是五六套完全不同的接口、认证模型和返回结构。于是大家一边给 agent 塞工具，一边写越来越长的系统提示词去解释什么时候该用哪个 connector、参数怎么传、失败了再试什么。工具确实加上去了，agent 的心智负担也一起加上去了。

Mirage 想解决的就是这个阶段的问题。我在公司做 A2A 相关的业务时碰到过类似的事：我们跑在不同容器里的 agent（底层是 Openclaw），每次为一个 goal 编排任务，就涉及 agent 之间的文件流转。不想挂共享 PVC（多个 agent 容器同时读写同一个卷，锁竞争、生命周期耦合、跨节点调度限制，问题比较多），于是引入了 S3，自己设计了一套文件流转协议，目的是不破坏 agent 原本对文件读写的能力。目前能跑，但如果后面要接更多格式、更多平台数据源，这个方式会越来越难受。

所以看到 Mirage 的思路时，觉得它至少在对的方向上。

## 它在做什么

Mirage 是 Strukto 开源的一个项目（GitHub 上大概 1300 star），定位是"Unified Virtual Filesystem for AI Agents"。翻译过来就是：把各种外部系统都伪装成一个文件系统，然后给 agent 一个 bash shell 去操作。

S3 bucket 挂在 `/s3`，Slack 挂在 `/slack`，GitHub repo 挂在 `/github`，RAM 挂在 `/data`。agent 不再需要区分"现在该调哪个 SDK"，它只要会 `ls`、`cat`、`grep`、`find`，就能在这些系统之间工作。

```python
from mirage import Workspace
from mirage.resource.ram import RAMResource
from mirage.resource.s3 import S3Resource
from mirage.resource.slack import SlackResource

ws = Workspace({
    "/data": RAMResource(),
    "/s3": S3Resource(bucket="my-bucket"),
    "/slack": SlackResource(),
})

result = await ws.execute('grep -r "release" /slack/eng')
```

就这样。agent 写 `grep -r "release" /slack/eng`，Mirage 在底层把这条命令解析、路由到 Slack 的 handler，拿回结果。对 agent 来说，Slack 就是一个能 `grep` 的目录。

## 真正有意思的实现细节

如果只看 landing page，很容易把 Mirage 理解成"多数据源的挂载工具"。但文档里有两个细节值得多看一眼。

第一，它没有调用系统的 `/bin/bash`。Mirage 用 tree-sitter 在进程内部解析 bash 语法，然后由自己的执行器把命令分发到各个 mount handler。没有子进程，没有 `os.system`。这意味着它不是"给 agent 一台真的 Linux 机器"，而是在做一个受控的、语义化的 shell runtime。安全边界、缓存、跨后端路由，都在这一层解决。

第二，它有一个 two-layer cache。agent 一旦进入 loop 反复读 Slack 或 S3，如果每次都打远端 API，延迟和成本都会崩。Mirage 在本地做了一层索引缓存和文件缓存，把重复请求拦在本地。

还有 snapshot 和 clone。你可以在 agent 跑到某一步时拍快照，之后从这个快照 fork 出新的 workspace 继续跑，或者回滚到之前的状态。有点像 git 对源码做的事，但对象是整个 agent 的数据环境。

## 为什么选文件系统，不选 MCP 或更多工具

这是 Mirage 自己在 FAQ 里的第一个问题，说明他们也知道会被问。

他们的回答很直接：现代 LLM 对 bash 和文件系统语义的熟悉程度，远超它对任何一个特定 SDK 的熟悉程度。你给模型暴露 10 个 tool，每个 tool 都有自己的 schema 和调用约定，模型得在推理时不断做"选哪个工具"的决策。给它一个统一的文件系统 + shell，它只需要做"路径在哪、跑什么命令"的决策。决策空间小了，出错概率也低。

这个判断我觉得是对的。至少在 2026 年这个时间点，模型对 bash 的掌握确实比对大多数 API 更稳定。

## 我觉得还没讲清楚的部分

方向我认，但有几个地方让我不太确定这东西在真实场景下会多稳。

Slack channel 映射成目录，消息变成 JSONL，附件变成文件。这能跑。但 thread 怎么表示？消息被编辑或删除了怎么反映？Notion 的 block tree 和文件树并不等价。Postgres 的表、schema、事务、锁，和路径操作之间的语义鸿沟也不小。

统一抽象越顺滑，用户越容易忘记底层系统之间的差异。这体验好的时候很好，但出问题的时候可能很难 debug，因为"同一个 `cat` 命令"背后可能是一次本地读取，也可能是一次远程 API 请求加一次格式转换。

缓存也是双刃剑。有缓存 agent loop 才跑得动，但远端数据更新了怎么办？cache 什么时候失效？agent 会不会读到旧状态还以为是新的？snapshot 存的是逻辑视图还是物理内容？这些问题文档里目前涉及得不多。

还有 bash 兼容性的边界。文档说支持 `ls`、`cat`、`grep`、`find`、`head`、`wc`、`jq`、pipe、redirect、glob、`&&`/`||`。这已经不少了，但你既然说"这是 bash"，用户就会拿 bash 的预期来用它。哪天有人写了个 `awk` 或 `sed`，发现不支持，体验就会断裂。

## 它适合什么场景

从文档和例子来看，Mirage 适合这些场景：

跨系统检索。一条 `grep -r "keyword" /slack /github /gmail` 同时查三个后端，底层分别走 Slack Web API、GitHub REST API 和 Gmail API，结果合并成统一的 stdout 输出。不用写三个 connector 的调用逻辑。

读写混合的 agent 流程。mount 配置里区分 READ 和 WRITE 权限。agent 可以 `cat /slack/eng/latest` 读消息，然后 `echo "..." > /linear/issues/new` 建 issue，整个流程是 shell 脚本，不是多 tool 调用链。

环境快照和分支。`ws.snapshot()` 冻结当前所有 mount 的状态，之后可以 `ws.clone(snapshot_id)` 创建新 workspace 实例。用途是 agent 跑到某一步出错时能回退，或者从同一个检查点并行跑两条不同策略。

给 coding agent 当远程数据层。Claude Code、Codex 这类工具本身就在 shell 里工作，Mirage 让它们通过路径直接访问 S3、数据库查询结果等，不需要先把数据拉到本地磁盘。

## 最后

Mirage 不是某个 agent framework 或某个协议标准，而是一个更朴素的判断：对 agent 来说，统一抽象比继续堆工具更值钱。

项目地址：[github.com/strukto-ai/mirage](https://github.com/strukto-ai/mirage)
文档：[docs.mirage.strukto.ai](https://docs.mirage.strukto.ai)
