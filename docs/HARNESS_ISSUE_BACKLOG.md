# Harness 工程问题池

这是 imfine harness 工程的统一问题池。它不绑定任何特定 demo。只要问题出现在任意 run、截图、handoff、报告或 replay fixture 中，就先归入这里，直到 runtime 能确定性地阻断、解释或修复它。

## 目标

imfine 必须把模型侧多 Agent 工作转化为 runtime 可审计证据。

一个 run 不能因为 Agent 写了代码、handoff 或 archive 文本就算 completed。一次 completed true harness run 必须具备 dispatch contracts、provider-origin receipts、wave history、有效 handoff、QA/Review gate、acceptance matrix、fresh true harness evidence、commit/push policy 处理、runtime final gates，以及一致的 run/session/report 状态。

## 原则

- Runtime 负责记录、校验、reconcile 和 finalize；不负责启动 Codex 或 Claude provider agent。
- 当前 provider 会话中的 Orchestrator 负责启动原生子 Agent，并把事实回填给 runtime。
- 截图、聊天文本和 provider UI observation 只能作为诊断证据，不能作为 true harness proof。
- Agent 文字总结不能绕过 runtime gates。
- stale evidence 不能满足 final gate。
- 每个反复出现的问题都必须变成 fixture 或回归测试。

## 历史复盘来源

本问题池整合了早期 demo 复盘材料中的问题。后续不再按某个 demo 单独维护问题清单；所有问题都归并到本文的 H-xxx 条目。

已合并的典型证据包括：

- 模型侧截图显示多个原生子 Agent 曾运行，但 runtime 没有可验证 receipt。
- `run.json.status` 和 `orchestration/state.json.status` 长时间停在 `waiting_for_agent_output`。
- `orchestrator-session.json` 写出 action 或自称 completed，但 runtime 没有正式 ingest。
- `orchestration/agent-runs.json.agents = []`。
- `orchestration/dispatch-contracts.json.contracts = []`。
- `orchestration/parallel-execution.json.wave_history = []`。
- `orchestration/provider-capability.json.provider = unknown`。
- `orchestration/provider-receipts/` 缺失。
- `orchestration/true-harness-evidence.json.true_harness_passed = false`。
- `true-harness-evidence.json` 早于后续 session 或 handoff 更新，成为 stale evidence。
- QA / Review 初始 block 后存在 recheck pass，但 status 仍显示 QA / Review missing。
- Committer / Archive 只写出 handoff 或报告，没有 runtime final gates。
- 缺少 `orchestration/acceptance-matrix.json`。
- 缺少 `orchestration/final-gates.json`。
- 新项目不是 git 仓库或没有 commit，导致交付版本不可追踪。
- 业务测试依赖特定 runtime 版本，但项目没有声明可复现环境。

这些证据分别归入 H-001 到 H-016。以后如果新 run 暴露相同问题，只更新本文对应条目或新增 H-xxx，不再新建 demo 专属问题文档。

## P0 问题

### H-001 Orchestrator 输出没有被 runtime ingest

状态：已完成。

问题：
Agent 可以写出 `orchestrator-session.json`、`agents/*/handoff.json`、业务代码和 archive 文本，但 `run.json` 与 `orchestration/state.json` 仍停在 `waiting_for_agent_output`。

影响：
Runtime 没有权威状态视图。`status`、`reconcile` 和 `finalize` 无法可靠判断 run 是 ready、blocked 还是 completed。

解决方案：

- 增加 runtime-internal `ingest` 步骤。
- 校验 `orchestrator-session.json`。
- 将 session actions 物化为 dispatch contracts。
- 将 handoff 绑定到 action id。
- 更新 `agent-runs.json`、`parallel-execution.json` 和一致性 artifact。
- 在 `status`、`reconcile`、`finalize` 前执行 ingest。

验收标准：

- session 有 action 但 runtime artifact 为空时，run 必须显示 inconsistent。
- ingest 后，每个 required action 都能追溯到 dispatch contract、handoff expectation 和 gate。
- ingest 不能在没有 provider-origin receipts 的情况下让 true harness 通过。

完成依据：

- 已新增 `ingestOrchestratorSession`，复用 Orchestrator session 校验、normalization 和 runtime artifact 物化逻辑。
- `status` 在读取当前 run 前会执行 ingest，但不会刷新 true harness proof，避免掩盖 stale evidence。
- `reconcile` / `finalize` 在 gate 计算前执行 ingest，并随后由 finalize 重新生成 evidence。
- ingest 会写出 `orchestration/orchestrator-runtime-consistency.json`，记录 session action、agent run 与 dispatch contract 的物化一致性。
- provider capability unknown 不再阻止 session ingest；它仍会让 true harness proof 失败，但不会让 `dispatch-contracts.json`、`agent-runs.json` 继续为空。
- 已新增 replay fixture 覆盖“session 有 action、runtime artifacts 为空、provider receipt 缺失”的场景。
- 验证命令：`npm test`。

### H-002 Dispatch contracts 和 wave history 缺失

状态：已完成。

问题：
模型侧子 Agent 可能已经运行，但 `dispatch-contracts.json`、`agent-runs.json` 和 `parallel-execution.json` 仍为空。

影响：
缺少可审计 execution graph，无法证明并行、依赖、ownership 和完成状态。

解决方案：

- 每个 planned agent action 都必须物化为 dispatch contract。
- 每个 contract 记录 dependencies、parallel group、role、expected handoff、expected receipt 和 expected outputs。
- Runtime 记录 wave started / completed 事实。
- 缺 completed wave 时阻断 true harness evidence。

验收标准：

- Required contracts 数量与 required actions 数量一致。
- 每个 required contract 都有 started/completed wave，或有明确 blocker。
- 缺 wave history 时，status 必须显示缺失的 action id。

完成记录：

