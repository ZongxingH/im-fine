# Agentic Harness Engineering 借鉴与落地方案

本文整理 imfine 可以从 `china-qijizhifeng/agentic-harness-engineering` 借鉴的内容，以及如何把这些内容转成可执行的 harness 工程工作。

有价值的不是照搬该仓库的 Python 实验栈，而是吸收它对 harness 的工程化处理方式：一个 harness 应当可以被观测、修改、评估，并用 evidence 持续改进。

## 与 imfine 的关系

imfine 已经具备正确的外层边界：

- 当前 Codex 或 Claude 会话是 Orchestrator；
- runtime 负责确定性物化、校验、evidence、git 和 archive 工作；
- 原生 provider subagent 通过 provider-origin receipts 证明；
- `.imfine/` 是 run evidence 和 project evidence 工作空间；
- `true_harness` 不允许静默降级成单 Agent 执行。

Agentic Harness Engineering 更适合作为这个边界之外的改进纪律。它可以帮助 imfine 回答：

- 哪个 harness component 导致这次 run 失败？
- 哪些 evidence 自上次 run 后发生变化？
- 某个 harness 修改是否真的移除了 blocker？
- prompt、skill、runtime validator、workflow 或 memory 更新是否带来了可衡量改进？
- 失败 run 是否能在不依赖截图或口头总结的情况下被调试？

## 可借鉴点

### 1. Component 级可观测性

AHE 把 harness 看成一组可检查、可修改的 component：system prompt、tool、middleware、subagent、skill 和 long-term memory。

imfine 中可以映射为：

- `library/agents/*.md`
- `library/skills/*.md`
- `library/workflows/*.yaml`
- `library/templates/*`
- `src/core/*` 中的 runtime policy、validator 和 materializer
- `.imfine/project/**` project knowledge 和 capability memory
- 安装后的 Codex skill 和 Claude command 模板

要做的事：

- 增加 harness component registry。
- 记录 component id、路径、类型、用途、所属层和影响面。
- 每次 run 记录当前 component registry snapshot。
- run 失败时，把 blocker 尽量指回可能受影响的 component。

建议 artifact：

```text
.imfine/harness/components.json
```

每个 entry 应包含：

- `id`
- `kind`
- `path`
- `layer`
- `purpose`
- `affects`
- `schema_or_contract`
- `last_changed_at`

### 2. Experience 级可观测性

AHE 把 rollout trace 当作一等 evidence，而不只记录 pass/fail。它会保留过程，让后续分析可以解释结果。

imfine 已经有 receipts、handoffs、action ledgers、gates 和 archive reports。缺的是一个让这些 artifact 易于调试和比较的 digest 层。

要做的事：

- 为每个 run 生成 normalized trace。
- 把 raw event records 和人类可读 summary 分开。
- 按 action 索引 dispatch contract、provider receipt、handoff、command evidence、gate result 和 blocker。
- 生成面向 root cause 的 blocker digest。

建议 artifacts：

```text
.imfine/runs/<run-id>/trace/raw-events.jsonl
.imfine/runs/<run-id>/trace/overview.md
.imfine/runs/<run-id>/trace/actions/<action-id>.md
.imfine/runs/<run-id>/trace/blocker-root-causes.json
```

Trace digest 应回答：

- 预期执行哪个 action？
- action 是否被 dispatch？
- 是否记录了 provider-origin receipt？
- handoff 是否存在并通过校验？
- handoff 引用的 evidence 文件是否存在？
- 哪个 gate 阻断完成？
- 更可能由哪一层修复：Orchestrator、runtime、provider、agent prompt、workflow 还是 project code？

### 3. Decision 级可观测性

AHE 要求 evolve agent 在修改 harness 前说明为什么这个修改会有帮助。这样每个改进都可以被证伪。

imfine 对 harness 修改也应使用同样纪律。修改 agent prompt、skill、workflow、validator 或 evidence rule 时，必须声明它针对哪个失败，以及下一轮如何证明或否定这个修复。

要做的事：

- 为非平凡 harness 修改增加 harness evolution record。
- 要求写出 targeted failure evidence 和 predicted impact。
- 将每个 change 链接到 affected components 和 verification runs。
- replay 或 demo run 后比较前后 gate outcome。

建议 artifacts：

```text
.imfine/harness/evolution/<change-id>.json
.imfine/harness/evolution/<change-id>.md
```

每个 change record 应包含：

- `change_id`
- `title`
- `source_failure_run_id`
- `failure_evidence`
- `root_cause_hypothesis`
- `affected_components`
- `change_summary`
- `predicted_impact`
- `regression_risks`
- `verification_plan`
- `verification_run_id`
- `observed_result`

### 4. Generation-based evaluation

AHE 区分“正在被评估的 harness”和“正在演进的 harness”。一个修改是否有效，应由下一次 run 评判，而不是由作者信心决定。

imfine 可以实现一个简化版本：

- run 开始时 snapshot harness component registry；
- 记录当前 git commit 或 dirty component hashes；
- harness 修改后 replay 或重跑代表性任务；
- 比较 gate flips、blocker flips、runtime status 和 true harness evidence。

