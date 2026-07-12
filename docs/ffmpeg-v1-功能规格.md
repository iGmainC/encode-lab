# Encode Lab V1 功能规格（PRD + 技术规格）

- 文档版本：`v1.1`
- 更新时间：`2026-07-12`
- 文档类型：`单一 MD（PRD + 技术规格）`
- 适用平台：`macOS 优先（接口预留跨平台扩展）`

## 1. 背景与目标

Encode Lab V1 面向视频转码参数调优与批量执行场景，核心价值是让用户在桌面端完成以下闭环：

1. 通过可视化表单快速生成 FFmpeg 参数。
2. 在转码前用近实时预览验证效果（并尽量贴近真实转码速率）。
3. 将多个单文件转码任务纳入统一队列管理。
4. 复用任务模板，减少重复配置成本。

### 1.1 产品目标

1. 提供可观测、可控制的进行中转码管理能力（进度、fps、取消、错误诊断、参数明细）。
2. 提供覆盖视频常用参数的结构化任务表单，同时保留高级原始参数扩展能力。
3. 支持单播放器分割线对比预览，并允许实时调整参数。
4. 支持预览后单文件入队，并由统一队列调度；多文件批量套用保留为后续能力。
5. 支持本地参数方案库（保存、搜索、应用、复制和删除）；完整编辑保留为后续能力。

### 1.2 非目标（V1 不做）

1. 账号体系与云端同步。
2. 远程转码农场与分布式调度（此能力作为 V2+ 后期展望，见第 13 章）。
3. Linux 全量适配与平台级特殊优化。
4. 音频复杂参数面板（V1 仅支持 `copy` 或受音频输出白名单约束的原始参数输入）。

## 2. 范围定义（In Scope / Out of Scope）

### 2.1 In Scope

1. 系统 FFmpeg/FFprobe 检测与可用性提示。
2. 新建任务、编辑任务、预览任务和单文件入队执行。
3. 转码任务队列：全局并发 `N`、FIFO、运行态控制。
4. 任务模板本地存储与复用。
5. 本地 JSON 数据持久化。

### 2.2 Out of Scope

1. 用户自行替换或管理应用内置的 FFmpeg runtime。
2. 在线模板市场。
3. Web 端/移动端同步。
4. 完整覆盖 FFmpeg 全参数结构化配置。
5. 远程转码农场与分布式调度（此能力作为 V2+ 后期展望，见第 13 章）。

## 3. 角色与使用流程

### 3.1 目标用户

1. 内容创作者：反复调参以兼顾画质与体积。
2. 后期/运营：持续处理多个源视频，要求队列可监控、异常可定位、任务可取消。
3. 技术用户：需要原始参数兜底能力，确保灵活性。

### 3.2 端到端主流程

1. 启动应用 -> 检测 `ffmpeg`/`ffprobe`。
2. 在统一工作台选择或拖入源视频，并读取素材元数据。
3. 在常驻检查器中调整视频、音频、色彩/HDR、输出和高级参数。
4. 在同页用按帧对比复查当前参数效果，确认输出事实与执行约束后加入队列。
5. 在转码中心查看队列、进度、fps、错误和参数详情，并可取消任务或清理已结束记录。
6. 从方案库应用参数快照后回到工作台继续验证和调整。

切换或替换源素材时，旧素材元数据立即失效；重复选择同一路径也会推进选择版本并重新读取，只有路径与最新元数据来源一致后才恢复预览、校验和入队。

## 4. 模块规格

## 4.1 进行中 FFmpeg 转码进程管理

### 4.1.1 功能点

1. 查看进度：百分比、已处理时长、剩余预估时长。
2. 查看每秒渲染帧数：显示 `fps` 与 `speed`。
3. 控制任务：当前稳定契约支持 `cancel`；`pause`、`resume` 保留为后续能力。
4. 运行中缩略图保留为后续能力；当前以进度、fps、speed、ETA 与错误摘要作为执行证据。
5. 查看本次转码详细参数：结构化参数 + 实际命令行。

### 4.1.2 行为规则