- `src/core/orchestrator.ts` 已在 session ingest 时从 dispatch contract 物化 `parallel-execution.json`：
  - 只要 `next_actions` 中存在 planned agent action，即使 `agent_runs` 尚未展开，也会物化 dispatch contract。
  - session 进入 blocked 路径时不再清空 action ledger，仍保留 contract、parallel plan 和 wave 证据链。
  - 每个 contract 若没有 wave，会先写入 `waiting_for_agent_output` started wave。
  - `done` contract 会补齐 `completed` wave，并更新 `executed_parallel_groups`。
  - `blocked` contract 会补齐 `blocked` wave，并更新 `blocked_parallel_groups`。
  - 该逻辑不伪造 provider receipt；provider-origin proof 仍由 H-003 独立阻断。
- `src/core/dispatch.ts` 已让缺少 `agent_runs` 的 planned action contract 继承 action outputs 中声明的 handoff path，避免 expected handoff 与计划输出不一致。
- `src/core/status.ts` 已新增 `currentRunDispatch`，输出 contract 数、wave 数和 `missingCompletedWaveActionIds`；缺 completed wave 时 `currentRunConsistency` 为 `inconsistent`。
- `src/core/format.ts` 已把缺失 completed wave 的 action id 展示到 CLI status 文本。
- `test/demo-replay.mjs` 和 `test/smoke.mjs` 已增加/调整回放断言：
  - ready agent contract 会得到 started wave，且 status 点名缺 `agent-qa` completed wave。
  - done/completed agent contract 会自动得到 completed wave，`missing_completed_wave_contracts = []`。
  - planned action 即使没有 `agent_runs`，也必须生成 dispatch contract、expected handoff/receipt 和 started wave。
  - blocked run 也不能丢失 dispatch contract 与 wave ledger。
- 验证：`npm test` 通过。

### H-003 Provider-origin receipts 缺失

状态：已完成。

问题：
即使截图或 handoff 暗示子 Agent 已运行，provider capability 仍可能是 unknown，且 `orchestration/provider-receipts/` 缺失。

影响：
run 无法证明原生子 Agent 执行。截图不足以作为 true harness proof。

解决方案：

- 为 Codex 和 Claude 定义 Orchestrator handback 协议。
- 记录 provider、provider agent id、provider session id、task handle 或 trace id、output snapshot、output sha256、started_at、completed_at。
- 将 provider UI observation 单独存放在 `orchestration/provider-observations/`。
- provider metadata 不可得时，保持 `true_harness_passed=false`。

验收标准：

- 每个 required agent contract 都有有效 provider-origin completed receipt。
- receipt 缺 metadata、output snapshot 或 integrity 时校验失败。
- provider observation 永远不能满足 receipt gate。

完成记录：

- `src/core/provider-evidence.ts` 已新增 `validateProviderReceipt()`，统一校验 provider-origin receipt，并返回具体失败原因。
- provider-origin receipt 必须满足：
  - `provider` 为 `codex` 或 `claude`。
  - `origin = provider_native_subagent`。
  - `receipt_type = provider_completed`。
  - `status = completed`。
  - provider agent id、provider session id 不能缺失或使用 synthetic/current-session 值。
  - provider task handle 或 trace id 至少存在一个。
  - `started_at`、`completed_at` 存在。
  - output snapshot 必须落在 `orchestration/provider-outputs/<action>.json`。
  - integrity nonce 与 output sha256 必须存在且 hash 校验通过。
  - metadata 必须标明 `origin = provider_native_subagent` 和 `provider_output_snapshot`。
  - metadata 中的 `provider_output_snapshot` 必须存在，并且必须与 receipt 的 `output_path` 指向同一个 provider output snapshot。
- `writeProviderOriginReceipt()` 已强制把原始输出复制为 provider output snapshot，并把 sha256 绑定到该 snapshot。
- `true-harness-evidence.json` 已输出每个 receipt 的 `invalid_reasons`、`output_path` 与 integrity sha256；无效 receipt 不再只显示布尔值。
- `status` 已新增 `currentRunProviderReceipts`，可显示 receipt 总数、有效数、缺失 provider receipt 的 action id、无效 provider receipt 的 action id。
- CLI `status` 已展示 provider receipt 缺失/无效 action。
- `doctor` 已改为使用 evidence 中的 `valid_receipt_count`，不再用 provider receipt 文件数量作为 true harness runtime evidence 通过条件。
- provider observation 仍只进入 `provider_observations` 诊断区，`proof_boundary = diagnostic_only_not_true_harness_proof`，不能满足 receipt gate。
- 测试覆盖：
  - runtime-only receipt 不能通过，并输出无效原因。
  - 缺 metadata、provider output snapshot 或 integrity 的 provider-origin 形态 receipt 不能通过。
  - provider-origin receipt 会生成 `orchestration/provider-outputs/<action>.json` 快照。
  - metadata provider output snapshot 与 receipt output path 不一致时校验失败。
  - provider observation 存在但 receipt 缺失时，`true_harness_passed=false`。
  - status 能点名 missing/invalid provider receipt action。
- 验证：`npm test` 通过。

### H-004 True harness evidence 变 stale

状态：已完成。

问题：
`true-harness-evidence.json` 可能早于后续 session、handoff、dispatch contract、receipt、final gate 或 acceptance evidence 更新。

影响：
旧 evidence 可能被误读为当前证明。

解决方案：

- 在 true harness evidence 中记录 source artifact 的 mtime 和 content hash。
- `status`、`reconcile`、`finalize` 必须检查 freshness。
- `reconcile` 重新生成 stale evidence。
- `finalize` 必须阻断 stale evidence。

验收标准：

- 任意 source artifact 修改后，true harness evidence 必须被标记为 stale。
- stale evidence 不能满足 archive 或 final gate。
- status 必须指出导致 stale 的 source artifact。

完成记录：

