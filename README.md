# Encode Lab 开发 TODO（从 0 到可用版本）

本清单用于跟踪 `Encode Lab` 从当前阶段到首个可用版本（V1）的实施进度。

## 当前状态快照

- 技术栈：Tauri 2 + React + TypeScript + Rust
- 存储策略：本地 JSON（含 schemaVersion）
- 并发写控制：按文件独立锁 + 原子写（tmp + fsync + rename）
- 当前阶段：`M1` 进行中（数据底座已完成，进入转码链路开发）
- 产品模块调整：见 [`docs/产品业务逻辑与功能模块调整.md`](./docs/产品业务逻辑与功能模块调整.md)
- 前端偏好设置：内置轻量 i18n 与主题 Provider，当前支持 `zh-CN / en-US` 和 `浅色 / 深色 / 跟随系统`

## 里程碑 TODO

### M0 - 规格与基础工程

- [x] 输出完整 V1 功能规格文档（PRD + 技术规格）
- [x] 明确关键约束（并发 N、2-pass 预览降级、模板库、本地 JSON）
- [x] 补充编码器能力联动规则（如 `h265 + hevc_nvenc` 禁用 2-pass）
- [x] 补充分割线横纵切换要求
- [x] 补充 V2+ 后期展望（Server-Worker）并保持不影响 V1

### M1 - 本地数据底座与联调基础

#### Rust 数据模型与存储层
- [x] 建立 `models/ storage/ commands/` 分层模块
- [x] 实现 `TaskConfig / Template / AppSettings / JobHistory` 模型
- [x] JSON envelope 结构：`schemaVersion + updatedAt + data`
- [x] 文件路径管理：`settings.json / tasks.json / templates.json / jobs-history.json`
- [x] 写入原子化：临时文件写入 + `flush/sync_all` + `rename`
- [x] 并发写锁：按文件独立锁（`HashMap<PathBuf, Arc<Mutex<()>>>`）
- [x] 实现 repository：`settings/tasks/templates/jobs_history`
- [x] 轻量错误模型（`NotFound/SchemaVersionUnsupported/AtomicWriteFailed` 等）

#### Tauri 命令（CRUD）
- [x] `create_task`
- [x] `update_task`
- [x] `list_tasks`
- [x] `save_template`
- [x] `update_template`
- [x] `delete_template`
- [x] `duplicate_template`
- [x] `list_templates`
- [x] `get_settings`
- [x] `update_settings`

#### 测试与验证
- [x] repository smoke tests（初始化、并发写同文件、并发写不同文件）
- [x] `cargo test` 通过
- [x] 前端基础联调页面可用
- [x] 前端对接 `get_settings / list_tasks / list_templates`
- [x] 前端“一键生成测试数据”按钮（`create_task + save_template`）
- [x] `bun run build` 通过

### M1.5 - 命令与数据校验补强（建议尽快）

- [x] 在 Rust 命令层增加 payload 校验（字段范围、联动规则）
- [x] 将 `StorageError` 统一映射为结构化前端错误码
- [x] 增加 schemaVersion 升级钩子占位（`migrate_v1_to_v2`）
- [x] 增加 JSON 文件损坏恢复策略（备份回滚）
- [x] 补充集成测试：连续写入 + 读写竞争 + 异常中断恢复

### M2 - 转码引擎与队列调度

#### 环境探测与命令拼装
- [x] 实现 `detect_ffmpeg`
- [x] 实现编码器能力探测（至少覆盖当前平台可用编码器）
- [x] 编码器注册表扩展：加入 `AV1/VP9` 能力项（可用性探测 + 基础能力标记）
- [x] 编码器说明元数据 JSON 化维护（展示名、描述、平台提示、能力备注）
- [x] 实现任务参数 -> ffmpeg 命令拼装器
- [x] 实现冲突参数处理和提示（结构化参数优先）
- [x] 细化 `AV1/VP9` 的参数策略（码率模式、preset 适配、硬件能力差异提示）
- [x] 参数策略细化扩展到全部编码器（CRF/CBR-ABR 约束、preset 合法集、硬件差异提示）
- [x] 前端低保真可交互原型（shadcn 组件优先）：任务配置/预览/执行看板/模板复用四区块

#### 队列与进程生命周期
- [ ] 实现全局并发 `N` + FIFO 调度
- [ ] 实现任务状态机：`queued -> preparing -> running <-> paused -> completed|failed|canceled`
- [ ] 实现 `pause/resume/cancel`（macOS 信号控制）
- [ ] 实现任务指标采样（`progress/fps/speed/eta/time`）
- [ ] 实现 stderr 摘要与退出码落盘

#### 命令接口扩展
- [ ] `enqueue_transcode`
- [ ] `list_jobs`
- [ ] `get_job_metrics`
- [ ] `control_job`

### M2.5 - 预览能力

- [ ] 实现单播放器分割线对比渲染（同一播放器）
- [ ] 分割线方向切换：`vertical/horizontal`
- [ ] 分割线位置拖拽同步（`splitterPosition`）
- [ ] 参数变更防抖刷新（默认 300ms）
- [ ] 预览会话状态机（`idle/warming/running/updating/stopped/error`）
- [ ] `2-pass` 任务在预览中自动降级 `1-pass`
- [ ] 显示预览速率与估算转码速率

### M3 - 模板闭环与稳定性

- [ ] 模板页面完整操作（新增/编辑/复制/删除/搜索）
- [ ] 模板直预览入口（不经新建任务）
- [ ] 任务中心完整信息面板（参数明细、错误明细）
- [ ] 转码中缩略图抓取与展示
- [ ] 输出重名自动改名规则完全落地
- [ ] 日志滚动与导出（排障用）

### M4 - 验收与发布

- [ ] 对齐规格文档验收条目并逐项打勾
- [ ] 完成 E2E 回归（核心流程 + 失败场景）
- [ ] 打包发布（macOS 优先）
- [ ] 发布说明与已知问题清单

## V2+ 后期展望（不纳入 V1 验收）

- [ ] Server 调度原型
- [ ] Worker 注册与心跳
- [ ] 混合调度（拉取/推送）
- [ ] 混合媒资策略（共享存储/中转）

## 常用命令

```bash
# 前端构建
bun run build

# Tauri Rust 测试
cd src-tauri && cargo test

# 本地开发
bun run tauri dev
```
