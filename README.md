# Encode Lab 开发 TODO（从 0 到可用版本）

本清单用于跟踪 `Encode Lab` 从当前阶段到首个可用版本（V1）的实施进度。

## 当前状态快照

- 技术栈：Tauri 2 + React + TypeScript + Rust
- 存储策略：本地 JSON（含 schemaVersion）
- 并发写控制：按文件独立锁 + 原子写（tmp + fsync + rename）
- 当前阶段：`M3` 进行中（本地转码、预览、任务中心与模板基础闭环已接入，进入 V1 稳定性收口）
- 产品模块调整：见 [`docs/产品业务逻辑与功能模块调整.md`](./docs/产品业务逻辑与功能模块调整.md)
- 前端偏好设置：内置轻量 i18n 与主题 Provider，当前支持 `zh-CN / en-US` 和 `浅色 / 深色 / 跟随系统`
- 自动更新：接入 Tauri updater，Release tag 仅接受 `vx.x.x` / `vx.x.x-beta`，版本比较遵循 SemVer
- 版本注入：发布构建通过 `bun run release:version` 从 tag 生成 Tauri `--config`，不要手动改多个版本文件发布

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
- [x] 实现全局并发 `N` + FIFO 调度
- [x] 实现基础任务状态机：`queued -> running -> completed|failed|canceled|interrupted`
- [x] 实现 `cancel` 控制（排队任务移除、运行中 FFmpeg 进程终止）
- [ ] 实现 `pause/resume`（macOS 信号控制）
- [x] 实现任务指标采样（`progress/fps/speed/eta/time`）
- [x] 实现 stderr 尾部摘要落盘
- [ ] 实现退出码落盘

#### 命令接口扩展
- [x] `enqueue_transcode_job`
- [x] `list_jobs`
- [x] 通过 `job:metrics` 事件推送运行指标
- [x] `control_job`（当前支持 `cancel`）
- [x] `delete_job`

### M2.5 - 预览能力

- [x] 实现单播放器分割线对比渲染（同一播放器）
- [x] 分割线方向切换：`vertical/horizontal`
- [x] 分割线位置拖拽同步（`splitterPosition`）
- [x] 参数变更防抖刷新（当前后端最小渲染间隔 500ms）
- [x] 预览会话状态机（`idle/warming/running/updating/stopped/error`）
- [x] `2-pass` 任务在预览中自动降级 `1-pass`
- [x] 显示预览速率与估算转码速率
- [x] 独立系统全屏预览窗口

### M3 - 模板闭环与稳定性

- [x] 模板页面基础操作（搜索、应用、复制、删除）
- [ ] 模板页面完整编辑能力
- [ ] 模板标签筛选
- [ ] 模板直预览入口（不经新建任务）
- [x] 任务中心基础信息面板（命令、错误、输入输出、状态与指标）
- [ ] 转码中缩略图抓取与展示
- [x] 输出重名自动改名规则落地（任务输出默认追加 jobId 短后缀，并在冲突时追加序号）
- [ ] 日志滚动与导出（排障用）
- [x] 已完成任务 VMAF 质量评估命令

### M4 - 验收与发布

- [ ] 对齐规格文档验收条目并逐项打勾
- [ ] 完成 E2E 回归（核心流程 + 失败场景）
- [x] 打包发布与自动更新链路（GitHub Release + Tauri updater 签名）
- [ ] 发布说明与已知问题清单

## V2+ 后期展望（不纳入 V1 验收）

- [ ] Server 调度原型
- [ ] Worker 注册与心跳
- [ ] 混合调度（拉取/推送）
- [ ] 混合媒资策略（共享存储/中转）

## V1 收口验收清单

本清单用于把当前阶段从“功能已接入”推进到“可发布、可验证、可维护”。勾选必须以代码、命令输出、Release 产物或真实运行结果为依据。

### 发布前本地检查

- [ ] `git status --short --branch` 确认只包含本次计划内改动。
- [ ] `bun run build` 通过。
- [ ] `cd src-tauri && cargo test` 通过。
- [ ] `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml")'` 通过。
- [ ] `git diff --check` 无空白错误。
- [ ] 版本 tag 使用 `vx.x.x` 或 `vx.x.x-beta`，并通过 `bun run release:version` 生成 Tauri 发布配置。

### v0.0.8-beta 发布检查

- [ ] `v0.0.8-beta` tag 位于 `main` 历史上。
- [ ] GitHub Actions `Release` workflow 全部 job 成功。
- [ ] Release 包含 `latest.json`、安装包和对应 `.sig` 签名资产。
- [ ] `https://github.com/iGmainC/encode-lab/releases/latest/download/latest.json` 可匿名访问。
- [ ] `latest.json.version` 等于 `0.0.8-beta`。
- [ ] `latest.json.platforms` 中每个平台都有非空 `signature`。
- [ ] `latest.json.platforms` 中每个 `url` 都指向 `iGmainC/encode-lab` 主仓库 Release，并且可匿名访问。
- [ ] 新安装包内置 updater endpoint 指向主仓库，不再依赖 `iGmainC/encode-lab-releases`。

### V1 主链路人工验收

- [ ] 选择本地视频后能读取元数据、时长、分辨率、HDR/编码标签。
- [ ] 调整编码器、码率模式、分辨率、FPS、2-pass 时，UI 联动和禁用规则符合能力矩阵。
- [ ] 预览页能生成源帧和转码后帧，分割线横纵切换与拖拽方向一致。
- [ ] 启用 2-pass 的任务在预览中显示降级提示，正式转码仍执行完整两遍。
- [ ] 入队后任务中心能看到 `queued/running/completed|failed|canceled|interrupted` 状态变化。
- [ ] 转码中能看到 `progress/fps/speed/eta/time` 指标更新。
- [ ] `cancel` 能取消排队任务和运行中的 FFmpeg 进程，并回写任务历史。
- [ ] 输出文件默认带 jobId 短后缀；重名冲突时自动追加序号，不覆盖旧文件。
- [ ] 任务完成后能查看命令、输入输出、错误或体积变化信息。
- [ ] 模板能保存、搜索、应用、复制、删除；应用模板会更新 `lastUsedAt`。
- [ ] 已完成任务可运行 VMAF 质量评估，并返回平均分、帧数、日志路径和实际命令。
- [ ] 缺失 FFmpeg 或 FFprobe 时给出可操作错误，不出现静默失败。

### 当前未完成但不阻塞 v0.0.8-beta

- [ ] `pause/resume` 信号控制。
- [ ] 退出码结构化落盘。
- [ ] 转码中缩略图抓取与展示。
- [ ] 模板页面完整编辑与标签筛选。
- [ ] 模板直预览入口。
- [ ] 日志滚动与导出。
- [ ] 完整 E2E 自动化回归。

## 常用命令

```bash
# 前端构建
bun run build

# Tauri Rust 测试
cd src-tauri && cargo test

# 本地开发
bun run tauri dev
```