- `true-harness-evidence.json` 已记录 `source_artifacts`，包含每个 source 的 `exists`、`mtime_ms` 和 `sha256`。
- source artifact 覆盖范围已扩展到：
  - `run.json`
  - `orchestrator-session.json`
  - `agent-runs.json`
  - `dispatch-contracts.json`
  - `parallel-execution.json`
  - `provider-capability.json`
  - `provider-capability-resolution.json`
  - `method-provenance.json`
  - `agent-acceptance-matrix.json`
  - `acceptance-matrix.json`
  - `final-gates.json`
  - 标准证据：`evidence/test-results.md`、`evidence/review.md`、`evidence/risk-review.md`、`evidence/commits.md`、`evidence/push.md`
  - `provider-receipts/*.json`
  - `provider-outputs/*.json`
  - `provider-observations/*.json`
  - `agents/*/handoff.json`
- `writeTrueHarnessEvidence()` 已调整生成顺序：先写 `method-provenance.json`，再采样 `source_artifacts`，避免 evidence 刚生成就因为 method provenance 被判 stale。
- `staleTrueHarnessEvidence()` 会对 missing、created-after-generation、hash changed、mtime newer 逐项报出 source id。
- `staleTrueHarnessEvidence()` 现在会重新计算当前 source set；如果 evidence 生成后新增了 source artifact，例如新的 `final-gates.json`、`provider-receipts/*.json` 或 `provider-outputs/*.json`，即使旧 evidence 中没有记录该文件，也会标记为 `created after evidence generation`。
- `status` 已新增 `currentRunTrueHarnessFreshness`，显示 `fresh/stale/missing` 和具体 `staleSources`。
- CLI `status` 已展示 stale source 列表。
- `validateTrueHarnessEvidenceFiles()` 已把 stale evidence 作为 consistency error；`finalizeRun()` 的 dispatch / true_harness gate 会因此 blocked。
- `archiveRun()` 通过 `trueHarnessCheck()` / `preArchiveHarnessCheck()` 复用同一 stale consistency 校验，stale evidence 不能满足 archive gate。
- 测试覆盖：
  - 修改 `orchestrator-session.json` 后 evidence stale，status 显示 `orchestrator_session`。
  - 修改 `provider-outputs/agent-dev-T1.json` 后 evidence stale，status 显示 `provider_output:agent-dev-T1.json`。
  - 修改 `evidence/test-results.md` 后 evidence stale，source 显示 `qa_evidence`。
  - evidence 生成后新增 `final-gates.json` 或新的 `provider-receipts/*.json` 时会判 stale，并在 status 中显示新增 source。
  - 刚生成的 evidence 不会因 `method-provenance.json` 生成顺序而立即 stale。
- 验证：`npm test` 通过。

### H-005 Handoff 存在但未被 runtime 采纳

状态：已完成。

问题：
标准 `agents/*/handoff.json` 可能已经存在，但 runtime 没有把它们采纳到 `agent-runs.json`、evidence collector、gate status 或 final report 中。

影响：
Agent 工作仍只是旁路文本证据，而不是权威 run 状态。

解决方案：

- ingest 按 role schema 校验每个 handoff。
- handoff 必须链接到 dispatch contract。
- handoff 引用的 evidence 必须存在。
- Markdown report 只能作为 handoff 引用的 evidence，不能替代 handoff。

验收标准：

- 有效 handoff 必须能在 agent run state 中看到。
- handoff evidence 缺失或无效时，相关 gate blocked。
- markdown-only report 不能通过 final gates。

完成记录：

- `src/core/orchestrator.ts` 已在 session ingest / persist 阶段执行 handoff adoption：
  - 对每个 agent dispatch contract 查找标准 handoff 候选路径。
  - 通过 role schema 和 evidence existence 校验后，若 `agent-runs.json` 中还没有对应 agent run，会自动采纳为 `native_agent_run`。
  - 已采纳的 agent run 会记录 `actionId`、`dispatchContractId`、`handoffFile`、`executionSource=true_harness`、`executedBy=native_agent`、`executionStatus=completed`。
  - 若 agent run 已存在且 handoff 有效，会补齐 completed 状态和 handoff/action/contract 链接。
  - 已采纳 handoff 会同步把对应 dispatch contract 标记为 `done`，并补齐 `parallel-execution.json` 中的 completed wave，避免 agent-run 已完成但 dispatch/wave 仍停在 waiting。
  - handoff evidence 缺失或 schema 无效时不会被采纳为 completed agent run。
- `true-harness-evidence.json` 仍以 dispatch contract 为 required handoff 集合；handoff 缺失、schema 无效或 evidence 缺失都会进入 `handoff_validation.invalid`，并阻断 `true_harness_passed`。
- Markdown report 只作为 handoff evidence 引用时有效；单独存在 `evidence/test-results.md` 等 markdown 文件但没有对应标准 handoff 时，不能通过 true harness / final gate。
- 测试覆盖：
  - 已存在的有效 `agents/T1/handoff.json` 会自动进入 `orchestration/agent-runs.json`。
  - 已采纳 handoff 会让 dispatch contract 变为 `done`，并产生 completed wave。
  - handoff 引用的 evidence 文件缺失时不会被采纳，`handoff_validation.passed=false`。
  - markdown-only report 存在但没有标准 handoff 时，`reconcileRun()` 保持 blocked，`true_harness` gate 不通过。
- 验证：`npm test` 通过。

### H-006 QA / Review recheck 结果没有建模

状态：已完成。

问题：
初始 QA 或 Review action 可以 block，后续 rework 和 recheck 可以 pass，但 status 和 gates 仍显示 QA / Review missing 或 blocked。

影响：
Runtime 无法表达正常 fix-loop 行为。

解决方案：

- 建模 action lineage：original check、finding、rework、recheck、resolves、supersedes。
- Gate 计算使用同一 lineage 中最新有效结果。
- recheck pass 必须引用其解决的 blocker 或 finding。
- evidence collector 同时索引原始 finding 和 resolved recheck evidence。

验收标准：

- 初始 QA block 加关联 QA recheck pass 时，QA gate 通过。
- 初始 Review findings 加关联 reviewer recheck pass 时，Review gate 通过。
- recheck 缺 evidence 或 lineage 时，不能覆盖早先 block。

完成记录：

