# Runtime 边界

imfine 分为三层：

- 方法层：角色、workflow、skill 和模板知识。
- 模型编排层：当前 provider 会话中的 Orchestrator 以及它启动的原生子 Agent。
- 确定性 runtime 层：本地状态、校验、patch、git、evidence 和 archive 物化。

Runtime 可以做：

- 创建 run 目录和确定性 artifact；
- 校验 task graph 结构和工程语义；
- 物化 dispatch contracts；
- 校验 handoff、receipt、evidence 文件和 final gates；
- 收集 patch、执行 git 操作、写 archive report。

公开用户流程只保留：

- `/imfine init`
- `/imfine run <需求文本|需求文件>`
- `/imfine status`

Runtime 禁止做：

- 从需求关键词推断产品形态；
- 代替模型判断架构、任务拆分、QA 结论、Review 结论或 Archive readiness；
- 启动 provider subagent；
- 暴露任何用于 launch、spawn 或 start Codex/Claude provider agent 的命令；
- 把 runtime-only receipt 伪装成 true harness proof。

Agent-authored artifacts 承载产品、架构、验收、QA、Review 和 Archive 判断。Runtime artifacts 只验证这些 artifacts 是否存在、是否满足 schema、是否引用了有效 evidence。
