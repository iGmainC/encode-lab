export type AppSettings = {
  concurrencyN: number;
  ffmpegStrategy: string;
  defaultOutputDir: string;
  thumbnailMode: string;
};

export type TaskConfig = {
  id: string;
  name: string;
};

export type Template = {
  id: string;
  name: string;
  version: number;
};

export type CreateTaskResponse = {
  taskId: string;
};

export type SaveTemplateResponse = {
  templateId: string;
};

export type FfmpegProbeResult = {
  ffmpegFound: boolean;
  ffprobeFound: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  version?: string;
  dolbyVision: {
    supportsDoviRpu: boolean;
    supportsDolbyVisionEncode: boolean;
    supportsPreservePipeline: boolean;
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

export type VideoStreamMetadata = {
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  width?: number;
  height?: number;
  pixFmt?: string;
  fps?: number;
  bitRateKbps?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  bitDepth?: number;
  hdrType?: "Sdr" | "Hdr10" | "Hlg" | "DolbyVision" | "Unknown";
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

export type ProtoJob = {
  id: string;
  name: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  progress: number;
  fps: number;
  eta: string;
};

export type TaskDraftStep = "source" | "config" | "preview" | "enqueue";

export type TaskDraftSnapshot = {
  name: string;
  video: {
    codecFormat: "h264" | "h265" | "av1" | "vp9" | "copy";
    encoder: string;
    bitrateMode: "CRF" | "CBR" | "ABR";
    crf?: number;
    preset?: string;
    keepOriginalResolution?: boolean;
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
  error?: {
    code: string;
    message: string;
  };
};

export type StartPreviewResponse = {
  previewSessionId: string;
  degradedFromTwoPass?: boolean;
};

export type UpdatePreviewResponse = {
  ok: boolean;
  degradedFromTwoPass?: boolean;
};

export type ComparePreviewRuntime = {
  previewState: PreviewState;
  previewSpeed?: number;
  estimatedTranscodeSpeed?: number;
  previewError?: string;
  degradedFromTwoPass: boolean;
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