- 新增 `src/core/quality-lineage.ts`，生成 `orchestration/quality-lineage.json`：
  - 按 `role + task_id` 建模 QA / Reviewer 的 `original_check`、`findings`、`rework`、`rechecks`、`resolved_findings`、`unresolved_findings` 和 `invalid_rechecks`。
  - QA 的 `fail / blocked` 和 Reviewer 的 `changes_requested / blocked` 会形成 finding / blocker。
  - QA `pass` 或 Reviewer `approved` 只有在 `resolves` 或 `supersedes` 引用已存在 finding，并且 handoff schema 与 evidence 文件都有效时，才能作为有效 recheck 覆盖早先 blocker。
  - recheck 缺 evidence、缺 `resolves / supersedes`、引用未知 blocker / finding 时，会进入 `invalid_rechecks`，不能让 gate 通过。
- `reconcileRun()` / `finalizeRun()` 已接入 `quality-lineage.json`：
  - `qa` gate 使用 QA lineage 的最新有效结果。
  - `review` gate 使用 Reviewer lineage 的最新有效结果。
  - `recheck_fix_loop` 不再因为旧 `FIX-*` 目录存在就永久 blocked；有效 recheck pass 会关闭同一 lineage 中的原始 finding。
- `archiveRun()` 已接入同一 lineage：
  - run-level QA / Review / recheck gate 使用 `quality-lineage.json`。
  - task-level QA / Review 检查使用 lineage 中的 latest valid handoff，避免旧的 `qa-T1/status.json` 或 `reviewer-T1/status.json` 把已复查通过的任务误判为 blocked。
- `true-harness-evidence.json` 已索引 `quality_lineage`，同时保留原始 handoff chain；证据中能看到原始 finding 和 resolved recheck evidence。
- 测试覆盖：
  - 初始 QA `fail`，后续 QA recheck `pass` 并 `resolves / supersedes` 原 finding 时，`qa` 和 `recheck_fix_loop` gate 通过。
  - 初始 Reviewer `changes_requested`，后续 Reviewer recheck `approved` 并 `resolves / supersedes` 原 finding 时，`review` 和 `recheck_fix_loop` gate 通过。
  - recheck `pass` 但缺少 lineage 引用时，不能覆盖早先 QA blocker，`qa` 和 `recheck_fix_loop` 保持 blocked。
- 验证：`npm test` 通过。

### H-007 Final gates 缺失或被绕过

状态：已完成。

问题：
Archive 或 Committer Agent 可以写 handoff 或报告，但 `orchestration/final-gates.json` 缺失。

影响：
用户可能看到 archive 文本就误以为 completed，但 runtime 从未 finalize。

解决方案：

- 只有 runtime archive finalize 可以写 final gates。
- Archive Agent handoff 是 finalize 的输入，不是 finalization 本身。
- 只有 final gates 通过后，run status 才能变为 `completed`。
- final gates 通过前生成的报告必须标记为 pre-archive 或 blocked。

验收标准：

- Archive handoff 存在但 final gates 缺失时，run 保持 blocked 或 ready_for_commit。
- 没有 final gates pass 时不能生成 `Final Archive Report`。
- run status、session status、report status 必须一致。

完成记录：

- 新增 `src/core/final-gates.ts`，统一校验 runtime final gates：
  - `final-gates.json` 必须存在。
  - 必须是合法 JSON。
  - `generated_by` 必须是 `imfine-runtime`。
  - required gates：`planning`、`dispatch`、`qa`、`review`、`recheck_fix_loop`、`committer`、`push`、`archive`、`true_harness`、`project_knowledge` 必须全部为 `pass`。
- `archiveRun()` 已收紧完成边界：
  - archive agent handoff / archive report 只作为 archive finalize 的输入和输出，不再等同于 finalization。
  - archive 预备阶段即使基础检查暂时全 pass，也只写 `Blocked Archive Report`，并标注 runtime final gates pending，避免 final gates 生成前出现 `Final Archive Report`。
  - 写出 runtime `final-gates.json` 后会立刻用统一校验复核；校验不通过时强制保持 blocked。
  - `updateRun()` 只有在 archive status completed 且 runtime final gates 校验通过时，才允许 run 进入 `completed`；否则强制转为 blocked 并记录原因。
- `finalizeRun()` 已在写出 `final-gates.json` 后执行统一校验；只有 gate 全 pass 且 final gates 来源合法时，才允许 run 进入 `completed`。
- `status` 已接入 final gates 来源和完整性校验：
  - completed run 缺 final gates 时显示 `inconsistent_missing_final_gates`。
  - final gates 伪造来源或 required gates 不完整时显示 `invalid_final_gates: ...`，并把 current run consistency 标为 inconsistent。
  - final gates 全 pass 但 run 尚未 completed 时显示 `final_gates_pass_run_not_completed`，避免 session / run / report 状态不一致被吞掉。
- 测试覆盖：
  - completed run 缺 final gates 时，status 为 inconsistent。
  - 伪造 `generated_by=archive-agent` 且 required gates 不完整时，status 为 inconsistent，并点名 final gates 来源不合法。
  - happy reconcile / harness acceptance 路径仍能由 runtime 生成 final gates，并只在全部 required gates pass 后生成 `Final Archive Report`。
- 验证：`npm test` 通过。

### H-008 Acceptance matrix 缺失

状态：已完成。

问题：
run 可以交付代码，但没有结构化矩阵说明每个 required requirement 是通过、替代实现还是偏离需求。

影响：
Runtime 无法区分完整交付、合理 demo substitute 和未接受 deviation。

解决方案：

- 要求 Agent-authored acceptance matrix。
- 覆盖所有 required 用户需求。
- 建模 `pass`、`blocked`、`demo-substitute`、`deviation`。
- deviation 必须被 QA/Review 接受。

验收标准：

- 缺 acceptance matrix 时 final gates blocked。
- Required deviation 未被 QA/Review 接受时 final gates blocked。
- Runtime 只校验 schema 和 evidence，不按关键词判断产品语义。

完成记录：