建议 artifacts：

```text
.imfine/runs/<run-id>/orchestration/harness-version.json
.imfine/harness/evaluation/<evaluation-id>.json
```

Evaluation 应比较：

- previous run id；
- new run id；
- changed components；
- removed blockers；
- newly introduced blockers；
- gate status deltas；
- true harness evidence status；
- test results；
- manual follow-up required。

### 5. Tooling / middleware / memory 优先于 prompt churn

AHE 的实践结论是：稳定收益通常来自 tools、middleware 和 long-term memory，而不是反复调整 system prompt。

对 imfine 来说，主要投入应放在：

- provider receipt handback 和 validation；
- dispatch contract materialization；
- standard handoff enforcement；
- evidence freshness checks；
- action-ledger 和 trace digest generation；
- blocker summarization；
- project knowledge freshness；
- reconcile 和 recovery flows；
- acceptance matrix authorship 和 validation。

Prompt 和 role 文件仍然重要，但它们应该服务这些 contract，而不是替代这些 contract。

## 不建议照搬的部分

不建议直接复制：

- E2B 或 remote sandbox 假设；
- harbor-specific agent execution；
- tmux-based experiment orchestration；
- runtime 自动启动 provider agent；
- 把 benchmark reward loop 当作产品接口。

这些选择适合 AHE 的研究环境。imfine 的边界不同：runtime 禁止启动 Codex 或 Claude agent，用户入口仍是 `/imfine init`、`/imfine run` 和 `/imfine status`。

## 建议实施计划

### P0：让失败更容易归因

目标：每个 blocked run 都应说明最可能由哪一层修复。

任务：

1. 增加 `trace/blocker-root-causes.json`。
2. 从现有 run artifacts 生成 `trace/overview.md`。
3. 将每个 blocker 链接到 action id、gate id、source file 和 likely owner layer。
4. 为 missing receipt、missing handoff、stale evidence、missing final gate、provider capability unknown 增加测试。

验收标准：

- `imfine status` 能指向确切缺失 evidence 或 stale source。
- failed true harness run 有 trace digest，不需要人工重建目录。
- 现有 `true_harness_passed=false` 变得可操作。

### P1：增加 Harness Component Registry

目标：每个 run 都知道哪些 harness components 影响了它。

任务：

1. 为 library agents、skills、workflows、templates 和选定 runtime policy files 创建确定性 registry builder。
2. init 或 run setup 时写 `.imfine/harness/components.json`。
3. 在每个 run 中 snapshot 当前 component hashes。
4. 尽可能在 blocker root-cause 输出中引用 component。

验收标准：

- run 可以绑定到具体 harness component 版本。
- harness 修改可以和历史 run 对比。
- Reviewer 能判断失败更可能来自 agent guidance、runtime validation、provider evidence 还是 project code。

### P2：增加 Harness Evolution Records

目标：让 harness 修改可证伪。

任务：

1. 增加轻量 evolution record schema。
2. 增加 runtime helper，从 failed run 创建 record。
3. harness 修改必须写 predicted impact 和 verification plan。
4. replay 或 demo run 后写 observed results 和 blocker deltas。

验收标准：

- harness change 可以链接到 source failure 和 verification run。
- 项目能区分真实改进和 prompt churn。
- regression risk 在广泛采用前显式可见。

### P3：增加 replay-oriented evaluation

目标：用 evidence 比较两个 run，而不是靠印象判断。

任务：

1. 每个 run 增加 `harness-version.json`。
2. 增加 `harness/evaluation/<evaluation-id>.json`。
3. 比较前后 run 的 gates、blockers、receipts、handoffs、acceptance matrix、tests 和 archive status。
4. 在 `imfine status` 或内部 report 中展示 delta。

验收标准：

- 可以从文件回答“AHE-style 这个修改是否有帮助？”。
- demo run 可以作为 regression probe。
- 新引入的 harness blocker 能立即可见。

## 推荐第一步

先只做 P0。

最小有用切片：

1. 读取现有 `action-ledger.json`、`dispatch-contracts.json`、`parallel-execution.json`、`provider-receipts/*.json`、`agents/*/handoff.json`、`final-gates.json` 和 `true-harness-evidence.json`。
2. 生成 `trace/overview.md`。
3. 生成 `trace/blocker-root-causes.json`。
4. 围绕已知失败模式增加聚焦测试。

这能在不改变 provider boundary、用户入口或 orchestration model 的前提下提供直接价值。

## imfine 设计规则

- Runtime 记录和验证，不成为隐藏产品规划者。
- 截图和聊天观察是诊断材料，不是 true harness proof。
- 每个 required subagent action 都需要 dispatch contract、provider-origin receipt、wave history 和 standard handoff。
- 每个最终结果都需要 fresh true harness evidence。
- 每个 harness improvement 都必须声明针对的失败以及验证方式。
- 优先做 deterministic tooling 和 evidence contracts，不用 prompt-only fix 替代工程闭环。
