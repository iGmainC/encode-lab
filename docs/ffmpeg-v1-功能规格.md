# Encode Lab V1 功能规格（PRD + 技术规格）

- 文档版本：`v1.0`
- 更新时间：`2026-02-21`
- 文档类型：`单一 MD（PRD + 技术规格）`
- 适用平台：`macOS 优先（接口预留跨平台扩展）`

## 1. 背景与目标

Encode Lab V1 面向视频转码参数调优与批量执行场景，核心价值是让用户在桌面端完成以下闭环：

1. 通过可视化表单快速生成 FFmpeg 参数。
2. 在转码前用近实时预览验证效果（并尽量贴近真实转码速率）。
3. 将单文件或多文件批量转码纳入统一队列管理。
4. 复用任务模板，减少重复配置成本。

### 1.1 产品目标

1. 提供可观测、可控制的进行中转码管理能力（进度、fps、暂停/继续、缩略图、参数明细）。
2. 提供覆盖视频常用参数的结构化任务表单，同时保留高级原始参数扩展能力。
3. 支持单播放器分割线对比预览，并允许实时调整参数。
4. 支持预览后批量转码（单选/多选），并由统一队列调度。
5. 支持本地任务模板库（增删改查、复用、直预览）。

### 1.2 非目标（V1 不做）

1. 账号体系与云端同步。
2. 远程转码农场与分布式调度（此能力作为 V2+ 后期展望，见第 13 章）。
3. Linux 全量适配与平台级特殊优化。
4. 音频复杂参数面板（V1 仅支持 `copy` 或原始参数输入）。

## 2. 范围定义（In Scope / Out of Scope）

### 2.1 In Scope

1. 系统 FFmpeg/FFprobe 检测与可用性提示。
2. 新建任务、编辑任务、预览任务、批量转码。
3. 转码任务队列：全局并发 `N`、FIFO、运行态控制。
4. 任务模板本地存储与复用。
5. 本地 JSON 数据持久化。

### 2.2 Out of Scope

1. FFmpeg 二进制随安装包分发。
2. 在线模板市场。
3. Web 端/移动端同步。
4. 完整覆盖 FFmpeg 全参数结构化配置。
5. 远程转码农场与分布式调度（此能力作为 V2+ 后期展望，见第 13 章）。

## 3. 角色与使用流程

### 3.1 目标用户

1. 内容创作者：反复调参以兼顾画质与体积。
2. 后期/运营：批量处理多个源视频，要求过程可监控、可暂停。
3. 技术用户：需要原始参数兜底能力，确保灵活性。

### 3.2 端到端主流程

1. 启动应用 -> 检测 `ffmpeg`/`ffprobe`。
2. 新建任务 -> 配置视频参数（含 `CRF`、`2-pass`）与音频模式。
3. 选择预览源文件 -> 启动预览 -> 拖动分割线对比效果 -> 实时改参。
4. 确认参数 -> 选择单个或多个输入文件 -> 入队转码。
5. 在任务中心查看进度、fps、缩略图、参数详情，并可暂停/继续。
6. 将配置保存为模板；后续可“模板直预览”并快速发起转码。

## 4. 模块规格

## 4.1 进行中 FFmpeg 转码进程管理

### 4.1.1 功能点

1. 查看进度：百分比、已处理时长、剩余预估时长。
2. 查看每秒渲染帧数：显示 `fps` 与 `speed`。
3. 控制任务：`pause`、`resume`、`cancel`。
4. 查看当前进度缩略图：按当前时间点抓取。
5. 查看本次转码详细参数：结构化参数 + 实际命令行。

### 4.1.2 行为规则

1. 进度更新频率默认 `1s`（可内部 500ms 采样、1s 刷新 UI）。
2. 进度计算优先依据 FFmpeg `time=` 与输入总时长比值。
3. `pause`/`resume` 在 macOS 使用进程信号（`SIGSTOP` / `SIGCONT`），必须保留同一进程上下文。
4. 缩略图优先基于当前 `timeMs` 生成，失败时保留上一次有效缩略图并提示“当前帧抓取失败”。
5. 参数详情必须可复制（便于排障与复现）。

### 4.1.3 边界与失败处理