- `src/core/reconcile.ts` 的 acceptance matrix 已改为 Agent-authored contract：
  - runtime 只读取 Agent 写出的 `orchestration/agent-acceptance-matrix.json` 或 `agents/{product-planner,architect,qa,reviewer}/acceptance-matrix.json`。
  - runtime 不再硬编码具体业务 required 类目，也不再根据用户需求关键词推断产品语义。
  - Agent-authored matrix 必须声明 `required_coverage_declared_complete=true` 或 `coverage.required_complete=true`，表示 Agent 已覆盖全部 required 用户需求；缺失声明时 `acceptance_matrix` gate blocked。
  - 缺少 Agent-authored matrix 时，会生成 blocked 的 `agent_authored_acceptance_matrix.missing` 项。
- runtime 结构化校验 matrix item：
  - `id`、`category`、`requirement_level`、`classification`、`status` 必须合法。
  - 支持 `pass`、`blocked`、`demo-substitute`、`deviation`。
  - required item 处于 `pass` 时必须有 evidence，且 evidence 文件必须存在；缺证据一律 blocked，不能只靠 `accepted_by_review=true` 放行。
  - required `demo-substitute` / `deviation` 必须使用 deviation 模板字段：`requested`、`delivered`、`reason`、`risk`、`accepted_by`、`evidence`、`required_follow_up`。
  - required `demo-substitute` / `deviation` 必须被 QA 或 Reviewer 接受，`deviation.accepted_by` 至少包含 `qa` 或 `reviewer`，并且 `accepted_by_review=true`。
  - deviation evidence 也必须存在；缺失时 blocked。
- `acceptance-matrix.json` 输出已包含：
  - `summary.sources`
  - `summary.required_coverage_declared_complete`
  - source 文件、item 数和 schema 错误列表。
- Agent 模板已同步要求：`acceptance-matrix.json` 必须由 Agent 编写，并声明 `required_coverage_declared_complete=true`。
- 测试覆盖：
  - 缺 Agent-authored acceptance matrix 时，`acceptance_matrix` gate blocked。
  - Agent-authored matrix 声明完整覆盖且 required item evidence 存在时，`acceptance_matrix` gate pass，且 runtime 不会追加固定业务类目。
  - Agent-authored matrix 未声明完整覆盖时，`acceptance_matrix` gate blocked。
  - required item `pass` 但没有 evidence 时，`acceptance_matrix` gate blocked。
  - required deviation 未被 QA/Reviewer 接受时，`acceptance_matrix` gate blocked。
  - required deviation 模板完整、evidence 存在且 QA/Reviewer 接受时，`acceptance_matrix` gate pass。
- 验证：`npm test` 通过。

### H-009 Commit / push policy 未强制执行

状态：已完成。

问题：
新项目 run 可能不是 git 仓库，可能没有 commit，或跳过 push，但仍生成类似 archive 的输出。

影响：
交付代码版本不可追踪。

解决方案：

- run 创建时记录 commit policy。
- 检测 git 初始化状态和 HEAD baseline。
- 对新项目，如果策略允许则创建 baseline / implementation commit；否则进入 `awaiting_user_approval` 或 `ready_for_commit`。
- 只有 remote policy 和 origin 允许时才 push。

验收标准：

- 没有 commit evidence 时 run 不能 completed。
- 没有 remote 时输出明确 push blocker 或 no-remote 状态。
- completed final report 必须引用 commit hash。

完成记录：

- run 创建时已记录 `commit_policy`：
  - `auto_commit_allowed`
  - `commit_requires_user_approval`
  - `push_allowed`
  - `push_requires_remote`
  - `new_project_requires_initial_baseline`
  - `initial_baseline_commit_required`
- `gitflow.ts` 已具备 runtime commit / push 执行路径：
  - committer handoff 必须有效且 ready。
  - 策略不允许 runtime commit 时进入 `awaiting_user_approval`，并写 `evidence/commits.md`。
  - 新项目无 HEAD 时按策略创建 initial baseline commit 或阻断等待用户批准。
  - push 无 remote 时写 `push_blocked_no_remote`、`push_user_action`、`push_local_commit`，并输出明确用户动作。
- `reconcileCommits()` 已收紧 commit evidence：
  - 非 git 仓库会写 `blocked_no_git_repository`，记录 `commit_blocked_reason=git repository is not initialized`，并让 commit / committer gate blocked。
  - git 仓库无任何 commit hash 时会写 `blocked_no_commit`，记录 `commit_blocked_reason=missing commit hash`，并让 commit / committer gate blocked。
  - 旧的 `evidence/commits.md` 文件不能单独满足 commit gate；必须有真实 commit hash 或明确 blocker。
  - commit identity drift 仍会 blocked，避免多个冲突 commit 被误认为同一交付版本。
- `archiveRun()` 的 commit outcome 已改为必须同时具备 commit hash 和 `evidence/commits.md`；只有 `commit_blocked_reason` 不再满足 archive completion 口径。
- `reconcile` final report 已新增 `Commit Trace`，completed report 会列出 `commit hashes`、`final head` 和 `push status`。
- push policy：
  - 无 remote 时 `reconcilePush()` 写 `evidence/push.md`，状态为 `push_blocked_no_remote`，明确提示配置 origin remote。
  - 当前策略允许本地 completed 但必须显式记录 no-remote blocker 和本地 commit hash；这满足“交付版本可追踪”和“没有 remote 输出明确 blocker”的要求。
- 测试覆盖：
  - 非 git 项目即使已有旧 `evidence/commits.md`，commit / committer gate 仍 blocked，run 保持 blocked。
  - 无 remote 时写出 `push_blocked_no_remote` 和明确用户动作。
  - completed final report 必须包含 `Commit Trace` 和实际 commit hash。
- 验证：`npm test` 通过。

### H-010 Status 基于文件存在性而不是 gate 状态

状态：已完成。

问题：
status 有时只检查固定文件，例如 `evidence/test-results.md`，而不是从 runtime artifacts、handoff lineage、receipts 和 final gates 推导状态。

影响：
status 可能在有效 recheck handoff 存在时仍显示 QA/Review missing，也可能遗漏真正 blocker。

