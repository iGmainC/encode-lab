import type {
  EncoderCapability,
  FfmpegProbeResult,
  TaskDraftSnapshot,
  VideoMetadataResult,
} from "../types/workbench";
import type { TranslationKey } from "../i18n/translations";

/** 专业参数检查器的固定分组。 */
export type InspectorTab = "video" | "audio" | "color" | "output";

/** 工作台可直接定位到对应检查器页签的校验项。 */
export type WorkbenchValidationIssue = {
  id: string;
  tab: InspectorTab;
  /** 本地化文案键；策略层只返回稳定语义，不内嵌任一界面语言。 */
  messageKey: TranslationKey;
  /** 动态文案参数。 */
  messageParams?: Record<string, string | number>;
  tone: "warning" | "error";
};

/**
 * 判断当前源片是否满足 Dolby Vision RPU 保留链路的源约束。
 * @param sourceVideo ffprobe 返回的视频轨道元数据
 */
export function isDolbyVisionPreserveSourceSupported(sourceVideo?: VideoMetadataResult["video"] | null) {
  const profile = sourceVideo?.dolbyVisionProfile;
  const compatibilityId = sourceVideo?.dolbyVisionCompatibilityId;
  const supportedProfile = (profile === 5 && compatibilityId === 0) || (profile === 8 && compatibilityId === 1);

  // 当前只接受 BL + RPU 单层源，避免把含 EL/FEL 的 Profile 7 误判为完整保留。
  return Boolean(
    supportedProfile &&
      sourceVideo?.codecName?.toLowerCase() === "hevc" &&
      (sourceVideo.bitDepth ?? 0) >= 10 &&
      (sourceVideo.width ?? 0) > 0 &&
      (sourceVideo.height ?? 0) > 0 &&
      (sourceVideo.fps ?? 0) > 0 &&
      sourceVideo.fpsFraction &&
      sourceVideo.dolbyVisionRpuPresent === true &&
      sourceVideo.dolbyVisionBlPresent === true &&
      sourceVideo.dolbyVisionElPresent !== true &&
      sourceVideo.variableFrameRate === false,
  );
}

/**
 * 计算 Dolby Vision 开关的可用性和专业说明。
 * @param metadata 当前源素材元数据
 * @param ffmpegProbe 本机运行时探测结果
 */
export function getDolbyVisionPreserveStatus(
  metadata: VideoMetadataResult | null,
  ffmpegProbe: FfmpegProbeResult | null,
) {
  if (!metadata) {
    return {
      available: false,
      resolved: false,
      detailKey: "parameterInspector.dv.status.metadataPending" as const,
    };
  }

  const video = metadata?.video;
  if (video?.hdrType !== "DolbyVision") {
    return {
      available: false,
      resolved: true,
      detailKey: "parameterInspector.dv.status.notDolbyVision" as const,
    };
  }
  if (!ffmpegProbe) {
    return {
      available: false,
      resolved: false,
      detailKey: "parameterInspector.dv.status.probing" as const,
    };
  }
  if (!ffmpegProbe.ffmpegFound) {
    return {
      available: false,
      resolved: true,
      detailKey: "parameterInspector.dv.status.ffmpegUnavailable" as const,
    };
  }
  if (!ffmpegProbe.dolbyVision.supportsPreservePipeline) {
    return {
      available: false,
      resolved: true,
      detailKey: "parameterInspector.dv.status.pipelineUnavailable" as const,
    };
  }
  if (!isDolbyVisionPreserveSourceSupported(video)) {
    return {
      available: false,
      resolved: true,
      detailKey: "parameterInspector.dv.status.sourceUnsupported" as const,
      detailParams: {
        profile: video.dolbyVisionProfile ?? "-",
        compatibility: video.dolbyVisionCompatibilityId ?? "-",
      },
    };
  }
  return {
    available: true,
    resolved: true,
    detailKey: "parameterInspector.dv.status.available" as const,
  };
}

/**
 * 基于真实任务快照和运行时能力生成阻塞校验。
 */