1. 输入时长未知（直播流等）时，进度条降级为不定进度，仅展示已处理时长与瞬时 fps。
2. 暂停后若进程意外退出，任务状态转为 `failed`，并记录退出码与 stderr 摘要。

## 4.2 新建任务（大表单生成 FFmpeg 参数）

### 4.2.1 表单范围

1. 视频参数：结构化字段（V1 核心）。
2. 音频参数：仅 `copy` 或原始参数输入框。
3. 高级参数：原始命令行参数输入（文本区）。
4. 容器参数：输出容器支持 `mp4` / `mkv` / `mov`，MP4 可配置 `faststart`。

### 4.2.2 视频参数（结构化）字段

1. `videoCodecFormat`：`h264` / `h265` / `av1` / `vp9` / `copy`。
2. `videoEncoder`：根据 `videoCodecFormat` 动态可选（如 `libx264`、`h264_videotoolbox`、`libx265`、`hevc_videotoolbox`、`hevc_nvenc`、`libaom-av1`、`svtav1`、`av1_nvenc`、`av1_videotoolbox`、`libvpx-vp9`）。
3. `bitrateMode`：`CRF` / `CBR` / `ABR`。
4. `crf`：整数，默认 `23`，范围 `0-51`（软件编码器场景）。
5. `preset`：`ultrafast ... placebo`（软件编码器）或硬件编码器支持的 preset 集合。
6. `profile`：可选（如 `high`, `main`）。
7. `tune`：可选（如 `film`, `zerolatency`）。
8. `resolution`：`source` 或 `WxH`。
9. `fps`：`source` 或指定值（如 `24/25/30/60`）；UI 通过“保持原始帧率”开关控制，开启时不生成 `-r` 覆盖参数。
10. `pixelFormat`：如 `yuv420p`。
11. `gop`：关键帧间隔（可选）。
12. `enableTwoPass`：布尔，V1 必须支持（仅在编码器能力支持时可开启）。

### 4.2.2.1 AV1 高级参数（结构化入口，写入 advancedArgs）

1. `libaom-av1`：支持 `cpu-used`、`row-mt`、`tiles` 表单项，并生成 `-cpu-used`、`-row-mt`、`-tiles` 参数。
2. `svtav1`：支持 `tune`、`film-grain` 表单项，并生成 `-svtav1-params` 参数。
3. `av1_nvenc` / `av1_videotoolbox`：V1 暂不暴露软件编码高级项，仅复用通用码率、分辨率、FPS、像素格式等参数。

### 4.2.3 音频参数字段

1. `audioMode`：`copy` 或 `custom`。
2. `audioCustomArgs`：当 `audioMode=custom` 时可编辑（例如 `-c:a aac -b:a 192k`）。
3. 当输出容器为 MP4 时，命令拼装追加 `-strict -2`，兼容 TrueHD 等 FFmpeg 标记为 experimental 的音频 copy 写入场景。

### 4.2.4 高级原始参数

1. 字段：`advancedArgs`（字符串）。
2. 允许用户追加参数，但禁止覆盖 I/O 路径（应用托管输入输出路径）。
3. 与结构化参数冲突时，规则固定为：结构化参数优先，冲突项在提交前提示。

### 4.2.5 参数校验规则

1. `enableTwoPass=true` 时，`videoCodecFormat` 不能为 `copy`。
2. `bitrateMode=CRF` 时，`crf` 必填。
3. `audioMode=copy` 时，`audioCustomArgs` 必须为空。
4. 当 `resolution` 与 `fps` 都为 `source` 时，不生成对应覆盖参数。
5. `videoEncoder` 必须属于当前 `videoCodecFormat` 的允许集合。
6. 当 `videoEncoder` 不支持 `2-pass` 时，`enableTwoPass` 必须强制为 `false` 且 UI 禁用该选项。
7. 当编码器为硬件编码器且不支持 `CRF` 时，`bitrateMode` 不可选 `CRF`，自动回退为 `CBR/ABR`。

### 4.2.6 编码器能力联动（V1）

