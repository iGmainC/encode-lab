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
  mediaPath?: string;
  mediaKind: "video" | "image";
  imagePath?: string;
  base64?: string;
  clipStartMs: number;
  clipEndMs: number;
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
};