export function buildWorkbenchValidationIssues({
  sourceFilePath,
  metadata,
  snapshot,
  selectedEncoderCapability,
  ffmpegProbe,
}: {
  sourceFilePath: string;
  metadata: VideoMetadataResult | null;
  snapshot: TaskDraftSnapshot;
  selectedEncoderCapability?: EncoderCapability;
  ffmpegProbe: FfmpegProbeResult | null;
}): WorkbenchValidationIssue[] {
  const issues: WorkbenchValidationIssue[] = [];
  if (!sourceFilePath.trim() || !metadata) {
    issues.push({ id: "source", tab: "video", tone: "error", messageKey: "parameterInspector.validation.source" });
  } else if (metadata.inputFile.trim() !== sourceFilePath.trim()) {
    issues.push({ id: "source-metadata", tab: "video", tone: "error", messageKey: "parameterInspector.validation.sourceMetadata" });
  }
  if (ffmpegProbe && !ffmpegProbe.ffmpegFound) {
    issues.push({ id: "ffmpeg", tab: "video", tone: "error", messageKey: "parameterInspector.validation.ffmpeg" });
  }
  if (selectedEncoderCapability && !selectedEncoderCapability.available) {
    issues.push({ id: "encoder", tab: "video", tone: "error", messageKey: "parameterInspector.validation.encoder" });
  }
  if (
    snapshot.video.codecFormat !== "copy" &&
    snapshot.video.bitrateMode === "CRF" &&
    (typeof snapshot.video.crf !== "number" ||
      !Number.isFinite(snapshot.video.crf) ||
      snapshot.video.crf < 0 ||
      snapshot.video.crf > 51)
  ) {
    issues.push({ id: "crf", tab: "video", tone: "error", messageKey: "parameterInspector.validation.crf" });
  }
  if (
    snapshot.video.codecFormat !== "copy" &&
    snapshot.video.bitrateMode !== "CRF" &&
    !["-b:v", "-maxrate", "-bufsize"].every((flag) => isPositiveRateValue(readAdvancedArgValue(snapshot.advancedArgs, flag)))
  ) {
    issues.push({ id: "bitrate", tab: "video", tone: "error", messageKey: "parameterInspector.validation.bitrate" });
  }
  if (
    snapshot.video.resolution &&
    (!Number.isFinite(snapshot.video.resolution.width) ||
      !Number.isFinite(snapshot.video.resolution.height) ||
      !Number.isInteger(snapshot.video.resolution.width) ||
      !Number.isInteger(snapshot.video.resolution.height) ||
      snapshot.video.resolution.width <= 0 ||
      snapshot.video.resolution.height <= 0)
  ) {
    issues.push({ id: "resolution", tab: "video", tone: "error", messageKey: "parameterInspector.validation.resolution" });
  }
  if (typeof snapshot.video.fps === "number" && (!Number.isFinite(snapshot.video.fps) || snapshot.video.fps <= 0)) {
    issues.push({ id: "fps", tab: "video", tone: "error", messageKey: "parameterInspector.validation.fps" });
  }
  appendClipRangeIssues(issues, metadata, snapshot);
  appendStreamCopyIssues(issues, snapshot);
  appendHdrOutputIssues(issues, metadata, snapshot);
  if (snapshot.video.preserveDolbyVisionMetadata && snapshot.audio.mode !== "copy") {
    issues.push({
      id: "dolby-vision-audio-mode",
      tab: "audio",
      tone: "error",
      messageKey: "parameterInspector.validation.dolbyVisionAudioMode",
    });
  } else if (snapshot.audio.mode === "custom" && !snapshot.audio.customArgs?.trim()) {
    issues.push({ id: "audio", tab: "audio", tone: "error", messageKey: "parameterInspector.validation.audio" });
  }
  if (!snapshot.output.fileNamePattern.trim()) {
    issues.push({ id: "filename", tab: "output", tone: "error", messageKey: "parameterInspector.validation.filename" });
  }
  if (snapshot.container.faststart && snapshot.container.format !== "mp4") {
    issues.push({ id: "faststart", tab: "output", tone: "warning", messageKey: "parameterInspector.validation.faststart" });
  }
  return issues;
}

/**
 * 校验截取范围不会被静默退化为整片输出。
 * @param issues 需要追加问题的结果集
 * @param metadata 当前源素材元数据
 * @param snapshot 当前任务快照
 */
function appendClipRangeIssues(
  issues: WorkbenchValidationIssue[],
  metadata: VideoMetadataResult | null,
  snapshot: TaskDraftSnapshot,
) {
  const range = snapshot.clipRange;
  if (!range) {
    return;
  }

  const durationMs = (metadata?.durationSec ?? 0) * 1000;
  const invalidNumber = !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs);
  const invalidOrder = range.startMs < 0 || range.endMs <= range.startMs;
  const exceedsSource = durationMs > 0 && range.endMs > durationMs + 1;
  if (invalidNumber || invalidOrder || exceedsSource) {
    issues.push({
      id: "clip-range",
      tab: "output",
      tone: "error",
      messageKey: "parameterInspector.validation.clipRange",
    });
  }
}

/**
 * 保证视频流复制不会混入重编码参数。
 * @param issues 需要追加问题的结果集
 * @param snapshot 当前任务快照
 */