1. 用户先选择 `videoCodecFormat`，再选择 `videoEncoder`。
2. 编码器列表由“编码格式 + 当前机器能力探测结果”共同决定。
3. 参数面板由编码器能力矩阵驱动显示和禁用状态。
4. 示例约束：`h265 + hevc_nvenc` 不支持 `2-pass`，因此 `enableTwoPass` 必须禁用。
5. 编码器切换后若已有参数不兼容，系统执行“降级并提示”：
6. `enableTwoPass=true` 且新编码器不支持时，自动改为 `false` 并 toast 提示。
7. `bitrateMode=CRF` 且新编码器不支持时，自动改为 `CBR` 并提示用户确认。
8. 预览与正式转码都复用同一能力矩阵，避免行为不一致。

## 4.3 任务预览（单播放器分割线对比）

### 4.3.1 核心交互

1. 仅一个时间轴定位当前帧，不提供视频播放控制。
2. 画面中间有可拖动分割线，默认左侧/上侧显示源视频当前帧，右侧/下侧显示应用当前参数后的预览帧，并在画面中明确标注“原始图像”和“转码后图像”。
3. 分割线方向支持切换：`vertical`（左右对比）与 `horizontal`（上下对比）。
4. 对比显示顺序支持切换：`source-first` 表示原始图像在左/上，`preview-first` 表示转码后图像在左/上。
5. 参数变更后自动刷新当前时间点的预览帧，保证按帧对比体验。
6. 主预览区支持打开独立 Tauri 预览窗口，并由系统窗口全屏承载画面对比；打开时同步当前时间点、分割线位置、分割方向、对比显示顺序和当前已生成帧，独立窗口首屏应复用该帧且暂不启动新的预览会话，只有用户继续拖动时间轴或复用帧加载失败时才生成新帧；同一预览 session 内已生成 PNG 需保留到 session 结束，避免独立窗口拿到的帧路径失效；独立窗口内的右上角按钮用于关闭该窗口。

### 4.3.2 技术语义（V1）

1. 预览为“近实时”，目标是快速反馈，不承诺逐帧绝对实时。
2. 预览速率优先与真实转码能力对齐（显示 `previewSpeed` 与 `estimatedTranscodeSpeed`）。
3. 预览帧先按当前编码参数编码为临时单帧视频，再解码为 PNG 展示；因此 `codec`、`CRF`、`preset`、`advancedArgs` 等质量参数应体现在对比图中。
4. 当任务启用 `2-pass` 时，预览阶段自动降级为单帧单 pass 编码预览，并在 UI 明确提示“预览近似最终效果”。
5. 正式转码时仍执行完整 `2-pass`。
6. 预览组件使用 PNG 单帧图片承载源帧与预览帧，避免 WebView 直接解码原始输入或目标编码格式失败。
7. 当源视频为 HDR 时，预览信息区展示 HDR 类型、色彩原色、传递函数、色彩空间、位深、MaxCLL/MaxFALL 与 mastering display 亮度；同时标注当前对比帧已转换为 SDR 图片显示，不代表真实 HDR 亮度效果。

### 4.3.3 预览更新策略

1. 参数改动触发 `300ms` 防抖。
2. 拖动时间轴时只更新当前时间指示，松手后生成该时间点的新帧；松手提交需覆盖控件外 release、pointer cancel、窗口失焦等边界，避免长期停留在 scrubbing 状态。
3. 新预览任务启动前取消旧预览任务，避免资源占满。

## 4.4 预览后批量转码

### 4.4.1 功能点

1. 可单选或多选输入视频。
2. 复用同一任务配置批量入队。
3. 统一输出目录，自动处理重名；入队时输出文件名包含 `jobId` 短后缀，避免并发任务在 FFmpeg 创建文件前选中同一路径。
4. 单个预览任务确认后可直接创建 task 与 job，job 写入 `jobs-history.json`，任务中心从真实历史读取，不使用前端 mock 数据。
5. V1 后台转码任务先记录 `queued`，调度器分配并发槽位后更新为 `running`，结束后更新为 `completed` 或 `failed`；应用退出中断时更新为 `interrupted`，并通过 `job:updated` 事件触发前端刷新。

### 4.4.2 队列策略

1. 全局并发 `N`（用户配置）。
2. 调度策略：`FIFO`。
3. 槽位释放后自动拉起队列头任务。
4. 单任务失败不阻塞后续任务（失败隔离）。

## 4.5 任务模板管理

