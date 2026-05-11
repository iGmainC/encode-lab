import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { useI18n } from "../../i18n/I18nProvider";
import type {
  CompareImageOrder,
  ComparePreviewFrameSnapshot,
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
  sourceDurationSec?: number;
  taskDraftSnapshot: TaskDraftSnapshot;
  splitMode: "vertical" | "horizontal";
  splitterPosition: number;
  compareOrder: CompareImageOrder;
  initialTimeSec?: number;
  initialFrame?: ComparePreviewFrameSnapshot;
  onSplitModeChange: (value: "vertical" | "horizontal") => void;
  onSplitterPositionChange: (value: number) => void;
  onCompareOrderChange: (value: CompareImageOrder) => void;
  onRuntimeChange: (value: ComparePreviewRuntime) => void;
  fillViewport?: boolean;
  deferSessionUntilInteraction?: boolean;
  onFullscreenButtonClick?: (value: ComparePreviewRuntime) => void;
  fullscreenButtonIcon?: "fullscreen" | "close";
};

/** 控制区在全屏模式下自动隐藏的延迟，单位毫秒。 */
const CONTROL_AUTO_HIDE_MS = 2500;
/** 参数变化后自动刷新当前帧的防抖时间，单位毫秒。 */
const UPDATE_INTERVAL_MS = 300;
/** 预览帧固定使用半尺寸渲染，兼顾可读性和生成速度。 */
const PREVIEW_RENDER_SCALE: PreviewConfig["renderScale"] = 0.5;

/** 兼容部分 WebView 只暴露 WebKit 前缀 Fullscreen API 的情况。 */
type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** 兼容 WebKit 前缀 fullscreen 状态和退出 API。 */
type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/**
 * 获取当前原生全屏元素。
 * @returns 标准或 WebKit 前缀 Fullscreen API 记录的全屏元素
 */