解决方案：

- status 读取 ingest 和 gate calculation 生成的标准 runtime state。
- 显示 latest QA/Review lineage result。
- 显示 stale evidence source。
- 显示缺失的 receipt/action/handoff id。
- 显示 next owner：Orchestrator、Agent、runtime、provider、user 或 project code。

验收标准：

- status 输出足以决定下一步动作。
- status 不需要用户手工重建目录状态。
- status 与 reconcile/finalize 结论一致。

完成记录：

- `status()` 已在读取当前 run 时执行 `ingestOrchestratorSession()`，先把 Orchestrator session 物化为 runtime artifacts，再计算状态。
- status 已读取并展示标准 runtime state：
  - `currentRunGates`：来自 runtime `final-gates.json`；未 finalize 时使用标准 runtime artifacts 推导临时 gates。
  - `currentRunDispatch`：contract 数、wave 数、缺失 completed wave 的 action id。
  - `currentRunProviderReceipts`：receipt 总数、有效数、缺失 provider-origin receipt 的 action id、无效 receipt 的 action id。
  - `currentRunTrueHarnessFreshness`：fresh / stale / missing，以及 stale source 列表。
  - `currentRunQualityLineage`：QA、Review、recheck fix loop 最新 lineage 结果、latest handoff、未解决 finding 和 invalid recheck 数量。
  - `currentRunBlockers`：blocker summary、下一步证据要求和诊断文档。
  - `currentRunLatestCheckpoint`：最新 runtime checkpoint。
  - `currentRunNextOwner`：推导下一步 owner，取值包括 runtime、orchestrator、agent、provider、user、project_code。
- 未 finalized 时，status 不再只用 `evidence/test-results.md` / `evidence/review.md` 文件存在性判断 QA / Review；会优先使用 `quality-lineage.json` 推导的 latest QA / Review / recheck 状态。
- status 对 true harness、final gates 和 consistency 的结论与 reconcile/finalize 共用同一类 runtime artifact：
  - stale true harness evidence 会显示 stale source，并把 consistency 标为 inconsistent。
  - provider receipt 缺失 / 无效会点名 action id。
  - completed run 缺 final gates、伪造 final gates 或 final gates 不完整都会标为 inconsistent。
  - dispatch contract 缺 completed wave 会点名 action id。
- CLI `formatStatus()` 已展示 quality lineage 和 next owner，用户无需手工重建目录状态即可知道下一步该由谁处理。
- 测试覆盖：
  - status 能显示 final gates 中的 gate 状态、queue action 状态、blocker summary 和 latest checkpoint。
  - status 能显示有效 QA recheck lineage，QA gate 使用 lineage pass，而不是文件存在性。
  - 当 Review lineage 缺失 / blocked 时，`currentRunNextOwner` 指向 agent，并说明 Review lineage blocked。
  - stale true harness evidence、缺 provider receipt、无效 provider receipt、缺 completed wave、缺 final gates / 伪造 final gates 都会在 status 中显示明确原因。
- 验证：`npm test` 通过。

## P1 问题

### H-011 Evidence collector 未统一标准路径

状态：已完成。

问题：
QA、Review、commit、push 和 archive evidence 可能散落在 handoff、agent 目录或临时 report 文件中。

解决方案：

- 将引用 evidence 收敛到 run-local 标准路径：
  - `evidence/test-results.md`
  - `evidence/review.md`
  - `evidence/risk-review.md`
  - `evidence/commits.md`
  - `evidence/push.md`
- 保留原始引用。

验收标准：

- Gate calculation 可以依赖标准 evidence 路径。
- status 能说明缺失的是哪个标准路径。

完成记录：

- `collectStandardEvidence()` 已统一收敛标准 evidence 路径：
  - `evidence/test-results.md`
  - `evidence/review.md`
  - `evidence/risk-review.md`
  - `evidence/commits.md`
  - `evidence/push.md`
- collector 支持两类来源：
  - `review/qa-report.md`、`review/code-review.md`、`review/risk-review.md` 等临时 review 报告。
  - `agents/*/handoff.json.evidence` 中引用的原始 evidence 文件。
- 新增 `orchestration/standard-evidence.json` manifest：
  - 每条标准 evidence 记录 `id`、`standard_path`、`exists` 和 `sources`。
  - `sources` 保留原始引用路径，避免收敛后丢失出处。
- gate calculation 已依赖标准路径：
  - `finalizeRun()` 在计算 gates 前执行 `collectStandardEvidence()`。
  - `pre-archive-harness-evidence.json` 和 `archiveRun()` 均以标准 evidence 路径判断缺失。
- `status()` 已新增 `currentRunStandardEvidence`：
  - 显示缺失的标准 evidence 路径。
  - 显示每个标准 evidence 是否存在，以及对应原始 sources。
- CLI `status` 已展示 standard evidence missing / records。
- 测试覆盖：
  - QA handoff 引用 `evidence/qa-output.md` 时，collector 会生成标准 `evidence/test-results.md`。
  - `standard-evidence.json` 会记录该标准 evidence 的原始 source。
  - status 能点名缺失的标准路径，例如 `evidence/test-results.md`。
- 验证：`npm test` 通过。

### H-012 Provider observation 诊断不完整

状态：已完成。

问题：
截图和 UI observation 能帮助人工审计 run，但目前没有稳定保存和证明边界说明。

解决方案：

- 增加 `orchestration/provider-observations/*.json`。
- 记录截图路径、observed display names、closed count、timestamp 和用户备注。
- true harness evidence 明确区分 observation 和 verified receipt。

验收标准：

- status 可以显示 provider observations present。
- observations 永远不能满足 receipt gates。

完成记录：

- 新增 `src/core/provider-observation.ts`：
  - `writeProviderObservation()` 统一写入 `orchestration/provider-observations/*.json`。
  - observation 记录 `timestamp`、`observed_agent_names`、`observed_closed_count`、`screenshot_path`、`user_note`。
  - 每条 observation 写入 `proof_boundary=diagnostic_only_not_true_harness_proof`。
  - 兼容旧字段：`agent_names`、`closed_count`、`screenshot`、`note`、`observed_at`。