### 4.5.1 功能点

1. 保存模板。
2. 编辑模板。
3. 复制模板。
4. 删除模板。
5. 按名称/标签搜索模板。

### 4.5.2 模板约束

1. 模板仅保存参数配置，不保存具体输入文件路径。
2. 模板更新采用版本号递增（用于排错与回滚）。
3. 模板名允许重名，但推荐唯一；搜索结果按最近使用排序。

## 4.6 模板直预览

1. 入口：模板列表页直接选择“预览”。
2. 流程：选择模板 -> 选择输入文件 -> 启动预览 -> 可直接发起批量转码。
3. 无需先进入“新建任务”页面。

## 5. 数据模型与本地存储（JSON）

### 5.1 存储位置

使用 Tauri `appDataDir`，macOS 预期路径类似：

`~/Library/Application Support/com.igmainc.encode-lab/`

### 5.2 文件规划

1. `settings.json`：应用设置（并发、默认输出目录等）。
2. `templates.json`：模板库。
3. `tasks.json`：任务定义（草稿/可复用任务）。
4. `jobs-history.json`：历史任务摘要（含失败信息）。
5. `runtime/`：运行期临时状态（可清理，不作为持久事实源）。

### 5.3 关键类型（逻辑模型）

```ts
type AppSettings = {
  concurrencyN: number; // 默认 2，范围 1-8
  ffmpegStrategy: "system";
  defaultOutputDir: string;
  thumbnailMode: "base64" | "imagePath";
};

type TaskConfig = {
  id: string;
  name: string;
  video: {
    codecFormat: "h264" | "h265" | "copy";
    encoder:
      | "libx264"
      | "h264_videotoolbox"
      | "libx265"
      | "hevc_videotoolbox"
      | "hevc_nvenc"
      | "copy";
    bitrateMode: "CRF" | "CBR" | "ABR";
    crf?: number;
    preset?: string;
    profile?: string;
    tune?: string;
    resolution?: "source" | { width: number; height: number };
    fps?: "source" | number;
    pixelFormat?: string;
    gop?: number;
    enableTwoPass: boolean;
  };
  audio: {
    mode: "copy" | "custom";
    customArgs?: string;
  };
  container: {
    format: "mp4" | "mkv" | "mov";
    faststart?: boolean;
  };
  advancedArgs?: string;
  output: {
    dir: string;
    fileNamePattern: string; // 例如 {inputName}_{taskName}
    overwrite: "autoRename";
  };
  createdAt: string;
  updatedAt: string;
};

type EncoderCapability = {
  codecFormat: "h264" | "h265";
  encoder: string;
  supportsTwoPass: boolean;
  supportsCrf: boolean;
  presets: string[];
};

type Template = {
  id: string;
  name: string;
  tags: string[];
  version: number;
  taskConfigSnapshot: TaskConfig;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 5.4 JSON 写入策略

1. 写入流程：`写临时文件 -> fsync -> rename`，避免中途损坏。
2. 读取失败时启用最近一次备份并提示用户。
3. 运行中仅允许单进程写入，避免并发写冲突。

## 6. Tauri 命令接口与前端类型契约

## 6.1 命令清单（V1）

1. `detect_ffmpeg() -> { ffmpegPath, ffprobePath, version }`
2. `list_encoder_capabilities() -> EncoderCapability[]`
3. `create_task(payload) -> { taskId }`
4. `update_task(taskId, payload) -> { ok }`
5. `start_preview(payload) -> { previewSessionId }`
6. `update_preview(previewSessionId, patch) -> { ok }`
7. `stop_preview(previewSessionId) -> { ok }`
8. `enqueue_transcode(taskId, inputFiles[]) -> { jobIds[] }`
9. `control_job(jobId, action: cancel) -> { ok }`（当前已接入取消；`pause/resume` 保留为后续控制能力）
10. `list_jobs(filter) -> Job[]`
11. `delete_job(jobId) -> { ok }`（删除已结束任务的历史记录，不删除输出文件；`queued/running` 需先取消）
12. `get_job_metrics(jobId) -> { progress, fps, speed, eta, frame, timeMs }`
13. `get_job_thumbnail(jobId, atMs?) -> { imagePath|base64 }`
14. `run_quality_evaluation({ jobId|taskId|referenceFile+distortedFile, metric: "vmaf", vmaf? }) -> { evaluationId, score, logPath }`
15. `save_template(payload) / list_templates() / apply_template(templateId)`

为支持模板完整管理，V1 同步补充：

1. `update_template(templateId, payload) -> { ok }`
2. `delete_template(templateId) -> { ok }`
3. `duplicate_template(templateId) -> { templateId }`

## 6.2 事件通道（建议）

1. `job:updated`：推送任务状态变化。
2. `job:metrics`：基于 FFmpeg `-progress pipe:1` 推送运行指标，包含 `progress`、`fps`、`speed`、`etaSec`、`timeMs` 和 2-pass 阶段。
3. `preview:frame`：推送预览帧或帧引用。
4. `preview:state`：推送预览状态变化。

## 6.3 Job 类型契约

```ts
type JobStatus =
  | "queued"
  | "preparing"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