function getNativeFullscreenElement() {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

/**
 * 尝试进入原生全屏。
 * @param element 需要全屏展示的容器
 * @returns true 表示原生全屏已请求成功；false 表示需要走应用内 fallback
 */
async function requestNativeFullscreen(element: HTMLElement) {
  const fullscreenElement = element as WebkitFullscreenElement;
  const requestFullscreen = element.requestFullscreen ?? fullscreenElement.webkitRequestFullscreen;
  if (!requestFullscreen) {
    return false;
  }

  try {
    await requestFullscreen.call(element);
    return true;
  } catch {
    return false;
  }
}

/**
 * 尝试退出原生全屏。
 * @returns true 表示已调用原生退出逻辑
 */
async function exitNativeFullscreen() {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  const exitFullscreen = document.exitFullscreen ?? fullscreenDocument.webkitExitFullscreen;
  if (!exitFullscreen) {
    return false;
  }

  try {
    await exitFullscreen.call(document);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将秒数转换为毫秒整数。
 * @param seconds 时间，单位秒
 * @returns 四舍五入后的毫秒
 */
function secondsToMs(seconds: number) {
  return Math.round(seconds * 1000);
}

/**
 * 将时间限制到源视频范围内。
 * @param value 当前时间，单位秒
 * @param durationSec 源视频总时长，单位秒
 * @returns 合法的时间点
 */
function clampTimeSec(value: number, durationSec: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (durationSec <= 0) {
    return Math.max(0, value);
  }
  return Math.min(durationSec, Math.max(0, value));
}

/**
 * 生成前端用于判断帧是否仍匹配当前参数的稳定 key。
 * @param inputFile 源文件路径
 * @param timeMs 当前时间点，单位毫秒
 * @param taskDraftSnapshotKey 参数快照序列化结果
 * @param renderScale 预览渲染缩放
 * @returns 当前预览请求的唯一 key
 */
function buildPreviewRenderKey(
  inputFile: string,
  timeMs: number,
  taskDraftSnapshotKey: string,
  renderScale: PreviewConfig["renderScale"],
) {
  return JSON.stringify([inputFile, timeMs, taskDraftSnapshotKey, renderScale]);
}

/**
 * 判断外部传入的首帧是否可直接复用。
 * @param frame 候选首帧
 * @param desiredRenderKey 当前时间点和参数对应的 key
 * @returns 匹配时返回原帧，否则返回 undefined
 */
function getReusableInitialFrame(
  frame: ComparePreviewFrameSnapshot | undefined,
  desiredRenderKey: string,
) {
  return frame?.renderKey === desiredRenderKey ? frame : undefined;
}

/**
 * 管理预览时间轴的草稿时间和松手提交。
 * @param options 时间轴配置和提交回调
 * @returns 当前时间、拖动状态和 Slider 事件处理函数
 */
function usePreviewTimeline({
  durationSec,
  initialTimeSec,
  initialFrame,
  onCommitTimeMs,
}: {
  durationSec: number;
  initialTimeSec?: number;
  initialFrame?: ComparePreviewFrameSnapshot;
  onCommitTimeMs: (timeMs: number) => void;
}) {
  const initialCurrentTimeSec = clampTimeSec(
    initialFrame ? initialFrame.timeMs / 1000 : initialTimeSec ?? 0,
    durationSec,
  );
  const currentTimeSecRef = useRef(initialCurrentTimeSec);
  const pendingTimeMsRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const [currentTimeSec, setCurrentTimeSecState] = useState(initialCurrentTimeSec);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);

  /**
   * 同步时间到 state 和 ref，供全局 release 兜底读取最新值。
   * @param value 当前时间，单位秒
   */
  const setCurrentTimeSec = useCallback(
    (value: number) => {
      const next = clampTimeSec(value, durationSec);
      currentTimeSecRef.current = next;
      setCurrentTimeSecState(next);
    },
    [durationSec],
  );

  useEffect(() => {
    if (initialTimeSec === undefined) {
      return;
    }

    setCurrentTimeSec(initialTimeSec);
  }, [initialTimeSec, setCurrentTimeSec]);

  useEffect(() => {
    if (!initialFrame) {
      return;
    }

    setCurrentTimeSec(initialFrame.timeMs / 1000);
  }, [initialFrame, setCurrentTimeSec]);

  /**
   * 标记用户已开始拖动时间轴。
   */
  const beginTimelineScrub = useCallback(() => {
    isScrubbingRef.current = true;
    setIsScrubbingTimeline(true);
  }, []);

  /**
   * 更新草稿时间，不触发后端抽帧。
   * @param value Slider 的当前值数组
   */
  const updateDraftTime = useCallback(
    (value: number[]) => {
      const next = clampTimeSec(value[0] ?? currentTimeSecRef.current, durationSec);
      pendingTimeMsRef.current = secondsToMs(next);
      setCurrentTimeSec(next);
    },
    [durationSec, setCurrentTimeSec],
  );

  /**
   * 提交最后一个草稿时间点。
   * @param value Slider commit 传入的最终值数组
   */
  const commitDraftTime = useCallback(
    (value?: number[]) => {
      if (value && (isScrubbingRef.current || pendingTimeMsRef.current !== null)) {
        updateDraftTime(value);
      }
      if (!isScrubbingRef.current && pendingTimeMsRef.current === null) {
        return;
      }

      const timeMs = pendingTimeMsRef.current ?? secondsToMs(currentTimeSecRef.current);
      pendingTimeMsRef.current = null;
      isScrubbingRef.current = false;
      setIsScrubbingTimeline(false);
      onCommitTimeMs(timeMs);
    },
    [onCommitTimeMs, updateDraftTime],
  );

  useEffect(() => {
    if (!isScrubbingTimeline) {
      return;
    }

    const commitFromWindow = () => commitDraftTime();

    // Slider 的 release 在窗口外发生时仍需要提交最后时间点。
    window.addEventListener("pointerup", commitFromWindow);
    window.addEventListener("pointercancel", commitFromWindow);
    window.addEventListener("touchend", commitFromWindow);
    window.addEventListener("blur", commitFromWindow);
    return () => {
      window.removeEventListener("pointerup", commitFromWindow);
      window.removeEventListener("pointercancel", commitFromWindow);
      window.removeEventListener("touchend", commitFromWindow);
      window.removeEventListener("blur", commitFromWindow);
    };
  }, [commitDraftTime, isScrubbingTimeline]);

  return {
    currentTimeSec,
    currentTimeMs: secondsToMs(currentTimeSec),
    isScrubbingTimeline,
    isScrubbingRef,
    beginTimelineScrub,
    updateDraftTime,
    commitDraftTime,
  };
}

/**
 * 管理预览会话、渲染请求和 Tauri 事件。
 * @param options 当前预览参数和目标帧信息
 * @returns 当前预览帧、状态和渲染操作
 */
function usePreviewFrameSession({
  sourceFile,
  taskDraftSnapshot,
  taskDraftSnapshotKey,
  splitMode,
  splitterPosition,
  desiredTimeMs,
  desiredRenderKey,
  initialFrame,
  deferSessionUntilInteraction,
  isScrubbingTimeline,
  imageLoadFailedText,
}: {
  sourceFile: string;
  taskDraftSnapshot: TaskDraftSnapshot;
  taskDraftSnapshotKey: string;
  splitMode: "vertical" | "horizontal";
  splitterPosition: number;
  desiredTimeMs: number;
  desiredRenderKey: string;
  initialFrame?: ComparePreviewFrameSnapshot;
  deferSessionUntilInteraction: boolean;
  isScrubbingTimeline: boolean;
  imageLoadFailedText: string;
}) {
  const sessionIdRef = useRef<string | null>(null);
  const desiredRenderKeyRef = useRef(desiredRenderKey);
  const lastSubmittedRenderKeyRef = useRef<string | null>(null);
  const lastFrameSeqRef = useRef(0);
  const fallbackRenderKeyRef = useRef<string | null>(null);

  const [listenersReady, setListenersReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewSpeed, setPreviewSpeed] = useState<number | undefined>(undefined);
  const [estimatedTranscodeSpeed, setEstimatedTranscodeSpeed] = useState<number | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | undefined>(undefined);
  const [degradedFromTwoPass, setDegradedFromTwoPass] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<ComparePreviewFrameSnapshot | undefined>(() =>
    getReusableInitialFrame(initialFrame, desiredRenderKey),
  );

  const visibleFrame = currentFrame?.renderKey === desiredRenderKey ? currentFrame : undefined;
  const sourceImageSrc = useMemo(
    () => (visibleFrame ? convertFileSrc(visibleFrame.sourceImagePath) : null),
    [visibleFrame],
  );
  const previewImageSrc = useMemo(
    () => (visibleFrame ? convertFileSrc(visibleFrame.previewImagePath) : null),
    [visibleFrame],
  );

  useEffect(() => {
    desiredRenderKeyRef.current = desiredRenderKey;
  }, [desiredRenderKey]);

  /**
   * 清空当前帧和图片状态。
   */
  const clearFrameSnapshot = useCallback(() => {
    setCurrentFrame(undefined);
  }, []);

  /**
   * 停止当前后端预览 session。
   */
  const stopSession = useCallback(() => {
    if (!sessionIdRef.current) {
      return;
    }

    void invoke("stop_preview", { previewSessionId: sessionIdRef.current }).catch(() => {});
    sessionIdRef.current = null;
    setSessionId(null);
  }, []);

  /**
   * 确保后端预览 session 已存在。
   * @param timeMs 当前渲染时间点，单位毫秒
   * @returns 当前或新建的 session id
   */
  const ensureSession = useCallback(
    async (timeMs: number) => {
      if (sessionIdRef.current) {
        return sessionIdRef.current;
      }
      if (!listenersReady || !sourceFile) {
        return null;
      }

      const payload: PreviewConfig = {
        inputFile: sourceFile,
        renderScale: PREVIEW_RENDER_SCALE,
        compareOrientation: splitMode,
        splitterPosition,
        timeMs,
        taskConfigSnapshot: taskDraftSnapshot,
      };

      try {
        const result = await invoke<StartPreviewResponse>("start_preview", { payload });
        sessionIdRef.current = result.previewSessionId;
        setSessionId(result.previewSessionId);
        setPreviewState("warming");
        setPreviewError(undefined);
        setDegradedFromTwoPass(Boolean(result.degradedFromTwoPass));
        lastFrameSeqRef.current = 0;
        return result.previewSessionId;
      } catch (err) {
        setPreviewState("error");
        setPreviewError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [listenersReady, sourceFile, splitMode, splitterPosition, taskDraftSnapshot],
  );

  /**
   * 请求生成指定时间和参数对应的预览帧。
   * @param timeMs 当前时间点，单位毫秒
   * @param renderKey 本次渲染请求对应的前端 key
   */
  const requestFrame = useCallback(
    async (timeMs: number, renderKey: string) => {
      if (!sourceFile) {
        return;
      }

      const previewSessionId = await ensureSession(timeMs);
      if (!previewSessionId) {
        return;
      }

      lastSubmittedRenderKeyRef.current = renderKey;
      fallbackRenderKeyRef.current = null;
      setPreviewState((state) => (state === "idle" ? "warming" : "updating"));

      void invoke<UpdatePreviewResponse>("update_preview", {
        previewSessionId,
        patch: {
          taskConfigSnapshot: taskDraftSnapshot,
          timeMs,
        },
      }).catch((err) => {
        setPreviewState("error");
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
    },
    [ensureSession, sourceFile, taskDraftSnapshot],
  );

  /**
   * 复用帧加载失败时重新生成当前目标帧。
   */
  const retryCurrentFrame = useCallback(() => {
    if (fallbackRenderKeyRef.current === desiredRenderKey) {
      setPreviewState("error");
      setPreviewError(imageLoadFailedText);
      return;
    }

    // 当前图片路径已失效时立即隐藏旧帧，避免继续展示错误资源。
    fallbackRenderKeyRef.current = desiredRenderKey;
    clearFrameSnapshot();
    void requestFrame(desiredTimeMs, desiredRenderKey);
  }, [clearFrameSnapshot, desiredRenderKey, desiredTimeMs, imageLoadFailedText, requestFrame]);

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

        lastFrameSeqRef.current = payload.seq;
        if (!payload.sourceImagePath || !payload.previewImagePath) {
          return;
        }

        const submittedRenderKey = lastSubmittedRenderKeyRef.current;
        if (!submittedRenderKey || submittedRenderKey !== desiredRenderKeyRef.current) {
          return;
        }

        setCurrentFrame({
          sourceImagePath: payload.sourceImagePath,
          previewImagePath: payload.previewImagePath,
          timeMs: payload.timeMs,
          seq: payload.seq,
          renderKey: submittedRenderKey,
        });
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

      setListenersReady(true);
    };

    void setup();

    return () => {
      setListenersReady(false);
      if (unlistenFrame) {
        unlistenFrame();
      }
      if (unlistenState) {
        unlistenState();
      }
    };
  }, []);

  useEffect(() => {
    const reusableInitialFrame = getReusableInitialFrame(initialFrame, desiredRenderKey);
    if (!reusableInitialFrame) {
      return;
    }

    // 独立窗口复用主窗口帧时，不启动新的 session，避免首屏重复跑 FFmpeg。
    setCurrentFrame(reusableInitialFrame);
    lastSubmittedRenderKeyRef.current = desiredRenderKey;
    setPreviewState("running");
    setPreviewError(undefined);
  }, [desiredRenderKey, initialFrame]);

  useEffect(() => {
    if (!sourceFile) {
      stopSession();
      clearFrameSnapshot();
      setPreviewState("idle");
      setPreviewError(undefined);
      return;
    }
    if (!listenersReady) {
      return;
    }

    const reusableInitialFrame = getReusableInitialFrame(initialFrame, desiredRenderKey);
    if (deferSessionUntilInteraction && reusableInitialFrame) {
      setCurrentFrame(reusableInitialFrame);
      lastSubmittedRenderKeyRef.current = desiredRenderKey;
      setPreviewState("running");
      return;
    }

    void requestFrame(desiredTimeMs, desiredRenderKey);

    return () => {
      stopSession();
    };
  }, [listenersReady, sourceFile]);

  useEffect(() => {
    if (!sourceFile || !sessionId || isScrubbingTimeline) {
      return;
    }
    if (lastSubmittedRenderKeyRef.current === desiredRenderKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      void requestFrame(desiredTimeMs, desiredRenderKey);
    }, UPDATE_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [desiredRenderKey, desiredTimeMs, isScrubbingTimeline, requestFrame, sessionId, sourceFile, taskDraftSnapshotKey]);

  return {
    currentFrame: visibleFrame,
    sourceImageSrc,
    previewImageSrc,
    previewState,
    previewSpeed,
    estimatedTranscodeSpeed,
    previewError,
    degradedFromTwoPass,
    requestFrame,
    retryCurrentFrame,
  };
}

/**
 * 管理分割线拖动状态和全局事件。
 * @param options 分割线容器和外部位置回调
 * @returns 分割线拖动入口函数
 */
function useCompareSplitterDrag({
  containerRef,
  splitMode,
  onSplitterPositionChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  splitMode: "vertical" | "horizontal";
  onSplitterPositionChange: (value: number) => void;
}) {
  const latestPositionRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  /**
   * 根据指针坐标计算分割线位置。
   * @param clientX 指针 x 坐标
   * @param clientY 指针 y 坐标
   * @returns 0.1 - 0.9 范围内的分割线位置
   */
  const getSplitterPositionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return null;
      }

      const raw =
        splitMode === "vertical"
          ? (clientX - rect.left) / rect.width
          : (clientY - rect.top) / rect.height;
      return Math.min(0.9, Math.max(0.1, raw));
    },
    [containerRef, splitMode],
  );

  /**
   * 通过 requestAnimationFrame 合并高频拖动更新。
   * @param next 下一个分割线位置
   */
  const scheduleSplitterPosition = useCallback(
    (next: number) => {
      latestPositionRef.current = next;
      if (animationFrameRef.current !== null) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        if (latestPositionRef.current !== null) {
          onSplitterPositionChange(latestPositionRef.current);
        }
      });
    },
    [onSplitterPositionChange],
  );

  /**
   * 从 pointer 事件更新分割线位置。
   * @param clientX 指针 x 坐标
   * @param clientY 指针 y 坐标
   */
  const updateSplitterByPointer = useCallback(
    (clientX: number, clientY: number) => {
      const next = getSplitterPositionFromPointer(clientX, clientY);
      if (next === null) {
        return;
      }
      scheduleSplitterPosition(next);
    },
    [getSplitterPositionFromPointer, scheduleSplitterPosition],
  );

  /**
   * 开始拖动分割线。
   * @param event 分割线 pointerdown 事件
   */
  const beginSplitterDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setIsDraggingSplitter(true);
      updateSplitterByPointer(event.clientX, event.clientY);
    },
    [updateSplitterByPointer],
  );

  useEffect(() => {
    if (!isDraggingSplitter) {
      return;
    }

    const previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onPointerMove = (event: PointerEvent) => {
      // 拖动分割线时阻止文本选择和图片拖拽。
      event.preventDefault();
      updateSplitterByPointer(event.clientX, event.clientY);
    };
    const onPointerUp = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.style.userSelect = previousBodyUserSelect;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isDraggingSplitter, updateSplitterByPointer]);

  return {
    isDraggingSplitter,
    beginSplitterDrag,
  };
}

