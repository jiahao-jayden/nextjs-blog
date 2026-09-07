# wehub-done

人说"这个任务完结了/不做了"时用本命令收官。收官是人拍板的动作:没有人的明确表态,不要执行。

话术纪律:后台命令静默执行;对人只说业务语言,不念 log.md、resume、status 这些内部名字。

## 第一步 · 确认收得住

先核对再动手,把结果口语汇报给人(说"上一段工作交接了没有、验收过了几条"):

- 看任务目录的 log.md:最后一棒收尾了吗(有 **resume** 行)?没收尾先用
  wehub-handoff skill 走 record,把交接记录写完。
- 对照 plan.md 的验收标准:哪些达成了、哪些没有?步骤清单还有没打勾的吗?没达成的如实说,由人决定
  是照常完结还是继续做。

## 第二步 · 执行收官

人确认后执行:

- 完成:`node .wehub/scripts/wehub.cjs task done <id>`
- 不做了:`node .wehub/scripts/wehub.cjs task done <id> --cancelled`

脚本会校验(比如最后一棒没收尾会拒绝标 done),按报错提示补完再重试。

## 第三步 · 收尾动作

- 复述给人:"T00x 已标记完成/取消。"
- 顺手想一下这个任务里有没有值得沉淀的经验(踩过的坑、定下的约定),
  有就按 wehub-remember skill 向人提议写进 knowledge/。

(脚本执行失败时,读 .wehub/workflow.md 按其规则手工完成同样的事。)
