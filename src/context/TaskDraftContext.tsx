import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/translations";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type {
  TaskDraftSnapshot,
  VideoMetadataResult,
} from "../types/workbench";

type TaskDraftContextValue = {
  /** 当前任务名称，会进入输出文件名模板。 */
  draftName: string;
  setDraftName: (value: string) => void;
  /** 当前参数来源；仅用于界面说明，不与输入素材绑定。 */
  activeTemplateName: string;
  /** 当前参数是否来自一个具名方案；默认自定义配置不属于具名方案。 */
  hasNamedTemplate: boolean;
  setActiveTemplateName: (value: string) => void;
  formCodec: string;
  setFormCodec: (value: string) => void;
  formEncoder: string;
  setFormEncoder: (value: string) => void;
  formMode: "CRF" | "CBR" | "ABR";
  setFormMode: (value: "CRF" | "CBR" | "ABR") => void;
  formTwoPass: boolean;
  setFormTwoPass: (value: boolean) => void;
  formCrf: number;
  setFormCrf: (value: number) => void;
  formPreset: string;
  setFormPreset: (value: string) => void;
  keepOriginalResolution: boolean;
  setKeepOriginalResolution: (value: boolean) => void;
  keepOriginalFps: boolean;
  setKeepOriginalFps: (value: boolean) => void;
  preserveDolbyVisionMetadata: boolean;
  setPreserveDolbyVisionMetadata: (value: boolean) => void;
  formWidth: string;
  setFormWidth: (value: string) => void;
  formHeight: string;
  setFormHeight: (value: string) => void;
  formFps: string;
  setFormFps: (value: string) => void;
  formBitrateKbps: string;
  setFormBitrateKbps: (value: string) => void;
  formMaxrateKbps: string;
  setFormMaxrateKbps: (value: string) => void;
  formBufsizeKbps: string;
  setFormBufsizeKbps: (value: string) => void;
  formPixelFormat: string;
  setFormPixelFormat: (value: string) => void;
  formColorPrimaries: string;
  setFormColorPrimaries: (value: string) => void;
  formColorTrc: string;
  setFormColorTrc: (value: string) => void;
  formColorspace: string;
  setFormColorspace: (value: string) => void;
  av1CpuUsed: string;
  setAv1CpuUsed: (value: string) => void;
  av1RowMt: boolean;
  setAv1RowMt: (value: boolean) => void;
  av1TileColumns: string;
  setAv1TileColumns: (value: string) => void;
  av1TileRows: string;
  setAv1TileRows: (value: string) => void;
  av1SvtTune: string;
  setAv1SvtTune: (value: string) => void;
  av1FilmGrain: string;
  setAv1FilmGrain: (value: string) => void;
  containerFormat: "mp4" | "mkv" | "mov";
  setContainerFormat: (value: "mp4" | "mkv" | "mov") => void;
  containerFaststart: boolean;
  setContainerFaststart: (value: boolean) => void;
  audioMode: "copy" | "custom";
  setAudioMode: (value: "copy" | "custom") => void;
  audioCustomArgs: string;
  setAudioCustomArgs: (value: string) => void;
  outputDir: string;
  setOutputDir: (value: string) => void;
  fileNamePattern: string;
  setFileNamePattern: (value: string) => void;
  clipStartSec: number;
  setClipStartSec: (value: number) => void;
  clipEndSec: number;
  setClipEndSec: (value: number) => void;
  sourceFilePath: string;
  setSourceFilePath: (value: string) => void;
  videoMetadata: VideoMetadataResult | null;
  videoMetadataLoading: boolean;
  videoMetadataError: string | null;
  pickSourceFile: () => Promise<void>;
  retryVideoMetadata: () => Promise<void>;
  applyTemplateSnapshot: (snapshot: TaskDraftSnapshot, templateName?: string) => void;
  taskDraftSnapshot: TaskDraftSnapshot;
};

const TaskDraftContext = createContext<TaskDraftContextValue | null>(null);

/** 源素材选择状态；revision 让重复选择同一路径仍能触发一次新的元数据读取。 */
type SourceSelectionState = {
  path: string;
  revision: number;
};