export function ComparePreviewPlayer({
  sourceFile,
  sourceDurationSec,
  taskDraftSnapshot,
  splitMode,
  splitterPosition,
  compareOrder,
  initialTimeSec,
  initialFrame,
  onSplitModeChange,
  onSplitterPositionChange,
  onCompareOrderChange,
  onRuntimeChange,
  fillViewport = false,
  deferSessionUntilInteraction = false,
  onFullscreenButtonClick,
  fullscreenButtonIcon = "fullscreen",
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenFallback, setIsFullscreenFallback] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const requestFrameRef = useRef<((timeMs: number, renderKey: string) => void) | null>(null);

  const fullscreenActive = isFullscreen || isFullscreenFallback;
  const previewFullscreenActive = fullscreenActive || fillViewport;
  const durationSec = sourceDurationSec ?? 0;
  const taskDraftSnapshotKey = useMemo(
    () => JSON.stringify(taskDraftSnapshot),
    [taskDraftSnapshot],
  );

  const timeline = usePreviewTimeline({
    durationSec,
    initialTimeSec,
    initialFrame,
    onCommitTimeMs: (timeMs) => {
      const renderKey = buildPreviewRenderKey(
        sourceFile,
        timeMs,
        taskDraftSnapshotKey,
        PREVIEW_RENDER_SCALE,
      );
      requestFrameRef.current?.(timeMs, renderKey);
    },
  });

  const desiredRenderKey = useMemo(
    () =>
      buildPreviewRenderKey(
        sourceFile,
        timeline.currentTimeMs,
        taskDraftSnapshotKey,
        PREVIEW_RENDER_SCALE,
      ),
    [sourceFile, taskDraftSnapshotKey, timeline.currentTimeMs],
  );

  const previewSession = usePreviewFrameSession({
    sourceFile,
    taskDraftSnapshot,
    taskDraftSnapshotKey,
    splitMode,
    splitterPosition,
    desiredTimeMs: timeline.currentTimeMs,
    desiredRenderKey,
    initialFrame,
    deferSessionUntilInteraction,
    isScrubbingTimeline: timeline.isScrubbingTimeline,
    imageLoadFailedText: t("preview.imageLoadFailed"),
  });
  requestFrameRef.current = (timeMs, renderKey) => {
    void previewSession.requestFrame(timeMs, renderKey);
  };

  const splitterDrag = useCompareSplitterDrag({
    containerRef,
    splitMode,
    onSplitterPositionChange,
  });

  const hasFrame = Boolean(previewSession.sourceImageSrc && previewSession.previewImageSrc);
  const splitterPercent = Math.round(splitterPosition * 100);
  const sourceIsFirst = compareOrder === "source-first";
  const clipPath =
    splitMode === "vertical"
      ? sourceIsFirst
        ? `inset(0 0 0 ${splitterPercent}%)`
        : `inset(0 ${100 - splitterPercent}% 0 0)`
      : sourceIsFirst
        ? `inset(${splitterPercent}% 0 0 0)`
        : `inset(0 0 ${100 - splitterPercent}% 0)`;
  const firstPaneLabel = sourceIsFirst ? t("preview.frame.source") : t("preview.frame.preview");
  const secondPaneLabel = sourceIsFirst ? t("preview.frame.preview") : t("preview.frame.source");
  const firstPaneSideLabel = splitMode === "vertical" ? t("preview.side.left") : t("preview.side.top");
  const secondPaneSideLabel = splitMode === "vertical" ? t("preview.side.right") : t("preview.side.bottom");
  const firstPaneClass = "left-4 top-20";
  const secondPaneClass =
    splitMode === "vertical" ? "right-4 top-20" : "left-4 bottom-28";

  const runtime = useMemo<ComparePreviewRuntime>(
    () => ({
      previewState: previewSession.previewState,
      previewSpeed: previewSession.previewSpeed,
      estimatedTranscodeSpeed: previewSession.estimatedTranscodeSpeed,
      previewError: previewSession.previewError,
      degradedFromTwoPass: previewSession.degradedFromTwoPass,
      currentTimeSec: timeline.currentTimeSec,
      durationSec,
      isFullscreen: previewFullscreenActive,
      currentFrame: previewSession.currentFrame,
    }),
    [
      durationSec,
      previewFullscreenActive,
      previewSession.currentFrame,
      previewSession.degradedFromTwoPass,
      previewSession.estimatedTranscodeSpeed,
      previewSession.previewError,
      previewSession.previewSpeed,
      previewSession.previewState,
      timeline.currentTimeSec,
    ],
  );

  useEffect(() => {
    onRuntimeChange(runtime);
  }, [onRuntimeChange, runtime]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = getNativeFullscreenElement() === containerRef.current;
      setIsFullscreen(active);
      if (active) {
        setIsFullscreenFallback(false);
      }
      setIsOverlayVisible(true);
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!isFullscreenFallback) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreenFallback(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreenFallback]);

  useEffect(() => {
    const resetAutoHide = () => {
      setIsOverlayVisible(true);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
      if (previewFullscreenActive) {
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
  }, [previewFullscreenActive]);

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (isFullscreenFallback) {
      setIsFullscreenFallback(false);
      return;
    }
    if (getNativeFullscreenElement() === container) {
      await exitNativeFullscreen();
    } else {
      const enteredNativeFullscreen = await requestNativeFullscreen(container);
      if (!enteredNativeFullscreen) {
        // Tauri WebView 或宿主策略可能拒绝 Fullscreen API，此时退回到应用内 fixed 全屏。
        setIsFullscreenFallback(true);
        setIsOverlayVisible(true);
      }
    }
  };

  /**
   * 处理预览放大按钮。
   */
  const handleFullscreenButtonClick = () => {
    if (onFullscreenButtonClick) {
      onFullscreenButtonClick(runtime);
      return;
    }

    void toggleFullscreen();
  };

  return (
    <div className={fillViewport ? "h-screen select-none bg-black" : "space-y-4 select-none"}>
      <div
        ref={containerRef}
        className={`relative touch-none overflow-hidden bg-black ${
          previewFullscreenActive
            ? `${fillViewport ? "h-full w-full" : "fixed inset-0 z-50 h-screen w-screen"} rounded-none border-0`
            : "rounded-3xl border"
        }`}
        onDoubleClick={handleFullscreenButtonClick}
      >
        {sourceFile ? (
          <div className={`relative w-full bg-black ${previewFullscreenActive ? "h-full" : "aspect-video"}`}>
            {hasFrame ? (
              <>
                <img
                  src={previewSession.sourceImageSrc ?? ""}
                  alt="source frame"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                  onError={previewSession.retryCurrentFrame}
                />
                <img
                  src={previewSession.previewImageSrc ?? ""}
                  alt="preview frame"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                  style={{ clipPath }}
                  onError={previewSession.retryCurrentFrame}
                />
              </>
            ) : (
              <div className="grid h-full place-items-center text-sm text-white/70">
                {previewSession.previewState === "error" ? t("preview.frameFailed") : t("preview.frameLoading")}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`grid place-items-center text-sm text-muted-foreground ${
              previewFullscreenActive ? "h-full" : "aspect-video"
            }`}
          >
            {t("preview.needSource")}
          </div>
        )}

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
          onPointerDown={splitterDrag.beginSplitterDrag}
        />

        {hasFrame ? (
          <>
            <div
              className={`pointer-events-none absolute z-10 rounded-md bg-black/65 px-2 py-1 text-xs font-medium text-white shadow ${firstPaneClass}`}
            >
              {firstPaneSideLabel} · {firstPaneLabel}
            </div>
            <div
              className={`pointer-events-none absolute z-10 rounded-md bg-black/65 px-2 py-1 text-xs font-medium text-white shadow ${secondPaneClass}`}
            >
              {secondPaneSideLabel} · {secondPaneLabel}
            </div>
          </>
        ) : null}

        <div
          className={`absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-4 transition ${
            !isOverlayVisible && previewFullscreenActive ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="text-sm text-white/90">
            <div className="font-medium">{t("preview.player.title")}</div>
            <div className="text-xs text-white/70">
              {previewSession.previewState} · {previewSession.degradedFromTwoPass ? t("preview.degraded") : t("preview.singleFrame")}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              handleFullscreenButtonClick();
            }}
          >
            {fullscreenButtonIcon === "close" ? (
              <X className="h-4 w-4" />
            ) : previewFullscreenActive ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/60 to-transparent px-4 pb-4 pt-16 transition ${
            !isOverlayVisible && previewFullscreenActive ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center">
            <Slider
              min={0}
              max={durationSec || 0}
              step={0.01}
              value={[timeline.currentTimeSec]}
              onPointerDown={timeline.beginTimelineScrub}
              onPointerCancel={() => timeline.commitDraftTime()}
              onPointerUp={() => timeline.commitDraftTime()}
              onBlur={() => timeline.commitDraftTime()}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                  timeline.beginTimelineScrub();
                }
              }}
              onKeyUp={() => timeline.commitDraftTime()}
              onValueChange={timeline.updateDraftTime}
              onValueCommit={timeline.commitDraftTime}
            />
            <div className="text-xs text-white/75">
              {timeline.currentTimeSec.toFixed(2)} / {durationSec.toFixed(2)}s
            </div>
            <Button
              size="sm"
              variant={splitMode === "vertical" ? "default" : "secondary"}
              onClick={() => onSplitModeChange("vertical")}
            >
              {t("preview.splitVertical")}
            </Button>
            <Button
              size="sm"
              variant={splitMode === "horizontal" ? "default" : "secondary"}
              onClick={() => onSplitModeChange("horizontal")}
            >
              {t("preview.splitHorizontal")}
            </Button>
            <label className="flex items-center gap-2 rounded-md bg-white/10 px-2 py-1 text-xs text-white/80">
              <span>{sourceIsFirst ? t("preview.sourceFirst") : t("preview.previewFirst")}</span>
              <Switch
                size="sm"
                checked={!sourceIsFirst}
                aria-label={t("preview.switchOrder")}
                onCheckedChange={(checked) => {
                  // 切换显示方向只影响前端裁剪和标签，不触发后端重新生成预览帧。
                  onCompareOrderChange(checked ? "preview-first" : "source-first");
                }}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/75">
            <span>previewSpeed: {previewSession.previewSpeed ? `${previewSession.previewSpeed.toFixed(2)}x` : "-"}</span>
            <span>
              estimatedTranscodeSpeed: {previewSession.estimatedTranscodeSpeed ? `${previewSession.estimatedTranscodeSpeed.toFixed(2)}x` : "-"}
            </span>
            {timeline.isScrubbingTimeline ? <span>{t("preview.scrubbing")}</span> : null}
            {previewSession.previewError ? <span className="text-red-200">error: {previewSession.previewError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