1. 进度更新频率默认 `1s`（可内部 500ms 采样、1s 刷新 UI）。
2. 进度计算优先依据 FFmpeg `time=` 与输入总时长比值。
3. `pause`/`resume` 在后端状态机、退出恢复和跨平台行为稳定前不得在前端展示为可用控制。
4. 后续接入缩略图时，应基于当前 `timeMs` 生成，并在抓取失败时保留上一次有效缩略图。
5. 参数详情必须可复制（便于排障与复现）。

### 4.1.3 边界与失败处理

1. 输入时长未知（直播流等）时，进度条降级为不定进度，仅展示已处理时长与瞬时 fps。
2. 取消或运行异常后必须回写最终状态，并保留 stderr 摘要供详情检查器排障。

## 4.2 新建任务（大表单生成 FFmpeg 参数）

### 4.2.1 表单范围

1. 视频参数：结构化字段（V1 核心）。
2. 音频参数：仅 `copy` 或受音频输出白名单约束的原始参数输入框。
3. 高级参数：原始命令行参数输入（文本区）。
4. 容器参数：输出容器支持 `mp4` / `mkv` / `mov`，MP4 可配置 `faststart`。
5. 时长截取：在输出页签通过起止时间输入设置 `clipRange`；Dolby Vision RPU 保留链路锁定完整时长。

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
10. `pixelFormat`：如 `yuv420p`、`yuv420p10le`。
11. `gop`：关键帧间隔（可选）。
12. `enableTwoPass`：布尔，V1 必须支持（仅在编码器能力支持时可开启）。
13. `codecFormat=copy` 时固定 `encoder=copy`，隐藏并清空码率、preset、分辨率、帧率、像素格式、色彩重编码和 2-pass 字段；正式命令只生成视频流复制语义。

### 4.2.2.1 AV1 高级参数（结构化入口，写入 advancedArgs）

1. `libaom-av1`：支持 `cpu-used`、`row-mt`、`tiles` 表单项，并生成 `-cpu-used`、`-row-mt`、`-tiles` 参数。
2. `svtav1`：支持 `tune`、`film-grain` 表单项，并生成 `-svtav1-params` 参数。
3. `av1_nvenc` / `av1_videotoolbox`：V1 暂不暴露软件编码高级项，仅复用通用码率、分辨率、FPS、像素格式等参数。

### 4.2.3 音频参数字段

1. `audioMode`：`copy` 或 `custom`。
2. `audioCustomArgs`：当 `audioMode=custom` 时可编辑（例如 `-c:a aac -b:a 192k`），只接受“选项 + 值”成对出现的音频输出白名单。
3. 全音轨白名单为 `-acodec`、`-ab`、`-ar`、`-ac`、`-sample_fmt`、`-channel_layout`、`-ch_layout`、`-audio_service_type`。
4. 可限定音轨且允许追加数字索引（例如 `-b:a:0`）的白名单为 `-c:a`、`-codec:a`、`-b:a`、`-q:a`、`-qscale:a`、`-ar:a`、`-ac:a`、`-sample_fmt:a`、`-channel_layout:a`、`-ch_layout:a`、`-profile:a`、`-compression_level:a`、`-bsf:a`、`-frames:a`、`-disposition:a`、`-metadata:s:a`、`-tag:a`。
5. 视频参数、`-i`、容器或输出控制参数、裸路径与额外输出均拒绝；原始 `-af` / `-filter:a` 也不开放，因为 FFmpeg filtergraph 可内嵌文件或网络 I/O。模板保存、任务校验和命令构建复用同一白名单，旧方案在复制或应用前重新校验。
6. 当输出容器为 MP4 时，普通命令拼装追加 `-strict -2`，兼容 FFmpeg 标记为 experimental 的音频 copy 写入场景；Dolby Vision 专用 MP4 路线不把 TrueHD 当作可交付能力，改为在入队前明确要求用户切换 MKV。

### 4.2.4 高级原始参数

