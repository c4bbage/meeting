# 会议转录与会议管理改进方案（Codex Plan）

## 现状分析（聚焦实时转录与准确性）

### 实时转录链路
- 前端使用 Web Speech API 进行实时识别（`services/SpeechRecognition.js`）。
- 录音使用 `MediaRecorder`，用于回放与离线转写（`services/AudioRecorder.js`）。
- 后端 `faster-whisper`/`FunASR` 当前仅在“录音结束后”批量转写（`backend/transcription.py`/`backend/funasr_service.py`）。
- WebSocket 实时转写接口仅为占位（`backend/server.py` 的 `/ws/transcribe` 未实现实际识别）。

### 当前实时效果与准确性限制
- Web Speech 的“强制提交临时结果”策略可能导致**遗漏/截断**：
  - 2 秒强制提交后，真正的最终结果（更长、更准确）被“子串去重”过滤，导致内容丢失。
- 去重逻辑基于“子串包含”，会误杀**重复表达**或**扩展句**。
- 只使用 `result[0]`，忽略 `maxAlternatives` 带来的多候选优化机会。
- Web Speech 不支持热词，无法利用已有热词库提升准确度。
- 没有基于 VAD 的切分或增量上下文维护，长句识别质量不稳定。
- 说话人分离为启发式估计，准确性有限且无修正机制。

---

## 实时转录效果改进空间（优先级从高到低）

### 1) 修正 Web Speech 的“临时结果提交”策略
- 以 `event.resultIndex` 为准维护“当前句块”，**只在 isFinal 时写入存储**。
- 临时结果只更新 UI，不写 DB；减少重复/截断问题。
- 如需防止丢失，可在 `onsoundend` 或超长静音时**补提交一次**，但必须替换“当前句块”而不是新增。

### 2) 改进去重逻辑（避免子串误杀）
- 仅对“完全相同文本 + 时间窗口”去重。
- 允许“前缀变长”的最终结果覆盖临时结果。
- 记录 `utteranceId` 并更新同一条记录，而不是新增。

### 3) 引入 WebSocket 流式后端（低延迟高准确）
- 前端用 `MediaRecorder` 的 `ondataavailable` 将 1-2 秒音频块发送到 `/ws/transcribe`。
- 后端维护滑动窗口（如 10 秒）+ 2 秒重叠，做近实时转写。
- 对每个窗口返回：`partial_text + start/end`，前端进行“增量拼接”。

### 4) 混合模式：实时 Web Speech + 后台高精度纠错
- 录音中使用 Web Speech 提供“低延迟实时文本”。
- 同时上传音频块到后端，**后台生成高准确版本**并回填差异。
- UI 展示“实时版本 / 精修版本”双标签，可一键替换或自动覆盖。

### 5) 识别置信度可视化
- 对低置信度片段标黄，支持用户一键修正并写入热词库。

---

## 准确性改进空间

### 1) 后端识别模型优化
- 提供模型切换（`small`/`medium`/`large-v3`），UI 显式提示性能成本。
- `vad_filter` 参数与 `min_silence_duration_ms` 可配置。
- 对中文加入标点恢复与数字规范化（如 ITN）。

### 2) 热词与上下文提示增强
- 热词来源不只“手动输入”，还可来自：
  - 会议标题 / 议程 / 参会人 / 历史任务 / 项目名
- 将上下文提示传递给 whisper 的 `initial_prompt`（已有接口，但可增强来源）。

### 3) 说话人分离升级
- 后端接入真正的 diarization（如 pyannote / NeMo）并写入 `speaker`。
- 前端保留“手动合并/重命名”能力，修正后可回写。

### 4) 纠错反馈闭环
- 用户修改文本时自动提取高频名词，写入热词库。
- 保存“纠错对齐数据”，用于后续识别的上下文优先级排序。

---

## 界面设计改进空间（面向会议与任务管理）

### 录音与转录界面
- “实时流”与“稳定段落”分区展示：临时文本单独一栏，最终段落固定到时间轴。
- 显示每段时间戳、说话人标记、置信度标识。
- 提供“标记行动项”“标记决策”“加星”快捷按钮。

### 会议详情页
- 结构化布局：
  - 左侧：会议元信息（时间、参与者、标签）
  - 中间：转录与音频时间轴
  - 右侧：摘要 / 决策 / TODO 列表
- 增加“搜索 + 高亮 + 跳转音频时间”的联动。

### 列表与总览
- 增加过滤维度（状态 / 参与者 / 标签 / 任务数量）。
- 增加“本周会议”视图，聚合待办数量与进度。

### 视觉方向
- 当前“赛博霓虹风”不利于长文阅读，可保留为“录音模式皮肤”；
- 会议管理界面建议使用更高对比度与低噪声背景，强调可读性与信息密度。

---

## 会议管理 + 纪要管理 + 待办跟踪 + 目标关联的设计建议

### 核心对象模型（建议新增）
- Meeting：会议（时间、参与者、议程、录音、状态）
- Minutes：纪要（摘要、要点、决策）
- ActionItem：行动项（来源会议、负责人、截止日）
- Task：任务（状态、优先级、依赖、关联目标）
- Goal / KR：目标与关键结果（关联任务与会议）
- DailyPlan：每日排期（当天任务与时间块）

### 关系图（逻辑）
```
Meeting → Minutes → ActionItem → Task → Goal/KR
                          ↘︎ DailyPlan (当日排期)
```

### 关键功能模块
1) 会议管理
   - 会议日历视图 + 会议列表
   - 自动生成纪要 / 关键点 / 决策 / TODO

2) 纪要与任务管理
   - 纪要区块可编辑、可版本对比
   - TODO 可一键转任务，并关联负责人/截止期

3) 会议待办跟踪
   - 会议详情页内显示“行动项进度”
   - 行动项跨会议视图（负责人视角、项目视角）

4) 每日排期管理
   - “今日任务”看板 + 时间块分配
   - 会议与任务冲突提示

5) 总目标到任务关联管理
   - 目标树视图（Objective → KR → Task）
   - 进度自动回流（任务完成率 → KR 进度）

---

## 数据模型与 API 扩展（方向性）

### 新表（前端 IndexedDB / 后端 SQLite）
- meetings: id, title, startAt, endAt, participants, agenda, status
- minutes: id, meetingId, summary, keyPoints, decisions, version
- action_items: id, meetingId, content, assignee, deadline, status
- tasks: id, title, status, priority, dueDate, goalId, meetingId, source
- goals: id, title, type, parentId, progress, owner
- daily_plans: id, date, items (taskId + timeBlock)

### API 方向
- `/api/meetings` CRUD
- `/api/minutes` CRUD + version
- `/api/action-items` CRUD
- `/api/tasks` CRUD + status change
- `/api/goals` CRUD + progress
- `/api/daily-plans` CRUD

---

## 实施路线图（建议）

### Phase 1（快速修复 + 可感知提升）
- 修复 Web Speech 去重/临时提交策略。
- UI 显示 TODO 列表（已存储但未展示）。
- 增加“低置信度标记 + 快速纠错入口”。

### Phase 2（实时流式 + 精度提升）
- 实现 `/ws/transcribe` 的增量识别（后端滑动窗口 + VAD）。
- 前端将音频块发送到后端，实时展示“精修版本”。
- 增加“多版本转录对比/切换”。

### Phase 3（会议管理升级）
- 新增 Meeting / Minutes / ActionItem / Task / Goal 数据模型与页面。
- 会议详情页整合纪要、任务、决策与音频。

### Phase 4（任务排期与目标联动）
- 引入 DailyPlan 日程编排。
- 目标树视图 + 任务进度回流。