type Job = {
  id: string;
  taskId: string;
  inputFile: string;
  outputFile: string;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
  sizeChangePercent?: number; // 输出相对输入的体积变化率，负数表示变小
  inputVideoSizeBytes?: number;
  outputVideoSizeBytes?: number;
  videoSizeChangePercent?: number; // 仅视频轨道的体积变化率，按 ffprobe packet size 累加
  queuePosition?: number;
  slotIndex?: number;
  status: JobStatus;
  metrics?: JobMetrics;
  commandLine: string;
  error?: {
    code: string;
    message: string;
    stderrTail?: string;
  };
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
};

type JobMetrics = {
  frame: number;
  fps: number;
  speed: number; // x 倍速
  timeMs: number;
  progress: number; // 0-100
  etaSec?: number;
};

type PreviewConfig = {
  inputFile: string;
  clipRange?: { startMs: number; endMs: number };
  renderScale: 0.25 | 0.5 | 0.75 | 1.0;
  compareOrientation: "vertical" | "horizontal";
  splitterPosition: number; // 0-1
  taskConfigSnapshot: TaskConfig;
};
```

## 7. 状态机与并发调度规则

## 7.1 Job 状态机

`queued -> preparing -> running <-> paused -> completed | failed | canceled`

状态转移规则：

1. `queued -> preparing`：调度器分配到并发槽位。
2. `preparing -> running`：进程成功启动。
3. `running -> paused`：收到 `pause`（macOS `SIGSTOP`）。
4. `paused -> running`：收到 `resume`（macOS `SIGCONT`）。
5. `running -> completed`：退出码 `0`。
6. `running|paused -> canceled`：用户取消，进程终止后收敛。
7. 任意运行态 -> `failed`：非零退出码、I/O 错误、依赖缺失。

当前实现已支持 `queued|running -> canceled`。`pause/resume` 仍是规格目标，尚未接入前端控制按钮和后端命令。

## 7.2 Preview 状态机

`idle -> warming -> running -> updating -> running -> stopped | error`

1. 参数变更触发 `updating`，旧预览会话被取消。
2. 启用 `2-pass` 时，`warming` 阶段强制降级为单帧参数预览。
3. 独立预览窗口使用系统全屏展示，并在平台支持时禁用缩放、最小化和尺寸调整。

## 7.3 调度规则

1. 并发由 `AppSettings.concurrencyN` 控制。
2. `N` 可在运行期修改；新值对未启动队列立即生效。
3. 队列采用 `FIFO`，但保留未来扩展优先级字段。
4. 单任务失败不触发全队列失败。

## 8. 错误处理与恢复策略

## 8.1 错误分类

1. 环境错误：找不到 `ffmpeg/ffprobe`、权限不足、磁盘空间不足。
2. 配置错误：参数冲突、非法值、输出目录不可写。
3. 运行错误：进程崩溃、输入文件损坏、编码器不可用。

## 8.2 标准错误码（建议）

1. `FFMPEG_NOT_FOUND`
2. `FFPROBE_NOT_FOUND`
3. `INVALID_TASK_CONFIG`
4. `OUTPUT_PATH_NOT_WRITABLE`
5. `PROCESS_SPAWN_FAILED`
6. `PROCESS_NON_ZERO_EXIT`
7. `THUMBNAIL_GENERATION_FAILED`
8. `PREVIEW_START_FAILED`

## 8.3 恢复策略

1. `pause`/`resume` 失败时，立即回读进程状态并与 UI 对齐。
2. 缩略图生成失败时不影响主任务执行，仅显示告警。
3. 任务失败后可“一键复制命令行 + 错误摘要”用于重现。
4. 应用重启后可恢复未完成任务的历史记录（状态标记为 `interrupted` 并建议重试）。

## 9. 非功能需求（性能、稳定性、可观测性）

## 9.1 性能目标（V1）

1. FFmpeg 检测完成时间：`< 2s`（冷启动，不含首次安装场景）。
2. 任务指标更新延迟：`<= 1s`。
3. 预览参数变更到首帧更新：目标 `<= 3s`（受机器性能影响，超时需提示）。
4. 队列调度开销：槽位释放到下一个任务启动 `<= 500ms`（正常 I/O 条件）。

## 9.2 稳定性目标

1. JSON 持久化写入可恢复，不因中断导致整体损坏。
2. 单任务失败隔离，不影响其他任务执行。
3. 长时间批量转码过程中，UI 不因高频事件卡死（事件节流）。
4. 桌面端提供系统托盘图标与菜单；主窗口关闭仅隐藏到托盘，不退出应用。
5. 通过托盘或系统退出应用时，如存在 `queued`/`running` 任务，必须弹出二次确认。

## 9.3 可观测性

1. 记录命令行、退出码、stderr 尾部、关键时间点。
2. 对关键行为打点：启动任务、暂停、继续、失败、取消、模板应用。
3. 日志文件按日滚动，限制单文件大小（如 10MB）。

## 10. 验收标准（可测试条目）

1. 单任务转码时，进度、`fps`、`speed`、`eta` 连续更新且无明显回跳。
2. 并发 `N=1/2/4` 场景下，队列调度符合 FIFO，无重复启动。
3. 运行中 `pause/resume` 后，任务可继续并输出可播放文件。
4. 转码进行中可以查看缩略图，时间点与当前进度基本一致。
5. `2-pass` 任务预览自动降级为单帧参数预览，正式转码执行完整两遍。
6. 当选择 `h265 + hevc_nvenc` 时，UI 必须禁用 `2-pass` 并给出明确提示。
7. 多文件批量中单个任务失败不阻塞其余任务完成。
8. 模板保存后可在模板页直接预览并继续发起转码。
9. 预览分割线支持横纵切换，切换后拖动行为与画面裁剪方向一致。
10. 音频 `copy` 与 `custom` 模式命令拼装正确。
11. 输出重名文件自动追加序号，不覆盖旧文件。
12. 缺失 FFmpeg 时给出可操作引导，不出现静默失败。
13. 已完成任务可发起 VMAF 质量评估，并返回平均分、参与帧数、日志路径和实际命令。

## 11. 测试场景矩阵（单元/集成/E2E）

| 编号 | 场景 | 单元测试 | 集成测试 | E2E |
| --- | --- | --- | --- | --- |
| T1 | 参数表单校验（CRF、2-pass、audio mode） | 是 | 是 | 是 |
| T2 | 结构化参数 -> 命令拼装 | 是 | 是 | 否 |
| T2A | 编码器能力联动（如 hevc_nvenc 禁用 2-pass） | 是 | 是 | 是 |
| T3 | 预览参数防抖与会话替换 | 是 | 是 | 是 |
| T3A | 分割线横纵切换与拖动一致性 | 是 | 是 | 是 |
| T4 | 2-pass 预览降级为单帧参数预览 | 是 | 是 | 是 |
| T5 | 队列并发 N 调度 | 是 | 是 | 是 |
| T6 | pause/resume 信号控制 | 否 | 是 | 是 |
| T7 | 失败隔离与错误上报 | 是 | 是 | 是 |
| T8 | 缩略图抓取失败降级 | 是 | 是 | 否 |
| T9 | 模板增删改查与直预览 | 是 | 是 | 是 |
| T10 | 输出重名自动改名 | 是 | 是 | 是 |
| T11 | 已完成任务 VMAF 质量评估 | 是 | 是 | 是 |

## 12. 里程碑建议（M1 / M2 / M3）

## 12.1 M1：基础可用链路

1. FFmpeg 检测。
2. 任务表单（视频基础参数 + 编码器能力联动 + 音频 copy/custom + advancedArgs）。
3. 单任务转码与进度展示。
4. 基础命令拼装与错误处理。

## 12.2 M2：预览与队列

1. 单播放器分割线预览。
2. 分割线横纵切换与方向记忆。
3. 参数变更近实时预览。
4. 队列并发 `N` 与 `pause/resume`。
5. 缩略图与参数明细面板。

## 12.3 M3：模板与稳定性

1. 模板库（增删改查、复制、搜索、直预览）。
2. 历史记录与日志完善。
3. 验收用例与 E2E 回归。

## 12.4 M4（V2+）分布式调度探索

1. 建立 server 调度原型与 worker 注册机制，不影响 V1 发布节奏。

## 13. 后期展望（V2+：Server-Worker 分布式转码）

V1 仍以本机 UI、本机文件、本机 `ffmpeg` 进程和本地 JSON 队列为交付边界，不实现远程节点、跨节点传输或分布式调度。

V2+ 的节点拓展方向是将 EncodeLab 演进为 Controller，并通过独立 Node Agent 二进制接入下游机器，支持远程文件入口和集群任务分发。近期可实现的技术设计见 [`节点拓展与分布式转码设计.md`](./节点拓展与分布式转码设计.md)。

后续代码演进应优先避免继续强化本机路径假设，逐步将文件位置抽象为 `nodeId + path`，并将本机转码建模为内置 `local node`，为远程入口和多节点调度预留兼容边界。

## 14. 附录

## 14.1 参数映射示例

### 14.1.1 CRF（1-pass）示例

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -c:a copy \
  output.mp4
```