- `true-harness-evidence.json` 已复用统一 reader：
  - 输出 `provider_observations.present`、`observed_native_agents`、`observation_count`、完整 observations 列表和 proof boundary。
  - observations 仅进入诊断区，不参与 provider receipt gate。
  - provider observation 存在但 provider-origin receipt 缺失时，`true_harness_passed=false`。
- `status()` 已新增 `currentRunProviderObservations`：
  - 显示 observation 是否存在、数量、observed display names、closed count、screenshots、notes 和 proof boundary。
- CLI `status` 已展示 provider observations 诊断信息。
- 测试覆盖：
  - 写入 observation 后，true harness evidence 能显示 observed names、closed count、screenshot path、user note 和 proof boundary。
  - status 能显示 provider observations present、closed count 和 screenshot path。
  - observation 存在但 receipt 缺失时，provider receipt gate 仍缺失，true harness 不能通过。
- 验证：`npm test` 通过。

### H-013 Agent name mapping 缺失

状态：已完成。

问题：
Provider display name 无法追溯到 action id。

解决方案：

- 启动子 Agent 时写 `orchestration/agent-name-map.json`。
- 映射 provider display name、action id、role、parallel group、expected output 和 started_at。

验收标准：

- 截图中的 agent name 能追溯到 action id、dispatch contract、handoff、receipt 和 gate。

完成记录：

- `orchestration/agent-name-map.json` 已在 Orchestrator persist 阶段生成。
- 每条映射记录包含：
  - `provider_display_name`
  - `action_id`
  - `agent_id`
  - `dispatch_contract_id`
  - `role`
  - `task_id`
  - `parallel_group`
  - `started_at`
  - `expected_output`
  - `handoff_path`
  - `provider_receipt_path`
  - `gate_ids`
- 映射不再自行推断 dispatch、handoff 或 receipt 路径，而是优先绑定实际 `dispatch-contracts.json` 中的 contract 字段：
  - `dispatch_contract_id` 对齐 contract id。
  - `action_id` 对齐 contract action id。
  - `handoff_path` 对齐 contract expected handoff。
  - `provider_receipt_path` 对齐 contract expected provider receipt。
- `status()` 已新增 `currentRunAgentNameMap`，可直接输出 provider display name 到 action id、dispatch contract、handoff、receipt 和 gate 的追溯关系。
- CLI `status` 已展示 agent name map 摘要。
- 测试覆盖：
  - smoke 验证 `agent-name-map.json` 中的 action id、dispatch contract id、handoff path、provider receipt path 与 `dispatch-contracts.json` 完全一致。
  - smoke 验证 status JSON 能读取并展示同一条映射链路。
- 验证：`npm test` 通过。

### H-014 Demo 项目 runtime requirements 未声明

状态：已完成。

问题：
生成项目可能在某个解释器或 runtime 版本下测试通过，但在另一个版本下失败，且没有声明版本要求。

解决方案：

- 新项目交付必须包含 README 或 runbook。
- 语言版本要求必须写入 `.python-version`、`pyproject.toml`、`package.json` 或等价文件。
- QA 和 archive evidence 必须记录实际 runtime version 和测试输出。

验收标准：

- runtime 版本错误时显示环境 blocker，而不是误报为产品失败。
- QA evidence 必须记录实际 runtime version、执行命令和测试输出。
- Archive 必须引用 runtime requirements 证据，并在缺失时阻断 completed。

完成记录：

- 新增 `src/core/runtime-requirements.ts`，统一生成：
  - `orchestration/runtime-requirements.json`
  - `orchestration/runtime-requirements.md`
- runtime requirements 会确定性检查：
  - 新项目是否包含 `README` 或 `RUNBOOK`。
  - 语言版本是否声明在 `package.json.engines.node`、`.node-version`、`.nvmrc`、`.python-version`、`pyproject.toml.requires-python`、`go.mod`、`Cargo.toml.rust-version`、`pom.xml` 或 Gradle 配置等文件中。
  - 当前环境是否能实际读取声明语言的 runtime version，例如 `node --version`、`python3 --version`、`go version`、`rustc --version`、`java -version`。
  - `evidence/test-results.md` 是否记录实际 runtime version、测试命令和测试输出。
- `status()` 已新增 `currentRunRuntimeRequirements`：
  - 展示 runtime requirements 总状态。
  - 展示声明语言、声明文件、实际观测版本和 blocked checks。
  - 未 finalized 时临时 gates 会包含 `runtime_requirements`。
  - 缺 runtime requirements 或 QA 环境证据时，`currentRunNextOwner.owner=project_code`，原因会点名环境 blocker。
- `archiveRun()` 已把 runtime requirements 接入 run-level gate：
  - 缺 README/runbook、缺版本声明、缺实际版本或缺 QA 命令输出时，archive blocked。
  - final gates 增加 `runtime_requirements`，只有该 gate pass 才允许 completed。
  - archive report 增加 `Runtime Requirements` 章节，引用 `orchestration/runtime-requirements.json`。
- `reconcileRun()` 已接入同一 gate：
  - final gates 增加 `runtime_requirements`。
  - final report 增加 `Runtime Requirements` 章节。
  - 缺环境证据时写入 blocker/fix task，不会误报为产品功能失败。
- `true-harness-evidence` freshness source 已包含 `runtime_requirements`，环境证据更新后旧 true harness evidence 会变 stale。
- 回归测试覆盖：
  - status 能显示 runtime requirements blocked checks，并把 next owner 指到 `project_code`。
  - 补齐 README、`package.json.engines.node` 和 QA 版本/命令/输出后 runtime requirements pass。
  - reconcile 缺环境证据时 `runtime_requirements` gate blocked，final gates 不能 completed。
  - reconcile happy path 和 harness acceptance 端到端 fixture 都必须补齐 runtime requirements 才能 completed。
- 验证：`npm test` 通过。

## P2 问题

### H-015 Replay fixtures 缺失