1. 字段：`advancedArgs`（字符串）。
2. 只接受当前专业面板生成的安全输出参数白名单：码率（`-b:v` / `-maxrate` / `-minrate` / `-bufsize`）、CRF/preset、色彩标签、libaom 速度与 tiles、受控的 SVT-AV1 tune/film-grain、`-dolbyvision 0|1` 与单值输出 metadata；所有参数必须按“选项 + 值”成对出现。
3. 未知 flag、无值 flag、filtergraph、任意编码器嵌套参数和 I/O 控制参数一律拒绝；开放式 FFmpeg CLI 无法可靠推断未知选项是否消费下一个 token，不能用启发式裸路径扫描替代白名单。
4. 与结构化参数冲突时，规则固定为：结构化参数优先，冲突项在提交前提示。

### 4.2.5 参数校验规则

1. `enableTwoPass=true` 时，`videoCodecFormat` 不能为 `copy`。
2. `bitrateMode=CRF` 时，`crf` 必填。
3. `audioMode=copy` 时，`audioCustomArgs` 必须为空；`audioMode=custom` 时必须通过音频输出白名单校验。
4. 当 `resolution` 与 `fps` 都为 `source` 时，不生成对应覆盖参数。
5. `videoEncoder` 必须属于当前 `videoCodecFormat` 的允许集合。
6. 当 `videoEncoder` 不支持 `2-pass` 时，`enableTwoPass` 必须强制为 `false` 且 UI 禁用该选项。
7. 当编码器为硬件编码器且不支持 `CRF` 时，`bitrateMode` 不可选 `CRF`，自动回退为 `CBR/ABR`。
8. 截取范围必须满足 `0 <= start < end <= duration`；非法输入必须阻止入队，不能静默退回整片。
9. 宽高、FPS、CRF 和码率字段必须是有限且在约束范围内的数值，`NaN` 或非法字符串不得进入队列。

### 4.2.6 编码器能力联动（V1）

1. 用户先选择 `videoCodecFormat`，再选择 `videoEncoder`。
2. 编码器列表由“编码格式 + 当前机器能力探测结果”共同决定。
3. 参数面板由编码器能力矩阵驱动显示和禁用状态。
4. 示例约束：`h265 + hevc_nvenc` 不支持 `2-pass`，因此 `enableTwoPass` 必须禁用。
5. 编码器切换后若已有参数不兼容，系统执行“降级并提示”：
6. `enableTwoPass=true` 且新编码器不支持时，自动改为 `false` 并 toast 提示。
7. `bitrateMode=CRF` 且新编码器不支持时，自动改为 `CBR` 并提示用户确认。
8. 预览与正式转码都复用同一能力矩阵，避免行为不一致。
9. HDR10/HLG 重编码必须使用 10-bit 或更高像素格式，并保持 BT.2020/PQ 或 BT.2020/HLG 标签；正式任务不会复用预览专用 SDR tone map。
10. Dolby Vision Profile 5 / compatibility 0 未开启 RPU 保留时禁止普通重编码；视频流复制不受该限制。开启 RPU 保留后 `audioMode` 必须为 `copy`，草稿和模板恢复时同步归一化，后端执行计划再次强制校验。容器可选 MKV（全轨归档）或 MP4（仅 Profile 8.1、AAC/AC-3/E-AC-3/ALAC/FLAC/MP3/Opus Copy，E-AC-3 JOC Atmos 保持码流）；MP4 预检必须拒绝 TrueHD Atmos、DTS、PCM、字幕、附件和 data 流，不能静默丢弃。

## 4.3 任务预览（单播放器分割线对比）

### 4.3.1 核心交互