/** 元数据错误保留稳定翻译键，切换语言时无需重新触发文件选择。 */
type VideoMetadataErrorState = {
  message: string;
  key?: TranslationKey;
};

/**
 * 推进源素材选择版本，不能仅依赖路径字符串判断用户是否重新选择了素材。
 * @param current 当前选择状态
 * @param path 新选择的素材路径
 * @returns 带有新选择版本的状态
 */
export function advanceSourceSelection(
  current: SourceSelectionState,
  path: string,
): SourceSelectionState {
  return { path, revision: current.revision + 1 };
}

/**
 * 解析 Dolby Vision 保留链路允许的音频模式。
 * @param preservesDolbyVision 是否启用 RPU 保留链路
 * @param requestedMode 表单或模板请求的音频模式
 * @returns 可进入任务快照的音频模式
 */
export function resolveDolbyVisionAudioMode(
  preservesDolbyVision: boolean,
  requestedMode: "copy" | "custom",
): "copy" | "custom" {
  return preservesDolbyVision ? "copy" : requestedMode;
}

/**
 * 收敛 Dolby Vision 保留链路允许的容器。
 * @param preservesDolbyVision 是否启用 RPU 保留链路
 * @param requestedFormat 表单或模板请求的输出容器
 * @returns DV 路径只接受 MKV/MP4；旧 MOV 模板回退到 MKV，保留用户可选 MP4 的能力
 */
export function resolveDolbyVisionContainerFormat(
  preservesDolbyVision: boolean,
  requestedFormat: "mp4" | "mkv" | "mov",
): "mp4" | "mkv" | "mov" {
  if (!preservesDolbyVision || requestedFormat !== "mov") {
    return requestedFormat;
  }

  // 旧模板可能存有 MOV；回退到无损轨道承载更完整的 MKV，而不是提交后由后端失败。
  return "mkv";
}

/**
 * 新元数据到达时收敛 Dolby Vision 保留意图。
 * @param current 当前是否已启用保留
 * @param metadata 已确认属于当前源文件的元数据
 * @returns 只有新源仍是 Dolby Vision 时才继续保留
 */
export function resolveDolbyVisionPreservationAfterMetadata(
  current: boolean,
  metadata: VideoMetadataResult,
) {
  return current && metadata.video?.hdrType === "DolbyVision";
}

/**
 * 根据素材读取阶段收敛截取范围。
 * @param input 当前源路径、可能尚未返回的时长和用户输入
 * @returns null 表示元数据刷新中，应保持原值；否则返回已收敛范围
 */
