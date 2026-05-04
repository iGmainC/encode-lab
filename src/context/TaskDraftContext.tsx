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
  sourceFilePath: string;
  setSourceFilePath: (value: string) => void;
  videoMetadata: VideoMetadataResult | null;
  videoMetadataLoading: boolean;
  videoMetadataError: string | null;
  isDragOverWindow: boolean;
  pickSourceFile: () => Promise<void>;
  retryVideoMetadata: () => Promise<void>;
  taskDraftSnapshot: TaskDraftSnapshot;
};

const TaskDraftContext = createContext<TaskDraftContextValue | null>(null);

export function TaskDraftProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<TaskDraftStep>("source");
  const [formCodec, setFormCodec] = useState("h264");
  const [formEncoder, setFormEncoder] = useState("libx264");
  const [formMode, setFormMode] = useState<"CRF" | "CBR" | "ABR">("CRF");
  const [formTwoPass, setFormTwoPass] = useState(false);
  const [formCrf, setFormCrf] = useState(23);
  const [formPreset, setFormPreset] = useState("medium");
  const [keepOriginalResolution, setKeepOriginalResolution] = useState(true);
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
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadataResult | null>(null);
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

  const taskDraftSnapshot = useMemo<TaskDraftSnapshot>(
    () => ({
      name: "preview-draft",
      video: {
        codecFormat: formCodec as TaskDraftSnapshot["video"]["codecFormat"],
        encoder: formEncoder,
        bitrateMode: formMode,
        crf: formMode === "CRF" ? formCrf : undefined,
        preset: formPreset || undefined,
        keepOriginalResolution,
        preserveDolbyVisionMetadata,
        // 保持原始尺寸时不传 resolution，让后端跳过 scale 参数并保留源尺寸语义。
        resolution:
          !keepOriginalResolution && formWidth && formHeight
            ? {
                width: Number(formWidth),
                height: Number(formHeight),
              }
            : undefined,
        fps: formFps ? Number(formFps) : undefined,
        pixelFormat: formPixelFormat || undefined,
        enableTwoPass: formTwoPass,
      },
      audio: {
        mode: "copy",
      },
      container: {
        format: "mp4",
        faststart: true,
      },
      advancedArgs:
        formMode !== "CRF"
          ? `-b:v ${formBitrateKbps}k -maxrate ${formMaxrateKbps}k -bufsize ${formBufsizeKbps}k -color_primaries ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorPrimaries ?? formColorPrimaries
                : formColorPrimaries
            } -color_trc ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorTransfer ?? formColorTrc
                : formColorTrc
            } -colorspace ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorSpace ?? formColorspace
                : formColorspace
            }`
          : `-color_primaries ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorPrimaries ?? formColorPrimaries
                : formColorPrimaries
            } -color_trc ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorTransfer ?? formColorTrc
                : formColorTrc
            } -colorspace ${
              preserveDolbyVisionMetadata
                ? videoMetadata?.video?.colorSpace ?? formColorspace
                : formColorspace
            }`,
      output: {
        dir: "",
        fileNamePattern: "{inputName}_{taskName}",
        overwrite: "autoRename",
      },
    }),
    [
      formCodec,
      formEncoder,
      formMode,
      formCrf,
      formPreset,
      keepOriginalResolution,
      preserveDolbyVisionMetadata,
      formWidth,
      formHeight,
      formFps,
      formPixelFormat,
      formTwoPass,
      formBitrateKbps,
      formMaxrateKbps,
      formBufsizeKbps,
      formColorPrimaries,
      formColorTrc,
      formColorspace,
      videoMetadata?.video?.colorPrimaries,
      videoMetadata?.video?.colorTransfer,
      videoMetadata?.video?.colorSpace,
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
      sourceFilePath,
      setSourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      isDragOverWindow,
      pickSourceFile,
      retryVideoMetadata,
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
      sourceFilePath,
      videoMetadata,
      videoMetadataLoading,
      videoMetadataError,
      isDragOverWindow,
      pickSourceFile,
      retryVideoMetadata,
      taskDraftSnapshot,
    ],
  );

  return <TaskDraftContext.Provider value={value}>{children}</TaskDraftContext.Provider>;
}

export function useTaskDraft() {
  const context = useContext(TaskDraftContext);
  if (!context) {
    throw new Error("useTaskDraft must be used within TaskDraftProvider");
  }
  return context;
}
