export type AppSettings = {
  concurrencyN: number;
  ffmpegStrategy: string;
  defaultOutputDir: string;
  thumbnailMode: string;
};

export type TaskConfig = {
  id: string;
  name?: string | null;
};

export type Template = {
  id: string;
  name: string;
  tags: string[];
  version: number;
  taskConfigSnapshot: TaskDraftSnapshot;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskResponse = {
  taskId: string;
};

export type SaveTemplateResponse = {
  templateId: string;
};

/** 通用模板写操作响应。 */
export type TemplateMutationResponse = {
  ok: boolean;
};

/** 复制模板响应。 */
export type DuplicateTemplateResponse = {
  templateId: string;
};

/** 应用模板响应。 */
export type ApplyTemplateResponse = {
  template: Template;
};

export type FfmpegProbeResult = {
  ffmpegFound: boolean;
  ffprobeFound: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  x265Path?: string;
  doviToolPath?: string;
  version?: string;
  x265Version?: string;
  doviToolVersion?: string;
  dolbyVision: {
    supportsDoviRpu: boolean;
    supportsDolbyVisionEncode: boolean;
    supportsPreservePipeline: boolean;
    supportsExternalRpuPipeline: boolean;
    doviToolFound: boolean;
    x265CliFound: boolean;
    supportedProfiles: string[];
    supportedEncoders: string[];
    recommendedEncoder?: string;
  };
};

export type EncoderCapability = {
  codecFormat: string;
  encoder: string;
  available: boolean;
  supportsTwoPass: boolean;
  supportsCrf: boolean;
  displayName: string;
  description: string;
  speedLevel: string;
  qualityLevel: string;
  presets: string[];
};

export type EncoderCapabilityResult = {
  source: "runtime_probe";
  items: EncoderCapability[];
};

/** EncodeLab 主机内置节点 id。 */
export const LOCAL_NODE_ID = "local";

/** 节点内文件位置。 */
export type FileLocation = {
  /** 文件所在节点；local 表示 EncodeLab 主机内置节点。 */
  nodeId: string;
  /** 节点本机可访问的绝对路径。 */
  path: string;
};

/** 输入、输出或中间产物的位置描述。 */
export type ArtifactLocation = FileLocation & {
  /** 文件用途。 */
  role: "input" | "output" | "preview" | "temp";
  /** 可选内容校验，用于跨节点复用和传输校验。 */
  checksum?: string;
  /** 文件大小，单位 byte。 */
  sizeBytes?: number;
};

/** 节点能力和运行状态。 */
export type NodeDescriptor = {
  /** 节点唯一标识。 */
  id: string;
  /** 用户可读名称。 */
  name: string;
  /** local 表示主控内置节点，remote 表示独立 Agent。 */
  kind: "local" | "remote";
  /** 节点 HTTP 入口；local 节点可为空。 */
  endpoint?: string;
  /** 节点平台和架构描述。 */
  platform: string;
  /** 节点状态。 */
  status: "online" | "offline" | "draining" | "disabled";
  /** 节点可并发执行的转码槽位。 */
  slots: { total: number; used: number };
  /** ffmpeg、ffprobe、编码器和 GPU 能力摘要。 */
  capabilities: {
    /** 节点 ffmpeg 版本。 */
    ffmpegVersion?: string;
    /** 节点可用编码器列表。 */
    encoders: string[];
    /** 节点 GPU 描述。 */
    gpu?: string[];
  };
  /** 最近一次心跳时间。 */
  lastSeenAt?: string;
};

/** 跨节点文件传输计划。 */
export type TransferPlan = {
  /** 传输任务 id。 */
  id: string;
  /** 源文件位置。 */
  source: FileLocation;
  /** 目标文件位置。 */
  target: FileLocation;
  /** 传输方式；relay 表示 Controller 零落盘流式中转。 */
  mode: "direct" | "relay";
  /** 当前状态。 */
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  /** 已传输字节数。 */
  transferredBytes?: number;
  /** 失败原因。 */
  error?: string;
};

/** 可调度的单个转码单元。 */
export type DistributedTask = {
  /** 任务 id。 */
  id: string;
  /** 所属用户级 Job。 */
  jobId: string;
  /** 输入文件位置。 */
  input: ArtifactLocation;
  /** 输出文件位置。 */
  output: ArtifactLocation;
  /** 当前被分配的执行节点。 */
  assignedNodeId?: string;
  /** 转码参数快照，后续可收敛为 TaskDraftSnapshot。 */
  taskConfigSnapshot: unknown;
  /** 运行状态。 */
  status: "queued" | "preparing" | "transferring" | "running" | "completed" | "failed" | "canceled";
  /** 已尝试次数。 */
  attempt: number;
};

/** 节点上报事件。 */
export type NodeEvent =
  | { type: "heartbeat"; nodeId: string; at: string; slots: { total: number; used: number } }
  | { type: "taskProgress"; nodeId: string; taskId: string; progress: number; fps?: number; speed?: number }
  | { type: "transferProgress"; nodeId: string; transferId: string; transferredBytes: number }
  | { type: "taskFailed"; nodeId: string; taskId: string; error: string }
  | { type: "nodeError"; nodeId: string; error: string };

export type VideoStreamMetadata = {
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  width?: number;
  height?: number;
  pixFmt?: string;
  fps?: number;
  fpsFraction?: string;
  variableFrameRate?: boolean;
  frameCount?: number | null;
  bitRateKbps?: number;
  /** 视频轨道大小，单位字节；可能来自容器 tag 或估算。 */
  sizeBytes?: number | null;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  colorRange?: string;
  bitDepth?: number;
  hdrType?: "Sdr" | "Hdr10" | "Hlg" | "DolbyVision" | "Unknown";
  /** Dolby Vision profile；缺失时不能判断当前保留链路是否支持。 */
  dolbyVisionProfile?: number | null;
  /** Dolby Vision level。 */
  dolbyVisionLevel?: number | null;
  /** Dolby Vision base-layer compatibility id；0 通常表示没有 HDR10/SDR 兼容层。 */
  dolbyVisionCompatibilityId?: number | null;
  dolbyVisionRpuPresent?: boolean | null;
  dolbyVisionElPresent?: boolean | null;
  dolbyVisionBlPresent?: boolean | null;
  /** HDR10 MaxCLL，单位 nit */
  maxContentLightLevel?: number | null;
  /** HDR10 MaxFALL，单位 nit */
  maxFrameAverageLightLevel?: number | null;
  /** mastering display 最大亮度，单位 nit */
  masteringDisplayMaxLuminance?: number | null;
  /** mastering display 最小亮度，单位 nit */
  masteringDisplayMinLuminance?: number | null;
  /** x265 可直接使用的 ST.2086 mastering-display 表达式。 */
  masteringDisplay?: string | null;
};

export type AudioStreamMetadata = {
  codecName?: string;
  channels?: number;
  sampleRate?: number;
  bitRateKbps?: number;
  channelLayout?: string;
};

export type VideoMetadataResult = {
  inputFile: string;
  containerFormat?: string;
  durationSec?: number;
  sizeBytes?: number;
  bitRateKbps?: number;
  video?: VideoStreamMetadata;
  audio?: AudioStreamMetadata;
  tags: string[];
  rawProbeVersion?: string;
};

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

/** 后端任务历史记录。 */
export type JobHistory = {
  id: string;
  taskId: string;
  name: string;
  inputFile: string;
  outputFile: string;
  /** 输入文件节点位置；为空时按旧数据解释为 local + inputFile。 */
  inputLocation?: FileLocation | null;
  /** 输出文件节点位置；为空时按旧数据解释为 local + outputFile。 */
  outputLocation?: FileLocation | null;
  /** 本次任务实际执行节点；为空时按旧数据解释为 local。 */
  executionNodeId?: string | null;
  /** 关联的文件传输任务 id。 */
  transferIds?: string[];
  /** 输入文件大小，单位字节。 */
  inputSizeBytes?: number | null;
  /** 输出文件大小，单位字节。 */
  outputSizeBytes?: number | null;
  /** 输出相对输入的体积变化百分比；负数表示变小，正数表示变大。 */
  sizeChangePercent?: number | null;
  /** 输入视频轨道大小，单位字节。 */
  inputVideoSizeBytes?: number | null;
  /** 输出视频轨道大小，单位字节。 */
  outputVideoSizeBytes?: number | null;
  /** 输出视频轨道相对输入视频轨道的体积变化百分比。 */
  videoSizeChangePercent?: number | null;
  status: JobStatus;
  commandLine?: string | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
};

export type EnqueueTranscodeJobResponse = {
  taskId: string;
  jobId: string;
  outputFile: string;
};

/** 任务控制响应。 */
export type ControlJobResponse = {
  /** 控制动作是否已应用。 */
  ok: boolean;
};

/** 删除任务历史响应。 */
export type DeleteJobResponse = {
  /** 删除动作是否已应用。 */
  ok: boolean;
};

/** 任务运行指标事件。 */
export type JobMetricsEvent = {
  /** 任务 id。 */
  jobId: string;
  /** 当前执行阶段，从 1 开始。 */
  stepIndex: number;
  /** 总阶段数。 */
  stepCount: number;
  /** 当前多工具执行阶段名称。 */
  stepLabel: string;
  /** 当前已处理媒体时间，单位毫秒。 */
  timeMs?: number | null;
  /** 当前帧号。 */
  frame?: number | null;
  /** 当前 fps。 */
  fps?: number | null;
  /** 当前 speed 倍速。 */
  speed?: number | null;
  /** 总体进度，范围 0..=100。 */
  progress?: number | null;
  /** 预计剩余秒数。 */
  etaSec?: number | null;
  /** 更新时间。 */
  updatedAt: string;
};

export type TaskDraftStep = "source" | "config" | "preview" | "confirm";

export type TaskDraftSnapshot = {
  name: string;
  /** 可选转码截取范围，单位毫秒；缺省表示完整源视频。 */
  clipRange?: { startMs: number; endMs: number };
  video: {
    codecFormat: "h264" | "h265" | "av1" | "vp9" | "copy";
    encoder: string;
    bitrateMode: "CRF" | "CBR" | "ABR";
    crf?: number;
    preset?: string;
    keepOriginalResolution?: boolean;
    keepOriginalFps?: boolean;
    preserveDolbyVisionMetadata?: boolean;
    resolution?: { width: number; height: number };
    fps?: number;
    pixelFormat?: string;
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
    fileNamePattern: string;
    overwrite: string;
    /** 可选输出节点位置；为空时沿用当前本机输出目录语义。 */
    location?: FileLocation | null;
  };
};

export type PreviewState =
  | "idle"
  | "warming"
  | "running"
  | "updating"
  | "stopped"
  | "error";

/** 对比图层显示顺序：source-first 表示左侧/上侧为原始图像。 */
export type CompareImageOrder = "source-first" | "preview-first";

/** 当前已生成的预览帧快照，可用于独立窗口复用首帧。 */
export type ComparePreviewFrameSnapshot = {
  /** 源帧图片绝对路径 */
  sourceImagePath: string;
  /** 转码后预览帧图片绝对路径 */
  previewImagePath: string;
  /** 该帧所在时间点，单位毫秒 */
  timeMs: number;
  /** 后端预览序号，用于排查帧时序 */
  seq: number;
  /** 前端参数与时间点匹配 key，用于独立窗口判断首帧是否可复用 */
  renderKey?: string;
};

export type PreviewConfig = {
  inputFile: string;
  /** 可选输入节点位置；当前预览执行仍使用 inputFile 保持本机兼容。 */
  inputLocation?: FileLocation | null;
  /** 源视频 HDR 类型；后端预览用它决定是否执行 SDR 映射。 */
  sourceHdrType?: VideoStreamMetadata["hdrType"];
  /** 源视频色彩原色；用于普通 HDR fallback 预览映射时固定 zscale 输入端。 */
  sourceColorPrimaries?: VideoStreamMetadata["colorPrimaries"];
  /** 源视频传递函数；用于普通 HDR fallback 预览映射时固定 zscale 输入端。 */
  sourceColorTransfer?: VideoStreamMetadata["colorTransfer"];
  /** 源视频色彩矩阵；用于普通 HDR fallback 预览映射时固定 zscale 输入端。 */
  sourceColorSpace?: VideoStreamMetadata["colorSpace"];
  /** 源视频色彩范围；用于普通 HDR fallback 预览映射时固定 zscale 输入端。 */
  sourceColorRange?: VideoStreamMetadata["colorRange"];
  clipRange?: { startMs: number; endMs: number };
  renderScale: 0.25 | 0.5 | 0.75 | 1;
  compareOrientation: "vertical" | "horizontal";
  splitterPosition: number;
  timeMs?: number;
  taskConfigSnapshot: TaskDraftSnapshot;
};

export type PreviewFrameEvent = {
  previewSessionId: string;
  timeMs: number;
  sourceImagePath?: string;
  previewImagePath?: string;
  width: number;
  height: number;
  seq: number;
};

export type PreviewStateEvent = {
  previewSessionId: string;
  state: PreviewState;
  previewSpeed?: number;
  estimatedTranscodeSpeed?: number;
  degradedFromTwoPass?: boolean;
  degradedFromDolbyVision?: boolean;
  degradedFromSdrTonemap?: boolean;
  error?: {
    code: string;
    message: string;
  };
};

export type StartPreviewResponse = {
  previewSessionId: string;
  degradedFromTwoPass?: boolean;
  degradedFromDolbyVision?: boolean;
  degradedFromSdrTonemap?: boolean;
};

export type UpdatePreviewResponse = {
  ok: boolean;
  degradedFromTwoPass?: boolean;
  degradedFromDolbyVision?: boolean;
  degradedFromSdrTonemap?: boolean;
};

export type ComparePreviewRuntime = {
  previewState: PreviewState;
  previewSpeed?: number;
  estimatedTranscodeSpeed?: number;
  previewError?: string;
  degradedFromTwoPass: boolean;
  degradedFromDolbyVision: boolean;
  degradedFromSdrTonemap: boolean;
  currentTimeSec: number;
  durationSec: number;
  isFullscreen: boolean;
  currentFrame?: ComparePreviewFrameSnapshot;
};

/** 质量评估指标类型，V1 先支持 VMAF。 */
export type EvaluationMetric = "vmaf";

/** VMAF 评估参数。 */
export type VmafEvaluationOptions = {
  /** 可选 VMAF 模型文件路径 */
  modelPath?: string;
  /** 可选统一缩放宽度，需与 scaleHeight 同时传入 */
  scaleWidth?: number;
  /** 可选统一缩放高度，需与 scaleWidth 同时传入 */
  scaleHeight?: number;
  /** 可选抽样间隔，对应 libvmaf n_subsample */
  frameStep?: number;
  /** 可选线程数，对应 libvmaf n_threads */
  threadCount?: number;
};

/** 质量评估请求；可通过 jobId/taskId 解析文件，也可直接传入文件路径。 */
export type RunQualityEvaluationRequest = {
  /** 完成任务记录 id，优先级最高 */
  jobId?: string;
  /** 任务 id；后端会选择该任务最近一次 completed job */
  taskId?: string;
  /** 源参考视频路径 */
  referenceFile?: string;
  /** 转码后待评估视频路径 */
  distortedFile?: string;
  /** 评估指标 */
  metric: EvaluationMetric;
  /** VMAF 参数 */
  vmaf?: VmafEvaluationOptions;
};

/** 质量评估结果。 */
export type RunQualityEvaluationResponse = {
  /** 本次评估 id */
  evaluationId: string;
  /** 评估指标 */
  metric: EvaluationMetric;
  /** VMAF 平均分 */
  score: number;
  /** 参与评估的帧数 */
  frameCount?: number;
  /** 源参考视频路径 */
  referenceFile: string;
  /** 转码后待评估视频路径 */
  distortedFile: string;
  /** VMAF JSON 日志路径 */
  logPath: string;
  /** 实际执行的 FFmpeg 命令 */
  command: string;
  /** FFmpeg stderr 输出 */
  stderr: string;
};