export function resolveClipRangeAfterMetadataRefresh({
  sourceFilePath,
  durationSec,
  currentStartSec,
  currentEndSec,
}: {
  sourceFilePath: string;
  durationSec?: number;
  currentStartSec: number;
  currentEndSec: number;
}): { startSec: number; endSec: number } | null {
  if (sourceFilePath.trim() && durationSec === undefined) {
    return null;
  }
  if (!sourceFilePath.trim() || !durationSec || durationSec <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  return {
    startSec: Math.min(Math.max(0, currentStartSec), durationSec),
    endSec: currentEndSec <= 0
      ? durationSec
      : Math.min(Math.max(currentEndSec, 0), durationSec),
  };
}

/**
 * 普通浏览器预览用的只读示例素材，避免设计 QA 被 Tauri 宿主缺失阻断。
 * @returns 示例视频元数据
 */
function buildBrowserPreviewMetadata(): VideoMetadataResult {
  return {
    inputFile: "/Users/encode-lab/Travel_2024_Film.mov",
    containerFormat: "QuickTime (MOV)",
    durationSec: 10097,
    sizeBytes: 12.62 * 1024 * 1024 * 1024,
    bitRateKbps: 10680,
    video: {
      codecName: "Apple ProRes 422 HQ",
      width: 3840,
      height: 2160,
      pixFmt: "yuv422p10le",
      fps: 23.976,
      bitDepth: 10,
      hdrType: "Hdr10",
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorSpace: "bt2020nc",
      colorRange: "tv",
    },
    audio: {
      codecName: "AAC",
      channelLayout: "Stereo",
      sampleRate: 48000,
      bitRateKbps: 320,
    },
    tags: ["4K", "HDR10", "ProRes", "10-bit"],
  };
}

export function TaskDraftProvider({
  children,
  defaultOutputDir,
}: {
  children: ReactNode;
  /** 全局默认输出目录；只用于尚未指定任务级目录的新草稿。 */
  defaultOutputDir?: string;
}) {
  const { t } = useI18n();
  const desktopRuntime = isTauriRuntime();
  const [draftName, setDraftName] = useState("preview-draft");
  const [activeTemplateOverride, setActiveTemplateOverride] = useState<string | null>(null);
  // 默认方案名由当前 locale 动态解析，切换语言时不会保留首次渲染的旧文案。
  const activeTemplateName = activeTemplateOverride
    ?? t(desktopRuntime ? "taskDraft.template.custom" : "app.browserPreview.templateName");
  const hasNamedTemplate = activeTemplateOverride !== null || !desktopRuntime;
  const setActiveTemplateName = useCallback((value: string) => {
    setActiveTemplateOverride(value.trim() || null);
  }, []);
  const [formCodec, setFormCodec] = useState("h265");
  const [formEncoder, setFormEncoder] = useState("libx265");
  const [formMode, setFormMode] = useState<"CRF" | "CBR" | "ABR">("CRF");
  const [formTwoPass, setFormTwoPass] = useState(false);
  const [formCrf, setFormCrf] = useState(23);
  const [formPreset, setFormPreset] = useState("medium");
  const [keepOriginalResolution, setKeepOriginalResolution] = useState(true);
  const [keepOriginalFps, setKeepOriginalFps] = useState(true);
  const [preserveDolbyVisionMetadata, setPreserveDolbyVisionMetadata] = useState(false);
  const [formWidth, setFormWidth] = useState("1920");
  const [formHeight, setFormHeight] = useState("1080");
  const [formFps, setFormFps] = useState("30");
  const [formBitrateKbps, setFormBitrateKbps] = useState("5000");
  const [formMaxrateKbps, setFormMaxrateKbps] = useState("7000");
  const [formBufsizeKbps, setFormBufsizeKbps] = useState("10000");
  const [formPixelFormat, setFormPixelFormat] = useState(() =>
    isTauriRuntime() ? "yuv420p" : "yuv420p10le",
  );
  const [formColorPrimaries, setFormColorPrimaries] = useState(() =>
    isTauriRuntime() ? "bt709" : "bt2020",
  );
  const [formColorTrc, setFormColorTrc] = useState(() =>
    isTauriRuntime() ? "bt709" : "smpte2084",
  );
  const [formColorspace, setFormColorspace] = useState(() =>
    isTauriRuntime() ? "bt709" : "bt2020nc",
  );
  const [av1CpuUsed, setAv1CpuUsed] = useState("6");
  const [av1RowMt, setAv1RowMt] = useState(true);
  const [av1TileColumns, setAv1TileColumns] = useState("2");
  const [av1TileRows, setAv1TileRows] = useState("1");
  const [av1SvtTune, setAv1SvtTune] = useState("0");
  const [av1FilmGrain, setAv1FilmGrain] = useState("0");
  const [containerFormat, setContainerFormat] = useState<"mp4" | "mkv" | "mov">("mp4");
  const [containerFaststart, setContainerFaststart] = useState(true);
  const [audioMode, setAudioMode] = useState<"copy" | "custom">("copy");
  const [audioCustomArgs, setAudioCustomArgs] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [fileNamePattern, setFileNamePattern] = useState("{inputName}_{taskName}");
  const [clipStartSec, setClipStartSec] = useState(0);
  const [clipEndSec, setClipEndSec] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<SourceSelectionState>(() => ({
    path: isTauriRuntime() ? "" : "/Users/encode-lab/Travel_2024_Film.mov",
    revision: 0,
  }));
  const sourceFilePath = sourceSelection.path;
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadataResult | null>(() =>
    isTauriRuntime() ? null : buildBrowserPreviewMetadata(),
  );
  const [videoMetadataLoading, setVideoMetadataLoading] = useState(false);
  const [videoMetadataErrorState, setVideoMetadataErrorState] = useState<VideoMetadataErrorState | null>(null);
  const metadataRequestRef = useRef(0);
  const initializedDefaultOutputRef = useRef(false);

  /**
   * 切换源素材时立即让旧元数据失效，避免新路径短暂复用旧素材的 HDR、尺寸和时长。
   * @param value 新的源视频路径
   */
  const setSourceFilePath = useCallback((value: string) => {
    metadataRequestRef.current += 1;
    // 即使路径相同也推进 revision，确保“重新选择”表达为新的读取意图。
    setSourceSelection((current) => advanceSourceSelection(current, value));
    setVideoMetadata(null);
    setVideoMetadataErrorState(null);
    setVideoMetadataLoading(Boolean(value.trim()) && isTauriRuntime());
  }, []);

  useEffect(() => {
    const trimmedDefault = defaultOutputDir?.trim();
    if (initializedDefaultOutputRef.current || !trimmedDefault) {
      return;
    }

    // 模板或用户已经指定目录时保持任务级值，否则让设置页的默认目录真正进入任务快照。
    setOutputDir((current) => current.trim() || trimmedDefault);
    initializedDefaultOutputRef.current = true;
  }, [defaultOutputDir]);

  const fetchVideoMetadata = useCallback(async (inputFile: string) => {
    const trimmed = inputFile.trim();
    const requestId = ++metadataRequestRef.current;
    if (!trimmed) {
      setVideoMetadata(null);
      setVideoMetadataErrorState(null);
      setVideoMetadataLoading(false);
      return;
    }

    if (!isTauriRuntime()) {
      // 浏览器 QA 仍保持元数据与当前路径一一对应，覆盖替换素材的竞态分支。
      const result = { ...buildBrowserPreviewMetadata(), inputFile: trimmed };
      setPreserveDolbyVisionMetadata((current) =>
        resolveDolbyVisionPreservationAfterMetadata(current, result),
      );
      setVideoMetadata(result);
      setVideoMetadataLoading(false);
      return;
    }

    setVideoMetadataLoading(true);
    setVideoMetadataErrorState(null);
    try {
      const result = await invoke<VideoMetadataResult>("read_video_metadata", {
        inputFile: trimmed,
      });
      // 只接收最后一次素材读取，避免慢请求覆盖用户刚选择的新文件。
      if (requestId !== metadataRequestRef.current) {
        return;
      }
      // 与元数据落地同一批更新，不能留出“新源非 DV 但旧 preserve=true”的可提交帧。
      setPreserveDolbyVisionMetadata((current) =>
        resolveDolbyVisionPreservationAfterMetadata(current, result),
      );
      setVideoMetadata(result);
    } catch (err) {
      if (requestId !== metadataRequestRef.current) {
        return;
      }
      setVideoMetadata(null);
      setVideoMetadataErrorState({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (requestId === metadataRequestRef.current) {
        setVideoMetadataLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const trimmed = sourceFilePath.trim();
    if (!trimmed) {
      // 使仍在飞行中的读取结果失效，空素材状态不能被旧请求反写。
      metadataRequestRef.current += 1;
      setVideoMetadata(null);
      setVideoMetadataErrorState(null);
      setVideoMetadataLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchVideoMetadata(trimmed);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sourceFilePath, sourceSelection.revision, fetchVideoMetadata]);

  useEffect(() => {
    if (!keepOriginalResolution) {
      return;
    }

    const width = videoMetadata?.video?.width;
    const height = videoMetadata?.video?.height;
    if (width && height) {
      setFormWidth(String(width));
      setFormHeight(String(height));
    }
  }, [keepOriginalResolution, videoMetadata?.video?.width, videoMetadata?.video?.height]);

  useEffect(() => {
    if (!keepOriginalFps) {
      return;
    }

    const sourceFps = videoMetadata?.video?.fps;
    if (sourceFps) {
      // 跟随源帧率时仍同步输入框展示值，方便用户关闭开关后基于源值微调。
      setFormFps(sourceFps.toFixed(3).replace(/\.?0+$/, ""));
    }
  }, [keepOriginalFps, videoMetadata?.video?.fps]);

  useEffect(() => {
    const nextRange = resolveClipRangeAfterMetadataRefresh({
      sourceFilePath,
      durationSec: videoMetadata?.durationSec,
      currentStartSec: clipStartSec,
      currentEndSec: clipEndSec,
    });
    // 有源素材但元数据正在刷新时保留截取意图，等新时长返回后再统一收敛边界。
    if (!nextRange) {
      return;
    }
    setClipStartSec(nextRange.startSec);
    setClipEndSec(nextRange.endSec);
  }, [clipEndSec, clipStartSec, sourceFilePath, videoMetadata?.durationSec]);

  useEffect(() => {
    // 重读期间 metadata 会暂时为空；只有清空源或新元数据明确不支持时才撤销用户意图。
    if (!sourceFilePath.trim() || (videoMetadata && videoMetadata.video?.hdrType !== "DolbyVision")) {
      setPreserveDolbyVisionMetadata(false);
    }
  }, [sourceFilePath, videoMetadata]);

  const pickSourceFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Video",
            extensions: ["mp4", "mov", "mkv", "avi", "m4v", "webm", "flv", "ts"],
          },
        ],
      });
      if (typeof selected === "string") {
        setSourceFilePath(selected);
      }
    } catch (error) {
      setVideoMetadataErrorState({
        key: "taskDraft.source.pickFailed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [setSourceFilePath]);

  const retryVideoMetadata = useCallback(async () => {
    await fetchVideoMetadata(sourceFilePath);
  }, [fetchVideoMetadata, sourceFilePath]);

  /**
   * 将模板快照写回当前任务草稿表单。
   * @param snapshot 模板保存的任务参数快照
   * @param templateName 模板名称；缺省时沿用快照名称
   */
  const applyTemplateSnapshot = useCallback((snapshot: TaskDraftSnapshot, templateName?: string) => {
    const video = snapshot.video;
    const container = snapshot.container;
    const advancedArgs = snapshot.advancedArgs ?? "";
    const preservesDolbyVision = Boolean(video.preserveDolbyVisionMetadata);
    const resolvedAudioMode = resolveDolbyVisionAudioMode(preservesDolbyVision, snapshot.audio.mode);

    // 方案只写入编码参数；当前素材、截取范围、任务名称和输出目录保持任务级语义。
    setFormCodec(video.codecFormat);
    setFormEncoder(video.encoder);
    setFormMode(video.bitrateMode);
    setFormTwoPass(Boolean(video.enableTwoPass));
    setFormCrf(video.crf ?? 23);
    setFormPreset(video.preset ?? "");
    setKeepOriginalResolution(video.keepOriginalResolution ?? !video.resolution);
    setKeepOriginalFps(video.keepOriginalFps ?? !video.fps);
    setPreserveDolbyVisionMetadata(preservesDolbyVision);
    setFormWidth(video.resolution?.width ? String(video.resolution.width) : "1920");
    setFormHeight(video.resolution?.height ? String(video.resolution.height) : "1080");
    setFormFps(video.fps ? String(video.fps) : "30");
    setFormPixelFormat(video.pixelFormat ?? "yuv420p");
    setContainerFormat(container.format);
    setContainerFaststart(Boolean(container.faststart));
    setActiveTemplateName(templateName?.trim() || snapshot.name);
    // 历史模板可能包含后端不接受的 DV + Custom Audio 组合，恢复时直接归一化。
    setAudioMode(resolvedAudioMode);
    setAudioCustomArgs(snapshot.audio.customArgs ?? "");
    setFileNamePattern(snapshot.output.fileNamePattern || "{inputName}_{taskName}");
    setFormBitrateKbps(readAdvancedArgValue(advancedArgs, "-b:v") ?? "5000");
    setFormMaxrateKbps(readAdvancedArgValue(advancedArgs, "-maxrate") ?? "7000");
    setFormBufsizeKbps(readAdvancedArgValue(advancedArgs, "-bufsize") ?? "10000");
    setFormColorPrimaries(readAdvancedArgValue(advancedArgs, "-color_primaries") ?? "bt709");
    setFormColorTrc(readAdvancedArgValue(advancedArgs, "-color_trc") ?? "bt709");
    setFormColorspace(readAdvancedArgValue(advancedArgs, "-colorspace") ?? "bt709");
    setAv1CpuUsed(readAdvancedArgValue(advancedArgs, "-cpu-used") ?? "6");
    setAv1RowMt(readAdvancedArgValue(advancedArgs, "-row-mt") !== "0");
    setAv1TileColumns(readTilePart(advancedArgs, 0) ?? "2");
    setAv1TileRows(readTilePart(advancedArgs, 1) ?? "1");
    setAv1SvtTune(readSvtParamValue(advancedArgs, "tune") ?? "0");
    setAv1FilmGrain(readSvtParamValue(advancedArgs, "film-grain") ?? "0");
  }, [setActiveTemplateName]);

  /**
   * 构建色彩元数据参数。
   * @returns FFmpeg 色彩参数片段
   */
  const buildColorArgs = useCallback(() => {
    const colorPrimaries = preserveDolbyVisionMetadata
      ? videoMetadata?.video?.colorPrimaries ?? formColorPrimaries
      : formColorPrimaries;
    const colorTrc = preserveDolbyVisionMetadata
      ? videoMetadata?.video?.colorTransfer ?? formColorTrc
      : formColorTrc;
    const colorspace = preserveDolbyVisionMetadata
      ? videoMetadata?.video?.colorSpace ?? formColorspace
      : formColorspace;

    return `-color_primaries ${colorPrimaries} -color_trc ${colorTrc} -colorspace ${colorspace}`;
  }, [
    preserveDolbyVisionMetadata,
    formColorPrimaries,
    formColorTrc,
    formColorspace,
    videoMetadata?.video?.colorPrimaries,
    videoMetadata?.video?.colorTransfer,
    videoMetadata?.video?.colorSpace,
  ]);

  /**
   * 构建 AV1 软件编码器高级参数。
   * @returns 当前 AV1 编码器适用的高级参数；硬件编码器返回空字符串
   */
  const buildAv1AdvancedArgs = useCallback(() => {
    if (formCodec !== "av1") {
      return "";
    }

    if (formEncoder === "libaom-av1") {
      const args = [`-cpu-used ${av1CpuUsed}`];
      if (av1RowMt) {
        args.push("-row-mt 1");
      }
      if (av1TileColumns && av1TileRows) {
        // libaom 使用 CxR 表达 tile 布局，空值时交给编码器默认策略。
        args.push(`-tiles ${av1TileColumns}x${av1TileRows}`);
      }
      return args.join(" ");
    }

    if (formEncoder === "svtav1") {
      const params = [`tune=${av1SvtTune}`];
      if (av1FilmGrain !== "0") {
        params.push(`film-grain=${av1FilmGrain}`);
      }
      return `-svtav1-params ${params.join(":")}`;
    }

    return "";
  }, [
    formCodec,
    formEncoder,
    av1CpuUsed,
    av1RowMt,
    av1TileColumns,
    av1TileRows,
    av1SvtTune,
    av1FilmGrain,
  ]);

  /**
   * 合并结构化表单无法直接表达的 FFmpeg 参数。
   * @returns 可直接提交给后端的 advancedArgs
   */
  const buildAdvancedArgs = useCallback(() => {
    const args = [
      formMode !== "CRF"
        ? `-b:v ${formBitrateKbps}k -maxrate ${formMaxrateKbps}k -bufsize ${formBufsizeKbps}k`
        : "",
      buildColorArgs(),
      buildAv1AdvancedArgs(),
    ].filter(Boolean);

    return args.join(" ");
  }, [
    formMode,
    formBitrateKbps,
    formMaxrateKbps,
    formBufsizeKbps,
    buildColorArgs,
    buildAv1AdvancedArgs,
  ]);

  const taskDraftSnapshot = useMemo<TaskDraftSnapshot>(
    () => {
      const durationSec = videoMetadata?.durationSec ?? 0;
      const hasClipRange =
        !preserveDolbyVisionMetadata &&
        durationSec > 0 &&
        // 非默认输入即进入快照，让非法区间由统一策略明确阻断，不能静默退回整片。
        (clipStartSec !== 0 || clipEndSec !== durationSec);
      const isVideoStreamCopy = !preserveDolbyVisionMetadata && formCodec === "copy";
      const resolvedAudioMode = resolveDolbyVisionAudioMode(preserveDolbyVisionMetadata, audioMode);
      const resolvedContainerFormat = resolveDolbyVisionContainerFormat(
        preserveDolbyVisionMetadata,
        containerFormat,
      );

      return {
        name: draftName.trim() || "preview-draft",
        clipRange: hasClipRange
          ? {
              startMs: Math.round(clipStartSec * 1000),
              endMs: Math.round(clipEndSec * 1000),
            }
          : undefined,
        video: {
          codecFormat: preserveDolbyVisionMetadata
            ? "h265"
            : (formCodec as TaskDraftSnapshot["video"]["codecFormat"]),
          encoder: preserveDolbyVisionMetadata ? "libx265" : isVideoStreamCopy ? "copy" : formEncoder,
          bitrateMode: preserveDolbyVisionMetadata ? "CRF" : formMode,
          crf: !isVideoStreamCopy && (preserveDolbyVisionMetadata || formMode === "CRF") ? formCrf : undefined,
          preset: isVideoStreamCopy ? undefined : formPreset || undefined,
          keepOriginalResolution: isVideoStreamCopy || preserveDolbyVisionMetadata || keepOriginalResolution,
          keepOriginalFps: isVideoStreamCopy || preserveDolbyVisionMetadata || keepOriginalFps,
          preserveDolbyVisionMetadata: isVideoStreamCopy ? false : preserveDolbyVisionMetadata,
          // 保持原始尺寸时不传 resolution，让后端跳过 scale 参数并保留源尺寸语义。
          resolution:
            !isVideoStreamCopy && !preserveDolbyVisionMetadata && !keepOriginalResolution && formWidth && formHeight
              ? {
                  width: Number(formWidth),
                  height: Number(formHeight),
                }
              : undefined,
          // 跟随源视频帧率时不传 fps，让后端跳过 -r 参数并保留源帧率语义。
          fps:
            !isVideoStreamCopy && !preserveDolbyVisionMetadata && !keepOriginalFps && formFps
              ? Number(formFps)
              : undefined,
          pixelFormat: isVideoStreamCopy ? undefined : preserveDolbyVisionMetadata ? "yuv420p10le" : formPixelFormat || undefined,
          enableTwoPass: isVideoStreamCopy || preserveDolbyVisionMetadata ? false : formTwoPass,
        },
        audio: {
          mode: resolvedAudioMode,
          customArgs: resolvedAudioMode === "custom" ? audioCustomArgs.trim() || undefined : undefined,
        },
        container: {
          format: resolvedContainerFormat,
          faststart:
            resolvedContainerFormat === "mp4" ? containerFaststart : false,
        },
        // DV 路径由后端按 Profile 构造色彩和 VBV 参数，避免普通高级参数污染专用链路。
        advancedArgs: preserveDolbyVisionMetadata || isVideoStreamCopy ? undefined : buildAdvancedArgs(),
        output: {
          dir: outputDir.trim(),
          fileNamePattern: fileNamePattern.trim() || "{inputName}_{taskName}",
          overwrite: "autoRename",
        },
      };
    },
    [
      clipStartSec,
      clipEndSec,
      draftName,
      formCodec,
      formEncoder,
      formMode,
      formCrf,
      formPreset,
      keepOriginalResolution,
      keepOriginalFps,
      preserveDolbyVisionMetadata,
      formWidth,
      formHeight,
      formFps,
      formPixelFormat,
      formTwoPass,
      formBitrateKbps,
      formMaxrateKbps,
      formBufsizeKbps,
      containerFormat,
      containerFaststart,
      audioMode,
      audioCustomArgs,
      outputDir,
      fileNamePattern,
      buildAdvancedArgs,
      videoMetadata?.durationSec,
    ],
  );

  const videoMetadataError = videoMetadataErrorState
    ? videoMetadataErrorState.key
      ? t(videoMetadataErrorState.key, { message: videoMetadataErrorState.message })
      : videoMetadataErrorState.message
    : null;

  const value = useMemo(
    () => ({
      draftName,
      setDraftName,
      activeTemplateName,
      hasNamedTemplate,
      setActiveTemplateName,
      formCodec,
      setFormCodec,
      formEncoder,
      setFormEncoder,
      formMode,
      setFormMode,
      formTwoPass,
      setFormTwoPass,
      formCrf,
      setFormCrf,
      formPreset,
      setFormPreset,
      keepOriginalResolution,
      setKeepOriginalResolution,
      keepOriginalFps,
      setKeepOriginalFps,
      preserveDolbyVisionMetadata,
      setPreserveDolbyVisionMetadata,
      formWidth,
      setFormWidth,
      formHeight,
      setFormHeight,
      formFps,
      setFormFps,
      formBitrateKbps,
      setFormBitrateKbps,
      formMaxrateKbps,
      setFormMaxrateKbps,
      formBufsizeKbps,
      setFormBufsizeKbps,
      formPixelFormat,
      setFormPixelFormat,
      formColorPrimaries,
      setFormColorPrimaries,
      formColorTrc,
      setFormColorTrc,
      formColorspace,
      setFormColorspace,
      av1CpuUsed,
      setAv1CpuUsed,
      av1RowMt,
      setAv1RowMt,
      av1TileColumns,
      setAv1TileColumns,
      av1TileRows,
      setAv1TileRows,
      av1SvtTune,
      setAv1SvtTune,
      av1FilmGrain,
      setAv1FilmGrain,
      containerFormat,
      setContainerFormat,
      containerFaststart,
      setContainerFaststart,
      audioMode,
      setAudioMode,
      audioCustomArgs,
      setAudioCustomArgs,
      outputDir,
      setOutputDir,
      fileNamePattern,
      setFileNamePattern,
      clipStartSec,
      setClipStartSec,
      clipEndSec,
      setClipEndSec,
      sourceFilePath,
      setSourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      pickSourceFile,
      retryVideoMetadata,
      applyTemplateSnapshot,
      taskDraftSnapshot,
    }),
    [
      draftName,
      activeTemplateName,
      hasNamedTemplate,
      formCodec,
      formEncoder,
      formMode,
      formTwoPass,
      formCrf,
      formPreset,
      keepOriginalResolution,
      keepOriginalFps,
      preserveDolbyVisionMetadata,
      formWidth,
      formHeight,
      formFps,
      formBitrateKbps,
      formMaxrateKbps,
      formBufsizeKbps,
      formPixelFormat,
      formColorPrimaries,
      formColorTrc,
      formColorspace,
      av1CpuUsed,
      av1RowMt,
      av1TileColumns,
      av1TileRows,
      av1SvtTune,
      av1FilmGrain,
      containerFormat,
      containerFaststart,
      audioMode,
      audioCustomArgs,
      outputDir,
      fileNamePattern,
      clipStartSec,
      clipEndSec,
      sourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      pickSourceFile,
      retryVideoMetadata,
      applyTemplateSnapshot,
      taskDraftSnapshot,
    ],
  );

  return <TaskDraftContext.Provider value={value}>{children}</TaskDraftContext.Provider>;
}

/**
 * 从高级参数中读取指定 flag 后面的值，并去掉常见码率单位。
 * @param args 高级参数字符串
 * @param flag 参数名
 */
function readAdvancedArgValue(args: string, flag: string) {
  const tokens = args.trim().split(/\s+/);
  const index = tokens.indexOf(flag);
  const value = index >= 0 ? tokens[index + 1] : undefined;
  return value?.replace(/k$/i, "");
}

/**
 * 读取 libaom tiles 参数的列或行。
 * @param args 高级参数字符串
 * @param index 0 为 columns，1 为 rows
 */
function readTilePart(args: string, index: 0 | 1) {
  const value = readAdvancedArgValue(args, "-tiles");
  return value?.split("x")[index];
}

/**
 * 读取 svtav1 参数值。
 * @param args 高级参数字符串
 * @param key svtav1 参数名
 */
function readSvtParamValue(args: string, key: string) {
  const params = readAdvancedArgValue(args, "-svtav1-params");
  return params
    ?.split(":")
    .map((item) => item.split("="))
    .find(([name]) => name === key)?.[1];
}

export function useTaskDraft() {
  const context = useContext(TaskDraftContext);
  if (!context) {
    throw new Error("useTaskDraft must be used within TaskDraftProvider");
  }
  return context;
}