1. 仅一个时间轴定位当前帧，不提供视频播放控制。
2. 画面中间有可拖动分割线，默认左侧/上侧显示源视频当前帧，右侧/下侧显示应用当前参数后的预览帧，并在画面中明确标注“原始图像”和“转码后图像”。
3. 分割线方向支持切换：`vertical`（左右对比）与 `horizontal`（上下对比）。
4. 对比显示顺序支持切换：`source-first` 表示原始图像在左/上，`preview-first` 表示转码后图像在左/上。
5. 参数变更后自动刷新当前时间点的预览帧，保证按帧对比体验。
6. 主预览区支持打开独立 Tauri 预览窗口，并由系统窗口全屏承载画面对比；打开时同步当前时间点、源帧率、分割线位置、分割方向、对比显示顺序和当前已生成帧，独立窗口首屏应复用该帧且暂不启动新的预览会话，只有用户继续拖动时间轴或复用帧加载失败时才生成新帧；源帧率用于复用主窗口按真实帧数计算的片尾安全区；同一预览 session 内已生成 PNG 需保留到 session 结束，避免独立窗口拿到的帧路径失效；独立窗口内的右上角按钮用于关闭该窗口。

### 4.3.2 技术语义（V1）

1. 预览为“近实时”，目标是快速反馈，不承诺逐帧绝对实时。
2. 仅展示后端实际测得的 `previewSpeed`；不把单帧速度伪装为整片转码耗时或体积预测。
3. 普通重编码的预览帧先按当前编码参数编码为临时单帧视频，再解码为 PNG 展示，因此 `codec`、`CRF`、`preset`、`advancedArgs` 等质量参数应体现在对比图中；视频 Copy 的正式命令仍使用 `-c:v copy`，其单帧预览不执行流复制与滤镜的非法组合，而是忽略 Copy 下的高级编码参数并使用 Matroska 内的 FFV1 无损临时运输层，使预览只表达源画面证据。
4. 当任务启用 `2-pass` 时，预览阶段自动降级为单帧单 pass 编码预览，并在 UI 明确提示“预览近似最终效果”。
5. 正式转码时仍执行完整 `2-pass`。
6. 预览组件使用 PNG 单帧图片承载源帧与预览帧，避免 WebView 直接解码原始输入或目标编码格式失败。
7. 当源视频为 HDR 时，检查器展示当前可读取的 HDR 类型、位深、色彩原色与传递函数。仅当运行时具备对应 tone map 能力时，预览帧才转换为 SDR 显示；降级路径会明确提示，不能把 SDR 显示效果当作真实 HDR 亮度依据。

### 4.3.3 预览更新策略

1. 参数改动触发 `300ms` 防抖。
2. 拖动时间轴时只更新当前时间指示，松手后生成该时间点的新帧；松手提交需覆盖控件外 release、pointer cancel、窗口失焦等边界，避免长期停留在 scrubbing 状态。
3. 新预览任务启动前取消旧预览任务，避免资源占满。
4. 时间轴上限按源帧率为 8 帧编码样本额外预留 2 帧余量，避免精确 EOF 生成只有容器头、不可解码的临时文件。
5. 预览失败先展示可操作摘要和“重试当前帧”，完整 stderr 放入可展开技术详情。

## 4.4 预览后入队执行

### 4.4.1 功能点

1. V1 工作台每个会话绑定一个源视频和一份任务快照。
2. 多文件拖入时只接收第一个受支持视频并给出明确提示；批量套用保留为后续能力。
3. 统一输出目录，自动处理重名；输出校验使用 `-<jobId前8位>[-N]` 展示动态后缀占位，其中 `[-N]` 仅在同名冲突时出现，入队后再写入真实 jobId 与冲突序号。所有正式转码先写入同目录、同容器扩展名的 partial 文件，成功后再以禁止覆盖已有目标的原子 rename 发布，避免并发任务或外部程序在 FFmpeg 启动前占用最终路径。
4. 单个预览任务确认后可直接创建 task 与 job，job 写入 `jobs-history.json`，任务中心从真实历史读取，不使用前端 mock 数据。
5. V1 后台转码任务先记录 `queued`，调度器分配并发槽位后更新为 `running`，结束后更新为 `completed` 或 `failed`；应用退出中断时更新为 `interrupted`，并通过 `job:updated` 事件触发前端刷新；成功进入 `completed` 后发送系统通知，点击通知会打开客户端并进入任务中心。

### 4.4.2 队列策略

1. 全局并发 `N`（用户配置）。
2. 调度策略：`FIFO`。
3. 槽位释放后自动拉起队列头任务。
4. 单任务失败不阻塞后续任务（失败隔离）。