状态：已完成。

问题：
反复出现的问题仍靠人工发现，没有进入测试。

解决方案：

- 为每个 P0 问题增加 minimized replay fixture。
- 将 fixtures 纳入 `npm test`。
- 断言 status/reconcile/finalize 行为。

验收标准：

- handoff 存在但 receipt 缺失的 fixture 不能通过。
- Archive handoff 存在但 final gates 缺失的 fixture 不能 completed。
- stale evidence fixture 必须阻断 finalize。

完成记录：

- 新增 `test/replay-coverage.mjs`，维护 H-001 到 H-016 的 replay coverage 表。
- coverage 表逐项记录：
  - 问题编号。
  - fixture 名称。
  - 对应测试文件。
  - 覆盖层级，例如 status、reconcile、archive、true harness evidence、dispatch。
  - 期望阻断行为。
- `test/replay-coverage.mjs` 会强制校验：
  - H-001 到 H-014 必须连续覆盖。
  - 每项必须声明 fixture、覆盖层级和 blocked behavior。
  - 每项引用的测试文件必须真实存在。
  - 每个 issue id 必须能在 `docs/HARNESS_ISSUE_BACKLOG.md` 中找到。
- `package.json` 的 `npm test` 已纳入 `node test/replay-coverage.mjs`。
- 当前 replay coverage 覆盖到：
  - H-001 ingest / session runtime split。
  - H-002 dispatch contracts / wave history。
  - H-003 provider-origin receipt。
  - H-004 true harness freshness。
  - H-005 handoff adoption / invalid evidence / markdown-only report。
  - H-006 QA / Review recheck lineage。
  - H-007 runtime final gates。
  - H-008 acceptance matrix。
  - H-009 commit / push policy。
  - H-010 status gate derivation。
  - H-011 standard evidence collector。
  - H-012 provider observations。
  - H-013 agent name map。
  - H-014 runtime requirements。
- 验证：`npm test` 通过。

### H-016 Harness 改进没有跨 run 评估

状态：已完成。

问题：
修改 harness 时，没有结构化记录它针对哪个失败，以及是否真正修复。

解决方案：

- 对非平凡 harness 修改使用 harness evolution record。
- 链接 source failure、affected components、predicted impact、verification run、observed result 和 regression risks。

验收标准：

- 一个 harness 修改可以从失败追溯到验证结果。
- 反复出现的问题能被识别为 evolution record 未完成或验证失败。

完成记录：

- 新增 `docs/harness-evolution/README.md`，定义 harness evolution record 的用途和字段要求。
- 新增 `docs/harness-evolution/2026-06-02-h001-h015-runtime-gates.json`：
  - 记录 H-001 到 H-015 的 source failures。
  - 记录本轮影响组件。
  - 记录预期影响。
  - 记录验证命令 `npm test`。
  - 记录观测结果。
  - 记录回归风险和后续要求。
- 新增 `test/harness-evolution.mjs`：
  - 校验 `docs/harness-evolution/*.json` 至少存在一条。
  - 校验 schema version、record id、状态、source failures、affected components、predicted impact、verification commands、observed result 和 regression risks。
  - 校验每个 source failure 的 H-xxx 编号都能在 `docs/HARNESS_ISSUE_BACKLOG.md` 中找到。
- `package.json` 的 `npm test` 已纳入 `node test/harness-evolution.mjs`。
- `test/replay-coverage.mjs` 已扩展到 H-016，确保 H-015/H-016 本身也有覆盖记录。
- 验证：`npm test` 通过。

## 彻底解决方案

### 阶段 1：冻结失败形态

在修改行为前，先为 H-001 到 H-010 创建 minimized fixtures。

每个 fixture 必须断言：

- `status` 显示 blocked 或 inconsistent；
- `reconcile` 不能把 run 推成 completed；
- `finalize` 不能生成 completed final report；
- blocker 必须指出 required evidence 和 owner layer。

### 阶段 2：建设 ingest 管线

实现 runtime-internal ingest，并让它成为 status、reconcile、finalize 的前置步骤。

输出：

- `session-validation.json`
- `handoff-validation.json`
- `dispatch-contracts.json`
- `agent-runs.json`
- `parallel-execution.json`
- `orchestrator-runtime-consistency.json`

### 阶段 3：建设 evidence 和 lineage

实现 provider receipt handback、handoff validation、evidence collector 和 QA/Review recheck lineage。

输出：

- `provider-receipts/*.json`
- `provider-observations/*.json`
- `agent-name-map.json`
- 标准 `evidence/*.md`
- action ledger 或 dispatch contracts 中的 lineage 字段

### 阶段 4：建设 runtime final gates

Final gates 只能由 runtime 计算。

输入：

- session validation
- dispatch 和 wave state
- provider receipts
- standard handoffs
- QA/Review latest lineage
- acceptance matrix
- commit/push evidence
- true harness evidence freshness
- project knowledge freshness

输出：

- `acceptance-matrix.json`
- `final-gates.json`
- fresh `true-harness-evidence.json`
- `.imfine/reports/<run-id>.md`

### 阶段 5：让 status 成为真实驾驶舱

Status 必须显示：

- consistency state
- latest gate state
- stale evidence source
- missing action/receipt/handoff ids
- commit/push/archive state
- next owner 和 next required artifact

### 阶段 6：强制项目可复现性

新项目交付必须包含可复现运行契约：

- README 或 runbook
- runtime version requirements
- test command
- actual test output
- archive verification freshness

## 完成定义

只有满足以下条件，run 才能 completed：

- required dispatch contracts 存在；
- required waves completed；
- required provider-origin receipts 校验通过；
- required handoffs 校验通过；
- QA/Review latest lineage 通过；
- acceptance matrix 存在且校验通过；
- true harness evidence fresh 且通过；
- commit/push policy 已满足，或明确 blocked 且不进入 completed；
- final gates 通过；
- run/session/report status 一致。

在这些条件满足前，imfine 可以生成有价值的业务 demo，但不能声称完成了 completed true harness delivery。
