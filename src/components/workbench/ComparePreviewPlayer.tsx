import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { Button } from "../ui/button";
import type {
  ComparePreviewRuntime,
  PreviewConfig,
  PreviewFrameEvent,
  PreviewState,
  PreviewStateEvent,
  StartPreviewResponse,
  TaskDraftSnapshot,
  UpdatePreviewResponse,
} from "../../types/workbench";

type Props = {
  sourceFile: string;
  taskDraftSnapshot: TaskDraftSnapshot;
  splitMode: "vertical" | "horizontal";
  splitterPosition: number;
  onSplitModeChange: (value: "vertical" | "horizontal") => void;
  onSplitterPositionChange: (value: number) => void;
  onRuntimeChange: (value: ComparePreviewRuntime) => void;
};

const CONTROL_AUTO_HIDE_MS = 2500;
const UPDATE_INTERVAL_MS = 300;

export function ComparePreviewPlayer({
  sourceFile,
  taskDraftSnapshot,
  splitMode,
  splitterPosition,
  onSplitModeChange,
  onSplitterPositionChange,
  onRuntimeChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const previewClipRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const isScrubbingRef = useRef(false);
  const pendingScrubTimeMsRef = useRef<number | null>(null);
  const lastUpdateAtRef = useRef(0);
  const lastFrameSeqRef = useRef(0);
  const taskConfigRef = useRef(taskDraftSnapshot);

  const [previewMediaSrc, setPreviewMediaSrc] = useState<string | null>(null);
  const [previewMediaKind, setPreviewMediaKind] = useState<"video" | "image">("video");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewSpeed, setPreviewSpeed] = useState<number | undefined>(undefined);
  const [estimatedTranscodeSpeed, setEstimatedTranscodeSpeed] = useState<number | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | undefined>(undefined);
  const [degradedFromTwoPass, setDegradedFromTwoPass] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);

  taskConfigRef.current = taskDraftSnapshot;

  const sourceAssetUrl = useMemo(
    () => (sourceFile ? convertFileSrc(sourceFile) : ""),
    [sourceFile],
  );

  const clipPath =
    splitMode === "vertical"
      ? `inset(0 0 0 ${Math.round(splitterPosition * 100)}%)`
      : `inset(${Math.round(splitterPosition * 100)}% 0 0 0)`;

  /**
   * 将主视频时间同步到预览短片段内部时间。
   * @param sourceTimeSec 主视频当前时间，单位秒
   */
  const syncPreviewVideoTime = (sourceTimeSec: number) => {
    const previewVideo = previewVideoRef.current;
    const clipRange = previewClipRangeRef.current;
    if (!previewVideo || !clipRange) {
      return;
    }

    const nextTime = Math.max(0, sourceTimeSec - clipRange.startMs / 1000);
    if (Number.isFinite(nextTime) && Math.abs(previewVideo.currentTime - nextTime) > 0.2) {
      previewVideo.currentTime = nextTime;
    }
  };

  /**
   * 判断当前时间是否仍在已生成的预览片段内。
   * @param timeMs 主视频当前时间，单位毫秒
   * @returns true 表示可复用当前预览片段
   */
  const isTimeInsidePreviewClip = (timeMs: number) => {
    const clipRange = previewClipRangeRef.current;
    if (!clipRange) {
      return false;
    }

    // 接近片段末尾时提前刷新，避免右侧覆盖视频播完后停住。
    return timeMs >= clipRange.startMs && timeMs <= clipRange.endMs - 800;
  };

  useEffect(() => {
    onRuntimeChange({
      previewState,
      previewSpeed,
      estimatedTranscodeSpeed,
      previewError,
      degradedFromTwoPass,
      currentTimeSec,
      durationSec,
      isFullscreen,
    });
  }, [
    previewState,
    previewSpeed,
    estimatedTranscodeSpeed,
    previewError,
    degradedFromTwoPass,
    currentTimeSec,
    durationSec,
    isFullscreen,
    onRuntimeChange,
  ]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      setIsOverlayVisible(true);
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    const resetAutoHide = () => {
      setIsOverlayVisible(true);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
      if (document.fullscreenElement === containerRef.current) {
        hideTimerRef.current = window.setTimeout(() => {
          setIsOverlayVisible(false);
        }, CONTROL_AUTO_HIDE_MS);
      }
    };

    const element = containerRef.current;
    if (!element) {
      return;
    }

    element.addEventListener("mousemove", resetAutoHide);
    element.addEventListener("pointerdown", resetAutoHide);
    element.addEventListener("touchstart", resetAutoHide);
    return () => {
      element.removeEventListener("mousemove", resetAutoHide);
      element.removeEventListener("pointerdown", resetAutoHide);
      element.removeEventListener("touchstart", resetAutoHide);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceAssetUrl) {
      return;
    }

    video.load();
  }, [sourceAssetUrl]);

  useEffect(() => {
    let unlistenFrame: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;

    const setup = async () => {
      unlistenFrame = await listen<PreviewFrameEvent>("preview:frame", (event) => {
        const payload = event.payload;
        if (!sessionIdRef.current || payload.previewSessionId !== sessionIdRef.current) {
          return;
        }
        if (payload.seq <= lastFrameSeqRef.current) {
          return;
        }

        const assetPath = payload.mediaPath ?? payload.imagePath;
        const nextMediaSrc = payload.base64 ?? (assetPath ? convertFileSrc(assetPath) : null);
        if (!nextMediaSrc) {
          return;
        }

        lastFrameSeqRef.current = payload.seq;
        previewClipRangeRef.current = {
          startMs: payload.clipStartMs,
          endMs: payload.clipEndMs,
        };
        setPreviewMediaKind(payload.mediaKind);
        setPreviewMediaSrc(nextMediaSrc);
        setPreviewError(undefined);
      });

      unlistenState = await listen<PreviewStateEvent>("preview:state", (event) => {
        const payload = event.payload;
        if (!sessionIdRef.current || payload.previewSessionId !== sessionIdRef.current) {
          return;
        }
        setPreviewState(payload.state);
        setPreviewSpeed(payload.previewSpeed);
        setEstimatedTranscodeSpeed(payload.estimatedTranscodeSpeed);
        setDegradedFromTwoPass(Boolean(payload.degradedFromTwoPass));
        setPreviewError(payload.error ? `${payload.error.code}: ${payload.error.message}` : undefined);
      });
    };

    void setup();

    return () => {
      if (unlistenFrame) {
        unlistenFrame();
      }
      if (unlistenState) {
        unlistenState();
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const startSession = async () => {
      if (!sourceFile) {
        setPreviewState("idle");
        setPreviewMediaSrc(null);
        setPreviewError(undefined);
        setSessionId(null);
        return;
      }

      if (sessionIdRef.current) {
        await invoke("stop_preview", { previewSessionId: sessionIdRef.current }).catch(() => {});
        sessionIdRef.current = null;
        setSessionId(null);
      }

      const payload: PreviewConfig = {
        inputFile: sourceFile,
        renderScale: 0.5,
        compareOrientation: splitMode,
        splitterPosition,
        timeMs: Math.round(currentTimeSec * 1000),
        taskConfigSnapshot: taskDraftSnapshot,
      };

      try {
        const result = await invoke<StartPreviewResponse>("start_preview", { payload });
        if (canceled) {
          await invoke("stop_preview", { previewSessionId: result.previewSessionId }).catch(() => {});
          return;
        }
        sessionIdRef.current = result.previewSessionId;
        setSessionId(result.previewSessionId);
        setPreviewError(undefined);
        setDegradedFromTwoPass(Boolean(result.degradedFromTwoPass));
        lastFrameSeqRef.current = 0;
      } catch (err) {
        setPreviewState("error");
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    };

    void startSession();

    return () => {
      canceled = true;
      if (sessionIdRef.current) {
        void invoke("stop_preview", { previewSessionId: sessionIdRef.current }).catch(() => {});
        sessionIdRef.current = null;
        setSessionId(null);
      }
    };
  }, [sourceFile]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void invoke<UpdatePreviewResponse>("update_preview", {
        previewSessionId: sessionId,
        patch: {
          compareOrientation: splitMode,
          splitterPosition,
          taskConfigSnapshot: taskDraftSnapshot,
        },
      }).catch((err) => {
        setPreviewState("error");
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
    }, UPDATE_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [sessionId, splitMode, splitterPosition, taskDraftSnapshot]);

  const dispatchTimeUpdate = (timeMs: number, immediate = false) => {
    syncPreviewVideoTime(timeMs / 1000);

    if (isScrubbingRef.current && !immediate) {
      pendingScrubTimeMsRef.current = timeMs;
      return;
    }
    if (!sessionIdRef.current) {
      return;
    }
    if (!immediate && isTimeInsidePreviewClip(timeMs)) {
      return;
    }
    const now = Date.now();
    if (!immediate && now - lastUpdateAtRef.current < UPDATE_INTERVAL_MS) {
      return;
    }
    lastUpdateAtRef.current = now;
    void invoke<UpdatePreviewResponse>("update_preview", {
      previewSessionId: sessionIdRef.current,
      patch: {
        timeMs,
      },
    }).catch((err) => {
      setPreviewState("error");
      setPreviewError(err instanceof Error ? err.message : String(err));
    });
  };

  /**
   * 开始拖动时间轴时暂停预览转码请求，避免每个滑块位置都启动 ffmpeg。
   */
  const beginTimelineScrub = () => {
    isScrubbingRef.current = true;
    setIsScrubbingTimeline(true);
  };

  /**
   * 结束时间轴拖动后只提交最后一个时间点。
   */
  const commitTimelineScrub = () => {
    if (!isScrubbingRef.current && pendingScrubTimeMsRef.current === null) {
      return;
    }

    isScrubbingRef.current = false;
    setIsScrubbingTimeline(false);

    const timeMs = pendingScrubTimeMsRef.current ?? Math.round(currentTimeSec * 1000);
    pendingScrubTimeMsRef.current = null;
    dispatchTimeUpdate(timeMs, true);
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      await video.play().catch(() => {});
      await previewVideoRef.current?.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      previewVideoRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (document.fullscreenElement === container) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await container.requestFullscreen().catch(() => {});
    }
  };

  const updateSplitterByPointer = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const raw =
      splitMode === "vertical"
        ? (clientX - rect.left) / rect.width
        : (clientY - rect.top) / rect.height;
    const next = Math.min(0.9, Math.max(0.1, raw));
    onSplitterPositionChange(next);
  };

  useEffect(() => {
    if (!isDraggingSplitter) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      updateSplitterByPointer(event.clientX, event.clientY);
    };
    const onPointerUp = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDraggingSplitter, splitMode]);

  useEffect(() => {
    if (previewMediaKind !== "video" || !previewMediaSrc) {
      return;
    }

    syncPreviewVideoTime(currentTimeSec);
    if (isPlaying) {
      void previewVideoRef.current?.play().catch(() => {});
    }
  }, [previewMediaKind, previewMediaSrc, currentTimeSec, isPlaying]);

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-3xl border bg-black"
        onDoubleClick={() => void toggleFullscreen()}
      >
        {sourceFile ? (
          <video
            ref={videoRef}
            src={sourceAssetUrl}
            className="aspect-video w-full bg-black object-contain"
            onLoadedMetadata={(event) => {
              setDurationSec(event.currentTarget.duration || 0);
            }}
            onError={() => {
              setPreviewError("源视频无法加载，请检查 asset 权限或文件编码格式");
            }}
            onPlay={() => {
              setIsPlaying(true);
              void previewVideoRef.current?.play().catch(() => {});
            }}
            onPause={() => {
              previewVideoRef.current?.pause();
              setIsPlaying(false);
            }}
            onTimeUpdate={(event) => {
              const nextTime = event.currentTarget.currentTime;
              setCurrentTimeSec(nextTime);
              dispatchTimeUpdate(Math.round(nextTime * 1000));
            }}
            onSeeking={(event) => {
              const nextTime = event.currentTarget.currentTime;
              setCurrentTimeSec(nextTime);
              syncPreviewVideoTime(nextTime);
              dispatchTimeUpdate(Math.round(nextTime * 1000), !isScrubbingRef.current);
            }}
          />
        ) : (
          <div className="grid aspect-video place-items-center text-sm text-muted-foreground">
            先在任务配置页选择源视频，再进入预览。
          </div>
        )}

        {previewMediaSrc && previewMediaKind === "video" ? (
          <video
            ref={previewVideoRef}
            src={previewMediaSrc}
            muted
            playsInline
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            style={{ clipPath }}
            onLoadedMetadata={() => {
              syncPreviewVideoTime(currentTimeSec);
            }}
            onError={() => {
              setPreviewError("预览片段生成成功，但当前 WebView 无法解码该编码格式");
            }}
          />
        ) : null}

        {previewMediaSrc && previewMediaKind === "image" ? (
          <img
            src={previewMediaSrc}
            alt="preview frame"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            style={{ clipPath }}
          />
        ) : null}

        <div
          className={`absolute ${
            splitMode === "vertical"
              ? "inset-y-0 w-1 -translate-x-1/2 cursor-col-resize"
              : "inset-x-0 h-1 -translate-y-1/2 cursor-row-resize"
          } bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.4)]`}
          style={
            splitMode === "vertical"
              ? { left: `${splitterPosition * 100}%` }
              : { top: `${splitterPosition * 100}%` }
          }
          onPointerDown={(event) => {
            setIsDraggingSplitter(true);
            updateSplitterByPointer(event.clientX, event.clientY);
          }}
        />

        <div
          className={`absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-4 transition ${
            !isOverlayVisible && isFullscreen ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="text-sm text-white/90">
            <div className="font-medium">实时按帧预览</div>
            <div className="text-xs text-white/70">
              {previewState} · {degradedFromTwoPass ? "2-pass 预览降级为 1-pass" : "当前为单 pass"}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/60 to-transparent px-4 pb-4 pt-16 transition ${
            !isOverlayVisible && isFullscreen ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto_auto_auto] md:items-center">
            <Button size="sm" variant="secondary" onClick={() => void togglePlay()}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <input
              type="range"
              min={0}
              max={durationSec || 0}
              step={0.01}
              value={currentTimeSec}
              onPointerDown={beginTimelineScrub}
              onPointerUp={commitTimelineScrub}
              onTouchStart={beginTimelineScrub}
              onTouchEnd={commitTimelineScrub}
              onKeyDown={beginTimelineScrub}
              onKeyUp={commitTimelineScrub}
              onChange={(event) => {
                const next = Number(event.target.value);
                const nextMs = Math.round(next * 1000);
                pendingScrubTimeMsRef.current = nextMs;
                if (videoRef.current) {
                  videoRef.current.currentTime = next;
                }
                syncPreviewVideoTime(next);
                setCurrentTimeSec(next);
              }}
            />
            <div className="text-xs text-white/75">
              {currentTimeSec.toFixed(2)} / {durationSec.toFixed(2)}s
            </div>
            <Button
              size="sm"
              variant={splitMode === "vertical" ? "default" : "secondary"}
              onClick={() => onSplitModeChange("vertical")}
            >
              左右
            </Button>
            <Button
              size="sm"
              variant={splitMode === "horizontal" ? "default" : "secondary"}
              onClick={() => onSplitModeChange("horizontal")}
            >
              上下
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/75">
            <span>previewSpeed: {previewSpeed ? `${previewSpeed.toFixed(2)}x` : "-"}</span>
            <span>
              estimatedTranscodeSpeed: {estimatedTranscodeSpeed ? `${estimatedTranscodeSpeed.toFixed(2)}x` : "-"}
            </span>
            {isScrubbingTimeline ? <span>拖动中，松手后刷新预览</span> : null}
            {previewError ? <span className="text-red-200">error: {previewError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
