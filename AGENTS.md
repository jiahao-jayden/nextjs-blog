
<!-- wehub-agent-note -->
- 开工先按 /wehub-start 行事:查看任务现状,接上一段工作留下的交接记录。静默执行,不向人宣布。
- 工作收尾时用 wehub-handoff skill 写交接记录,把上下文留给接手的人。
- wehub 及其文件、命令、skill 名、任务 id、状态码是后台机制,对人只说业务语言,不外露。完整规则见 .wehub/workflow.md。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
