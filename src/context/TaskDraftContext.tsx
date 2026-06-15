import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type {
  TaskDraftSnapshot,
  VideoMetadataResult,
  TaskDraftStep,
} from "../types/workbench";

type TaskDraftContextValue = {
  step: TaskDraftStep;
  setStep: (step: TaskDraftStep) => void;
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
  clipStartSec: number;
  setClipStartSec: (value: number) => void;
  clipEndSec: number;
  setClipEndSec: (value: number) => void;
  sourceFilePath: string;
  setSourceFilePath: (value: string) => void;
  videoMetadata: VideoMetadataResult | null;
  videoMetadataLoading: boolean;
  videoMetadataError: string | null;
  isDragOverWindow: boolean;
  pickSourceFile: () => Promise<void>;
  retryVideoMetadata: () => Promise<void>;
  applyTemplateSnapshot: (snapshot: TaskDraftSnapshot) => void;
  taskDraftSnapshot: TaskDraftSnapshot;
};

const TaskDraftContext = createContext<TaskDraftContextValue | null>(null);

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

export function TaskDraftProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<TaskDraftStep>("source");
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
  const [formPixelFormat, setFormPixelFormat] = useState("yuv420p");
  const [formColorPrimaries, setFormColorPrimaries] = useState("bt709");
  const [formColorTrc, setFormColorTrc] = useState("bt709");
  const [formColorspace, setFormColorspace] = useState("bt709");
  const [av1CpuUsed, setAv1CpuUsed] = useState("6");
  const [av1RowMt, setAv1RowMt] = useState(true);
  const [av1TileColumns, setAv1TileColumns] = useState("2");
  const [av1TileRows, setAv1TileRows] = useState("1");
  const [av1SvtTune, setAv1SvtTune] = useState("0");
  const [av1FilmGrain, setAv1FilmGrain] = useState("0");
  const [containerFormat, setContainerFormat] = useState<"mp4" | "mkv" | "mov">("mp4");
  const [containerFaststart, setContainerFaststart] = useState(true);
  const [clipStartSec, setClipStartSec] = useState(0);
  const [clipEndSec, setClipEndSec] = useState(0);
  const [sourceFilePath, setSourceFilePath] = useState(() =>
    isTauriRuntime() ? "" : "/Users/encode-lab/Travel_2024_Film.mov",
  );
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadataResult | null>(() =>
    isTauriRuntime() ? null : buildBrowserPreviewMetadata(),
  );
  const [videoMetadataLoading, setVideoMetadataLoading] = useState(false);
  const [videoMetadataError, setVideoMetadataError] = useState<string | null>(null);
  const [isDragOverWindow, setIsDragOverWindow] = useState(false);

  const fetchVideoMetadata = useCallback(async (inputFile: string) => {
    const trimmed = inputFile.trim();
    if (!trimmed) {
      setVideoMetadata(null);
      setVideoMetadataError(null);
      setVideoMetadataLoading(false);
      return;
    }

    if (!isTauriRuntime()) {
      setVideoMetadata(buildBrowserPreviewMetadata());
      setStep((current) => (current === "source" ? "config" : current));
      return;
    }

    setVideoMetadataLoading(true);
    setVideoMetadataError(null);
    try {
      const result = await invoke<VideoMetadataResult>("read_video_metadata", {
        inputFile: trimmed,
      });
      setVideoMetadata(result);
      setStep((current) => (current === "source" ? "config" : current));
    } catch (err) {
      setVideoMetadata(null);
      setVideoMetadataError(err instanceof Error ? err.message : String(err));
    } finally {
      setVideoMetadataLoading(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = sourceFilePath.trim();
    if (!trimmed) {
      setVideoMetadata(null);
      setVideoMetadataError(null);
      setVideoMetadataLoading(false);
      setStep("source");
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchVideoMetadata(trimmed);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sourceFilePath, fetchVideoMetadata]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOverWindow(true);
          return;
        }

        if (event.payload.type === "leave") {
          setIsDragOverWindow(false);
          return;
        }

        if (event.payload.type === "drop") {
          setIsDragOverWindow(false);
          const [firstPath] = event.payload.paths ?? [];
          if (firstPath) {
            setSourceFilePath(firstPath);
          }
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

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
    const durationSec = videoMetadata?.durationSec;
    if (!durationSec || durationSec <= 0) {
      setClipStartSec(0);
      setClipEndSec(0);
      return;
    }

    setClipStartSec((current) => Math.min(Math.max(0, current), durationSec));
    setClipEndSec((current) => {
      if (current <= 0) {
        return durationSec;
      }
      return Math.min(Math.max(current, 0), durationSec);
    });
  }, [videoMetadata?.durationSec]);

  useEffect(() => {
    if (videoMetadata?.video?.hdrType !== "DolbyVision") {
      setPreserveDolbyVisionMetadata(false);
    }
  }, [videoMetadata?.video?.hdrType]);

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
    } catch {
      // User cancel is a valid path.
    }
  }, []);

  const retryVideoMetadata = useCallback(async () => {
    await fetchVideoMetadata(sourceFilePath);
  }, [fetchVideoMetadata, sourceFilePath]);

  /**
   * 将模板快照写回当前任务草稿表单。
   * @param snapshot 模板保存的任务参数快照
   */
  const applyTemplateSnapshot = useCallback((snapshot: TaskDraftSnapshot) => {
    const video = snapshot.video;
    const container = snapshot.container;
    const advancedArgs = snapshot.advancedArgs ?? "";
    const clipRange = snapshot.clipRange;

    setClipStartSec(clipRange ? clipRange.startMs / 1000 : 0);
    setClipEndSec(clipRange ? clipRange.endMs / 1000 : videoMetadata?.durationSec ?? 0);
    setFormCodec(video.codecFormat);
    setFormEncoder(video.encoder);
    setFormMode(video.bitrateMode);
    setFormTwoPass(Boolean(video.enableTwoPass));
    setFormCrf(video.crf ?? 23);
    setFormPreset(video.preset ?? "");
    setKeepOriginalResolution(video.keepOriginalResolution ?? !video.resolution);
    setKeepOriginalFps(video.keepOriginalFps ?? !video.fps);
    setPreserveDolbyVisionMetadata(Boolean(video.preserveDolbyVisionMetadata));
    setFormWidth(video.resolution?.width ? String(video.resolution.width) : "1920");
    setFormHeight(video.resolution?.height ? String(video.resolution.height) : "1080");
    setFormFps(video.fps ? String(video.fps) : "30");
    setFormPixelFormat(video.pixelFormat ?? "yuv420p");
    setContainerFormat(container.format);
    setContainerFaststart(Boolean(container.faststart));
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
    setStep("config");
  }, [videoMetadata?.durationSec]);

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
        durationSec > 0 &&
        clipEndSec > clipStartSec &&
        (clipStartSec > 0 || clipEndSec < durationSec);

      return {
        name: "preview-draft",
        clipRange: hasClipRange
          ? {
              startMs: Math.round(clipStartSec * 1000),
              endMs: Math.round(clipEndSec * 1000),
            }
          : undefined,
        video: {
        codecFormat: formCodec as TaskDraftSnapshot["video"]["codecFormat"],
        encoder: formEncoder,
        bitrateMode: formMode,
        crf: formMode === "CRF" ? formCrf : undefined,
        preset: formPreset || undefined,
        keepOriginalResolution,
        keepOriginalFps,
        preserveDolbyVisionMetadata,
        // 保持原始尺寸时不传 resolution，让后端跳过 scale 参数并保留源尺寸语义。
        resolution:
          !keepOriginalResolution && formWidth && formHeight
            ? {
                width: Number(formWidth),
                height: Number(formHeight),
              }
            : undefined,
        // 跟随源视频帧率时不传 fps，让后端跳过 -r 参数并保留源帧率语义。
        fps: !keepOriginalFps && formFps ? Number(formFps) : undefined,
        pixelFormat: formPixelFormat || undefined,
        enableTwoPass: formTwoPass,
      },
      audio: {
        mode: "copy",
      },
      container: {
        format: containerFormat,
        faststart: containerFormat === "mp4" ? containerFaststart : false,
      },
      advancedArgs: buildAdvancedArgs(),
      output: {
        dir: "",
        fileNamePattern: "{inputName}_{taskName}",
        overwrite: "autoRename",
      },
      };
    },
    [
      clipStartSec,
      clipEndSec,
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
      buildAdvancedArgs,
      videoMetadata?.durationSec,
    ],
  );

  const value = useMemo(
    () => ({
      step,
      setStep,
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
      clipStartSec,
      setClipStartSec,
      clipEndSec,
      setClipEndSec,
      sourceFilePath,
      setSourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      isDragOverWindow,
      pickSourceFile,
      retryVideoMetadata,
      applyTemplateSnapshot,
      taskDraftSnapshot,
    }),
    [
      step,
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
      clipStartSec,
      clipEndSec,
      sourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      isDragOverWindow,
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
