# 发布整理记录

## 原稿与博客稿

`README.md`、`1.md`、`2.md`、`style.md` 是从 `/Users/jayden/code/jai-mono/docs/book` 复制的原稿快照，保留原样，便于继续写作和核对。博客发布稿放在 `data/blog/how-to-build-your-own-agent-project/`。

- 第 0 章：`model-streaming-compatibility-layer.md`，模型流式接入与兼容层设计，原博客文件名为 `02-model-streaming-compatibility-layer.md`。
- 第 1 章：`agent-loop-lifecycle.md`，由本目录 `2.md` 整理，发布日期为 2026-10-18。
- `system-prompt-art.md` 保留为独立专题，去掉原文件名的 `01-` 前缀，不占用这组章节编号。

博客文件名和正文小标题不带数字前缀，章节顺序通过文章顶部和底部的第 0 / 1 章导航表达。两篇旧地址在 `next.config.js` 中永久跳转到新地址。后续章节未发布，正文用主题名称引用，避免旧编号产生歧义。

## 图片选择

用户要求保留西方古典气质，但指出手部构图与上一期太相似，需要换成建筑主题并加标题。当前采用古典塔楼、拱廊与回旋阶梯，左侧大字为 Agent Loop / 核心流转与生命周期控制，保留古典蚀刻、羊皮纸和克制金线。

- 当前封面：`assets/agent-loop-lifecycle-illustrations/00-cover-architecture.png`。
- 4 张正文图：同目录 `01-lifecycle.png`、`02-tool-scheduling.png`、`03-steering-follow-up.png`、`04-discard-abort.png`，使用 Jayden 角色白底手绘风格。
- 网页引用：`public/static/images/agent-loop-lifecycle/` 中对应的 WebP。封面同时用于正文和分享卡片。
- `00-cover.png` 是早期手绘封面草稿；`00-cover-series.png` 是与上一期太接近的手部构图版本，均保留但未被文章引用。
- 生图使用内置 image_gen；正文提示词见 `prompts.json`，当前建筑封面提示词见 `cover-architecture.json`。`cover-revision.json` 记录旧手部构图版本。

## 验证与续接

已通过生产构建（包括 TypeScript、静态页面生成、RSS）、`git diff --check` 和图片/章节链接本地检查。4 份源文件复制后逐字节核对一致；系统提示词文章仅改文件名。

浏览器视觉检查尚未完成：本地预览服务被运行环境权限阻止，浏览器检查也尚未启动成功。尚未提交 Git 或部署上线。

下次先打开第 1 章预览，确认新版封面、4 张正文图和第 0 / 1 章导航，再检查两个旧地址的跳转；按用户发布安排继续提交和部署。


## 2026-10-26：第 2 章发布

- 原稿实际路径：`/Users/jayden/code/jai-mono/docs/book/2.md`，标题为“上下文管理、KV Cache 断点与 Compaction”。原稿目录已重新编号，旧快照 `2.md` 仍为 Agent Loop，请勿据文件名覆盖它。
- 新原稿快照：`context-management-compaction.source.md`，与源文件内容一致。
- 博客稿：`data/blog/how-to-build-your-own-agent-project/context-management-compaction.md`，日期 2026-10-26，非草稿。
- 保留原文，仅移除正文重复一级标题，修正重复的第三步为第四步及“変化”错字，添加元数据、上下章导航；第 1 章末尾已链接到第 2 章。
- `yarn build` 通过，包含类型检查、静态页面生成、搜索索引与 RSS。浏览器已读到本地文章标题与正文，截图请求超时，未完成视觉检查。用户对打开浏览器提出疑问，后续使用命令行验证，不再自行打开浏览器。
- 生产站点通过推送 `main` 触发 Vercel 自动部署；本轮发布状态以 Git 提交和部署记录为准。


### 第 2 章封面补充

用户要求延续系列封面风格。使用内置 image_gen，以上一期建筑封面为风格参考，生成古典拱顶藏书室与摘要册：暖象牙羊皮纸、橄榄黑蚀刻、少量金线、左侧大标题与细边框。原图 `assets/context-management-compaction/00-cover-library.png`，网页图 `public/static/images/context-management-compaction/00-cover-library.webp`，提示词见同资产目录 `cover-library.json`。已接入文章元数据和正文，等待用户审阅；本次封面改动未提交或推送。不要再次自行打开用户浏览器。


## 2026-10-27：第 3、4 章发布

- 类型：文章发布。
- 摘要：从 `/Users/jayden/code/jai-mono/docs/book/3.md`、`4.md` 导入工具安全执行与会话持久化两篇原稿；博客路径分别为 `tool-safety-permissions`、`session-persistence-recovery`，发布日期 2026-10-27，均非草稿。
- 决策与放弃：正文完整保留，仅移除重复一级标题，添加元数据、摘要和章节导航；源文件以同名 `.source.md` 保存。补齐第 2→3→4 章链接。首页改版、第 2 章待审封面等既有改动不随本次发布。
- 验证：在仅包含已提交代码与本次文章变更的独立目录运行 `yarn build` 通过（TypeScript、31 个静态页面、RSS）；原稿与快照逐字节一致，正文完整一致，站内文章链接、编译后元数据、目录、静态 HTML、搜索索引及 sitemap 检查通过。首次软链接依赖造成 TS2742，复制依赖后通过，未修改产品代码。按既有偏好未打开浏览器。
- 遗留与下一步：提交 `1036ddc` 已推送至 `origin/main`，Vercel 状态为 success，两个正式地址均 HTTP 200，线上标题和章节导航核验通过。第 5 章 Extension 尚未发布；下一次先确认待审封面和首页变更的发布范围。既有封面及首页变更继续留在本地。
- review 重点：`data/blog/how-to-build-your-own-agent-project/tool-safety-permissions.md:1`、`data/blog/how-to-build-your-own-agent-project/session-persistence-recovery.md:1`；本轮是原稿发布，未进行外部技术事实复核。


### 第 3、4 章封面补充（2026-10-27）

- 类型：系列封面补齐。
- 摘要：内置 image_gen 生成两张 1983×793 封面；第 3 章为古典拱门与权限闸门，第 4 章按用户要求融合猪猪侠飞行动作与西方古典档案长廊、树形日志及分支金线。
- 决策与放弃：延续暖象牙羊皮纸、橄榄黑铜版蚀刻、克制金线、双线细边框、左侧衬线大标题；猪猪侠红衣用古典手工上色处理。参考 Agent Loop、Context Compaction 实图及用户提供的猪猪侠截图。原图、参考图和完整提示词保存于 `assets/tool-safety-permissions/`、`assets/session-persistence-recovery/`；网页 WebP 位于对应 `public/static/images/` 目录，接入正文、Open Graph 和 Twitter 分享图。
- 验证：逐图目视检查文字、构图及系列风格；WebP 编码后尺寸一致，约 502KB / 510KB；独立目录 `yarn build` 通过；解析静态 HTML 确认正文图片及两种分享元数据引用正确；`git diff --check` 通过。
- 遗留与下一步：提交 `35222dc` 已推送，Vercel 部署成功；两篇文章及两张 WebP 均 HTTP 200，线上 Open Graph/Twitter 引用正确，图片逐字节匹配。仍保留既有首页改版和第 2 章待审封面；下次先确认这些剩余变更的发布安排。
- review 重点：两篇文章 frontmatter `images` 与正文图片一致；`assets/session-persistence-recovery/cover-prompt.json` 记录猪猪侠与西方艺术融合要求。