function appendStreamCopyIssues(
  issues: WorkbenchValidationIssue[],
  snapshot: TaskDraftSnapshot,
) {
  if (snapshot.video.codecFormat !== "copy") {
    return;
  }

  if (snapshot.video.encoder !== "copy") {
    issues.push({
      id: "copy-encoder",
      tab: "video",
      tone: "error",
      messageKey: "parameterInspector.validation.copyEncoder",
    });
  }

  const hasStructuredReencodeFields = Boolean(
    snapshot.video.crf !== undefined ||
      snapshot.video.preset ||
      snapshot.video.resolution ||
      snapshot.video.fps !== undefined ||
      snapshot.video.pixelFormat ||
      snapshot.video.enableTwoPass ||
      snapshot.video.preserveDolbyVisionMetadata,
  );
  const hasGeneratedReencodeArgs = hasAnyAdvancedFlag(snapshot.advancedArgs, [
    "-b:v",
    "-maxrate",
    "-bufsize",
    "-crf",
    "-preset",
    "-vf",
    "-filter:v",
    "-r",
    "-pix_fmt",
    "-color_primaries",
    "-color_trc",
    "-colorspace",
  ]);
  if (hasStructuredReencodeFields || hasGeneratedReencodeArgs) {
    issues.push({
      id: "copy-video-parameters",
      tab: "video",
      tone: "error",
      messageKey: "parameterInspector.validation.copyVideoParameters",
    });
  }
}

/**
 * 校验 HDR/Dolby Vision 重编码不会被 8-bit 像素格式或错误色彩标签静默破坏。
 * @param issues 需要追加问题的结果集
 * @param metadata 当前源素材元数据
 * @param snapshot 当前任务快照
 */
function appendHdrOutputIssues(
  issues: WorkbenchValidationIssue[],
  metadata: VideoMetadataResult | null,
  snapshot: TaskDraftSnapshot,
) {
  const sourceVideo = metadata?.video;
  const hdrType = sourceVideo?.hdrType;
  if (!sourceVideo || !hdrType || hdrType === "Sdr" || hdrType === "Unknown") {
    return;
  }
  if (snapshot.video.codecFormat === "copy") {
    return;
  }

  const preservesDolbyVision = snapshot.video.preserveDolbyVisionMetadata === true;
  if (hdrType === "DolbyVision" && !preservesDolbyVision) {
    const profile = sourceVideo.dolbyVisionProfile;
    const compatibilityId = sourceVideo.dolbyVisionCompatibilityId;
    if (profile === 5 && compatibilityId === 0) {
      issues.push({
        id: "dolby-vision-profile-5-output",
        tab: "color",
        tone: "error",
        messageKey: "parameterInspector.validation.dolbyVisionProfile5",
      });
      return;
    }

    issues.push({
      id: "dolby-vision-rpu-loss",
      tab: "color",
      tone: "warning",
      messageKey: "parameterInspector.validation.dolbyVisionRpuLoss",
    });
  }
  if (preservesDolbyVision) {
    return;
  }

  const expectedTransfer = hdrType === "Hlg" ? "arib-std-b67" : "smpte2084";
  const pixelFormat = snapshot.video.pixelFormat?.toLowerCase() ?? "";
  if (!/(?:10|12|16)/.test(pixelFormat)) {
    issues.push({
      id: "hdr-bit-depth",
      tab: "color",
      tone: "error",
      messageKey: "parameterInspector.validation.hdrBitDepth",
    });
  }

  const colorPrimaries = readAdvancedArgValue(snapshot.advancedArgs, "-color_primaries");
  const colorTransfer = readAdvancedArgValue(snapshot.advancedArgs, "-color_trc");
  const colorSpace = readAdvancedArgValue(snapshot.advancedArgs, "-colorspace");
  if (colorPrimaries !== "bt2020" || colorTransfer !== expectedTransfer || colorSpace !== "bt2020nc") {
    issues.push({
      id: "hdr-color-tags",
      tab: "color",
      tone: "error",
      messageKey: "parameterInspector.validation.hdrColorTags",
      messageParams: { transfer: expectedTransfer },
    });
  }
}

/**
 * 从受控 FFmpeg 参数字符串读取单值 flag。
 * @param args 高级参数字符串
 * @param flag 需要读取的参数名
 */
function readAdvancedArgValue(args: string | undefined, flag: string) {
  const tokens = args?.trim().split(/\s+/) ?? [];
  const index = tokens.indexOf(flag);
  return index >= 0 ? tokens[index + 1] : undefined;
}

/** 判断带可选 k/m/g 单位的码率值是否为正数。 */
function isPositiveRateValue(value: string | undefined) {
  if (!value || !/^\d+(?:\.\d+)?[kmg]?$/i.test(value)) {
    return false;
  }
  return Number.parseFloat(value) > 0;
}

/** 判断高级参数中是否包含任一指定 flag。 */
function hasAnyAdvancedFlag(args: string | undefined, flags: string[]) {
  const tokens = new Set(args?.trim().split(/\s+/) ?? []);
  return flags.some((flag) => tokens.has(flag));
}