### 14.1.2 2-pass（正式转码）示例

```bash
# pass 1
ffmpeg -y -i input.mp4 \
  -c:v libx264 -b:v 2500k -pass 1 -passlogfile /tmp/encode-lab/job-123 \
  -an -f mp4 /dev/null

# pass 2
ffmpeg -i input.mp4 \
  -c:v libx264 -b:v 2500k -pass 2 -passlogfile /tmp/encode-lab/job-123 \
  -c:a copy \
  output.mp4
```

### 14.1.3 2-pass 任务预览降级示例

```bash
# 预览会自动改为当前时间点单帧参数预览（示意）
ffmpeg -ss 00:00:10 -i input.mp4 \
  -c:v libx264 -preset medium -crf 23 \
  -vf scale=1280:720 -frames:v 1 -an -f matroska \
  preview.mkv

ffmpeg -i preview.mkv -frames:v 1 \
  preview.png
```

## 14.2 命令拼装规则（简版）

1. 先拼装输入参数（`-ss/-t/-i`）。
2. 再拼视频参数（codec、rate control、filter、2-pass）。
3. 再拼音频参数（copy/custom）。
4. 最后拼容器与输出参数。
5. `advancedArgs` 在安全检查后追加，不允许覆盖输入输出路径。

## 14.3 文件命名与重名处理规则

默认输出名模式：`{inputName}_{taskName}.{ext}`

文件名保留：

1. 本机输出文件名保留空格、括号和 Unicode 字符；FFmpeg 通过参数数组接收路径，不依赖 shell 字符串转义。
2. 路径分隔符、控制字符和 `: * ? " < > |` 等跨平台高风险字符会被移除或替换。

重名处理：

1. 若不存在同名文件：直接写入。
2. 若存在：追加 `_1`、`_2`... 直到找到可用名。
3. 最终输出路径必须回写到任务详情，保证可追踪。

示例：

1. `demo_h264.mp4`
2. `demo_h264_1.mp4`
3. `demo_h264_2.mp4`

## 14.4 已锁定默认值（V1）

1. 首发平台：macOS 优先。
2. FFmpeg 来源：系统安装版本。
3. 存储方案：本地 JSON。
4. 并发策略：可配置并发 `N` + FIFO。
5. 预览策略：按帧图片对比，参数变化后刷新当前时间点。
6. 2-pass 策略：预览降级为单帧参数预览，正式转码执行 2-pass。