## 4.5 任务模板管理

### 4.5.1 功能点

1. 保存模板。
2. 按名称/标签搜索模板。
3. 应用模板到当前工作台。
4. 复制模板。
5. 删除模板。

完整编辑模板保留为后续能力；当前通过“应用到工作台 -> 调整 -> 另存方案”完成参数迭代。

### 4.5.2 模板约束

1. 模板仅保存参数配置，不保存具体输入文件路径。
2. 模板更新采用版本号递增（用于排错与回滚）。
3. 模板名允许重名，但推荐唯一；搜索结果按最近使用排序。

## 4.6 方案应用到工作台

1. 入口：方案库选择参数方案并执行“应用到工作台”。
2. 方案只写入编码、音频、容器、色彩和文件名规则，不替换当前素材、任务名称、截取范围或输出目录。
3. 应用后回到统一工作台继续调参、单帧验证和入队；没有素材时进入工作台导入空状态。

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
  ffmpegStrategy: "bundled" | "system"; // 默认 bundled；system 保留用于旧配置兼容
  defaultOutputDir: string;
  thumbnailMode: "base64" | "imagePath";
};

type TaskConfig = {
  id: string;
  name: string;
  clipRange?: { startMs: number; endMs: number };
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

1. `detect_ffmpeg() -> FfmpegProbeResult`
2. `list_encoder_capabilities() -> EncoderCapabilityResult`
3. `read_video_metadata(inputFile) -> VideoMetadataResult`
4. `create_task(payload) -> { taskId }`
5. `update_task(taskId, payload) -> { ok }`
6. `list_tasks() -> TaskConfig[]`
7. `start_preview(payload) -> PreviewStartResponse`
8. `update_preview(payload) -> PreviewUpdateResponse`
9. `stop_preview(payload) -> PreviewStopResponse`
10. `build_ffmpeg_command(request) -> { commands, warnings, sanitizedAdvancedArgs }`
11. `enqueue_transcode_job(request) -> { taskId, jobId, outputFile }`
12. `control_job(request: { jobId, action: "cancel" }) -> { ok }`（`pause/resume` 保留为后续控制能力）
13. `list_jobs() -> Job[]`
14. `delete_job(request: { jobId }) -> { ok }`（只删除已结束任务的历史记录，不删除输出文件；`queued/running` 需先取消）
15. `run_quality_evaluation(payload) -> QualityEvaluationResponse`
16. `save_template(payload) / list_templates() / apply_template(templateId)`
17. `update_template(templateId, payload) / delete_template(templateId) / duplicate_template(templateId)`
18. `get_settings() / update_settings(payload)`

运行指标不通过逐任务查询命令轮询；执行器通过 `job:metrics` 事件推送。运行中缩略图当前没有命令契约。

自动更新通过 Tauri updater 插件调用，不属于 `generate_handler!` 注册的业务命令；前端负责检查、下载、安装与反馈。

模板应用行为：

1. `apply_template` 返回完整模板记录，并更新 `lastUsedAt`。
2. 前端将 `taskConfigSnapshot` 写回当前任务配置草稿，不替换当前源视频文件。
3. 模板列表按最近使用时间或更新时间倒序展示。

自动更新行为：

1. 发布 tag 必须为 `vx.x.x` 或 `vx.x.x-beta`，CI 通过 `bun run release:version` 把 tag 中的版本号注入 Tauri 构建配置。
2. 版本比较使用 SemVer 规则，`v10.0.0` 大于 `v9.99.99`，`v10.0.0` 大于 `v10.0.0-beta`。
3. 更新包必须由 CI 使用 `TAURI_SIGNING_PRIVATE_KEY` 签名，客户端使用 `tauri.conf.json` 中的公钥校验。
4. Release 必须包含 `latest.json` 和 `.sig` updater 资产；客户端固定通过公开主仓库的 GitHub latest 端点读取 `latest.json`。
5. 更换 updater 签名密钥时必须同步更新 GitHub Secrets 和 `tauri.conf.json` 公钥；已安装旧公钥版本无法校验新密钥签出的更新包。
6. updater 端点必须能匿名访问；主仓库必须保持公开，否则客户端无法读取更新清单和安装包。

## 6.2 事件通道

1. `job:updated`：推送任务状态变化。
2. `job:metrics`：基于 FFmpeg `-progress pipe:1` 推送运行指标，包含 `progress`、`fps`、`speed`、`etaSec`、`timeMs`、阶段序号与稳定 `stepCode`；`stepLabel` 仅作诊断兼容，前端按 `stepCode` 使用当前语言渲染阶段名称。
3. `preview:frame`：推送预览帧或帧引用。
4. `preview:state`：推送预览状态变化。

## 6.3 Job 类型契约

```ts
type JobStatus =
  | "queued"
  | "running"
  | "paused" // 仅兼容历史数据；当前不能新建、暂停或继续
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

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
  stepIndex: number;
  stepCount: number;
  stepCode?: "ffmpeg_transcode" | "dv_extract_source_video" | "dv_extract_source_rpu" | "dv_encode_base_layer" | "dv_extract_output_video" | "dv_extract_output_rpu" | "dv_export_source_rpu" | "dv_export_output_rpu" | "dv_verify_output" | "finalize_output"; // 旧事件兼容可缺省
  stepLabel: string; // 仅作诊断兼容，不直接用于本地化界面
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

`queued -> running -> completed | failed | canceled | interrupted`

状态转移规则：

1. `queued -> running`：调度器分配并发槽位且进程成功启动。
2. `running -> completed`：退出码 `0` 且输出发布完成。
3. `queued|running -> canceled`：用户取消，进程终止后收敛。
4. `running -> interrupted`：应用退出或任务恢复时确认原进程不再运行。
5. 任意运行态 -> `failed`：非零退出码、I/O 错误、依赖缺失。

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

1. 取消失败时保留当前任务上下文并展示后端错误，不伪造已取消状态。
2. 预览帧生成失败时不影响正式任务配置，用户可重试当前帧并展开技术详情。
3. 任务失败后可复制命令行和错误摘要用于重现。
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
2. 对关键行为打点：启动任务、失败、取消、模板应用。
3. 日志文件按日滚动，限制单文件大小（如 10MB）。

## 10. 验收标准（可测试条目）

1. 单任务转码时，进度、`fps`、`speed`、`eta` 连续更新且无明显回跳。
2. 并发 `N=1/2/4` 场景下，队列调度符合 FIFO，无重复启动。
3. `queued` 和 `running` 任务可取消，取消结果与任务历史一致。
4. 单帧预览失败时可重试，并能查看完整技术详情。
5. `2-pass` 任务预览自动降级为单帧参数预览，正式转码执行完整两遍。
6. 当选择 `h265 + hevc_nvenc` 时，UI 必须禁用 `2-pass` 并给出明确提示。
7. 队列中单个任务失败不阻塞其余任务完成。
8. 方案应用后回到工作台，当前素材保持不变且参数快照更新。
9. 预览分割线支持横纵切换，切换后拖动行为与画面裁剪方向一致。
10. 音频 `copy` 与 `custom` 模式命令拼装正确。
11. 输出重名文件自动追加序号，不覆盖旧文件。
12. 缺失 FFmpeg 时给出可操作引导，不出现静默失败。
13. 已完成任务可发起 VMAF 质量评估，并返回平均分、参与帧数、日志路径和实际命令。
14. HDR10/HLG 的 8-bit 或错误色彩标签输出被入队前校验阻止；Profile 5 未开启 RPU 保留时不能普通重编码。
15. 时间轴定位到末端时会落在安全可解码帧，不能生成只有容器头的临时预览文件。

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
| T6 | queued/running 任务取消 | 是 | 是 | 是 |
| T7 | 失败隔离与错误上报 | 是 | 是 | 是 |
| T8 | 单帧预览失败、重试与技术详情 | 是 | 是 | 是 |
| T9 | 方案保存、搜索、应用、复制与删除 | 是 | 是 | 是 |
| T10 | 输出重名自动改名 | 是 | 是 | 是 |
| T11 | 已完成任务 VMAF 质量评估 | 是 | 是 | 是 |
| T12 | HDR/Dolby Vision 输出安全校验 | 是 | 是 | 是 |
| T13 | 预览时间轴末端安全窗口 | 是 | 是 | 是 |

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
4. 队列并发 `N`、取消与参数明细面板。
5. `pause/resume` 与运行中缩略图作为后续增量能力。

## 12.3 M3：模板与稳定性

1. 参数方案库（保存、搜索、应用到工作台、复制、删除）。
2. 历史记录与日志完善。
3. 验收用例与 E2E 回归。

## 12.4 M4（V2+）分布式调度探索

1. 建立 server 调度原型与 worker 注册机制，不影响 V1 发布节奏。

## 13. 后期展望（V2+：Server-Worker 分布式转码）

V1 仍以本机 UI、本机文件、本机 `ffmpeg` 进程和本地 JSON 队列为交付边界，不实现远程节点、跨节点传输或分布式调度。

V2+ 的节点拓展方向是将 EncodeLab 演进为 Controller，并通过独立 Node Agent 二进制接入下游机器，支持远程文件入口和集群任务分发。近期可实现的技术设计见 [`节点拓展与分布式转码设计.md`](./节点拓展与分布式转码设计.md)。

后续代码演进应优先避免继续强化本机路径假设，逐步将文件位置抽象为 `nodeId + path`，并将本机转码建模为内置 `local node`，为远程入口和多节点调度预留兼容边界。

### 13.1 未来展望：蓝光 ISO 导出 MKV

蓝光 ISO 导出 MKV 已评估但不进入当前实现范围。若后续重新规划，应采用“EncodeLab 负责产品闭环，FFmpeg 负责执行层”的分工：FFmpeg 在启用 `bluray` protocol 后可以读取指定 playlist 并输出 MKV，但 ISO 挂载、结构扫描、title 选择、能力探测、错误解释和任务编排仍由 EncodeLab 负责。

1. 输入边界：接收 Blu-ray ISO 或 BDMV 来源；ISO 挂载由平台层完成，最终得到包含 `BDMV` 结构的 Blu-ray 根目录。
2. 结构读取：后端可通过 `libbluray` 读取 disc/BDMV 结构，并解析 playlist、title、chapter、clip、视频流、音频流和 PGS 字幕流摘要；这些结构用于前端展示和用户选择，不依赖 FFmpeg stderr 反推。
3. 选择策略：默认可以推荐 `libbluray` 识别的主标题或最长标题，但必须保留 title/playlist 明细给用户确认，避免花絮、多语言片段、多角度或伪装 playlist 被误选。
4. 解密边界：`libbluray` 只作为结构解析层；系统未提供可用解密能力时，不承诺商业加密蓝光导出；检测到 AACS/BD+ 但未处理时应给出明确提示。
5. 导出方案：基于选定 title 生成 FFmpeg 无损 remux 到 MKV 的参数；优先使用 FFmpeg `bluray:` protocol 和 `-playlist`，保留 playlist 的 clip 顺序、章节和无缝分段语义。
6. 错误解释：FFmpeg 只作为执行进程，其原始错误不直接作为最终用户提示；EncodeLab 需要把“未挂载 ISO”“未找到 libbluray”“FFmpeg 缺少 bluray protocol”“加密未处理”“playlist 不可读”等场景映射成可操作说明。

后续完整链路可按以下顺序实现：

1. 用户选择 ISO 或 BDMV 来源。
2. 平台层完成 ISO 挂载，得到 Blu-ray 根目录。
3. 后端扫描结构，返回 title/playlist/chapter/clip 摘要。
4. 前端展示 title 列表，用户确认要导出的 title。
5. 后端生成 `ffmpeg -playlist <playlist> -i bluray:<mount> -map 0 -c copy <output.mkv>` 参数。
6. 接入现有任务队列执行与进度展示。

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
