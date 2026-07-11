import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { useI18n } from "../../i18n/I18nProvider";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import previewOutputFrame from "../../assets/preview-output-frame.png";
import previewSourceFrame from "../../assets/preview-source-frame.png";
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
  VideoStreamMetadata,
} from "../../types/workbench";

type Props = {
  sourceFile: string;
  sourceDurationSec?: number;
  sourceFps?: number;
  sourceHdrType?: VideoStreamMetadata["hdrType"];
  sourceColorPrimaries?: VideoStreamMetadata["colorPrimaries"];
  sourceColorTransfer?: VideoStreamMetadata["colorTransfer"];
  sourceColorSpace?: VideoStreamMetadata["colorSpace"];
  sourceColorRange?: VideoStreamMetadata["colorRange"];
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

/** 预览 SDR 映射需要传给后端的源色彩上下文。 */
type PreviewSourceColorContext = Pick<
  PreviewConfig,
  "sourceHdrType" | "sourceColorPrimaries" | "sourceColorTransfer" | "sourceColorSpace" | "sourceColorRange"
>;

/** Tauri 命令错误负载。 */
type PreviewInvokeError = {
  /** 后端错误码 */
  code?: string;
  /** 后端错误说明 */
  message?: string;
};

/** 国际化文案查询函数。 */
type Translate = ReturnType<typeof useI18n>["t"];

/** 控制区在全屏模式下自动隐藏的延迟，单位毫秒。 */
const CONTROL_AUTO_HIDE_MS = 2500;
/** 参数变化后自动刷新当前帧的防抖时间，单位毫秒。 */
const UPDATE_INTERVAL_MS = 300;
/** 预览帧固定使用半尺寸渲染，兼顾可读性和生成速度。 */
const PREVIEW_RENDER_SCALE: PreviewConfig["renderScale"] = 0.5;
/** 后端会编码 8 帧作为质量样本；额外保留 2 帧避免容器时长与末帧 PTS 偏差。 */
const PREVIEW_END_GUARD_FRAMES = 10;

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
 * 计算最后一个可请求的预览时间点，避免把 FFmpeg 定位到精确 EOF。
 * @param durationSec 源视频总时长，单位秒
 * @param sourceFps 源视频帧率
 * @returns 为编码样本窗口预留足够帧数的安全时间轴上限
 */
function getPreviewTimelineMaxSec(durationSec: number, sourceFps?: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }

  // 帧率缺失时按 25fps 预留 400ms；避免 FFmpeg 在不足 8 帧时只写出不可解码的容器头。
  const endGuardSec = sourceFps && Number.isFinite(sourceFps) && sourceFps > 0
    ? PREVIEW_END_GUARD_FRAMES / sourceFps
    : 0.4;
  return Math.max(0, durationSec - endGuardSec);
}

/**
 * 生成前端用于判断帧是否仍匹配当前参数的稳定 key。
 * @param inputFile 源文件路径
 * @param timeMs 当前时间点，单位毫秒
 * @param taskDraftSnapshotKey 参数快照序列化结果
 * @param renderScale 预览渲染缩放
 * @param sourceColorContext 源视频 HDR 和色彩元数据
 * @returns 当前预览请求的唯一 key
 */
function buildPreviewRenderKey(
  inputFile: string,
  timeMs: number,
  taskDraftSnapshotKey: string,
  renderScale: PreviewConfig["renderScale"],
  sourceColorContext: PreviewSourceColorContext,
) {
  return JSON.stringify([
    inputFile,
    timeMs,
    taskDraftSnapshotKey,
    renderScale,
    sourceColorContext.sourceHdrType ?? null,
    sourceColorContext.sourceColorPrimaries ?? null,
    sourceColorContext.sourceColorTransfer ?? null,
    sourceColorContext.sourceColorSpace ?? null,
    sourceColorContext.sourceColorRange ?? null,
  ]);
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
 * 格式化预览 invoke 错误，避免 Tauri 序列化错误对象显示为 [object Object]。
 * @param error invoke 捕获到的未知错误
 * @returns 可直接展示给用户的错误文案
 */
function formatPreviewInvokeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const payload = error as PreviewInvokeError;
    if (typeof payload.message === "string") {
      return payload.code ? `${payload.code}: ${payload.message}` : payload.message;
    }
  }

  return String(error);
}

/**
 * 把后端诊断压缩成操作建议，完整日志仍保留在技术详情中。
 * @param error 已格式化的预览错误
 * @returns 面向当前操作的简短说明
 */
function getPreviewErrorSummary(error: string, t: Translate) {
  if (error.includes("End of file") || error.includes("EOF")) {
    return t("preview.error.eofSummary");
  }
  if (error.includes("Error opening input")) {
    return t("preview.error.inputSummary");
  }
  return t("preview.error.genericSummary");
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

  useEffect(() => {
    // 素材或帧率变化后把旧时间点重新限制到当前可解码范围内。
    setCurrentTimeSec(currentTimeSecRef.current);
  }, [durationSec, setCurrentTimeSec]);

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
  sourceColorContext,
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
  sourceColorContext: PreviewSourceColorContext;
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
  const [listenerSetupFailed, setListenerSetupFailed] = useState(false);
  const [degradedFromTwoPass, setDegradedFromTwoPass] = useState(false);
  const [degradedFromDolbyVision, setDegradedFromDolbyVision] = useState(false);
  const [degradedFromSdrTonemap, setDegradedFromSdrTonemap] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<ComparePreviewFrameSnapshot | undefined>(() =>
    getReusableInitialFrame(initialFrame, desiredRenderKey),
  );

  const visibleFrame = currentFrame?.renderKey === desiredRenderKey ? currentFrame : undefined;
  const sourceImageSrc = useMemo(
    () =>
      !isTauriRuntime() && sourceFile
        ? previewSourceFrame
        : visibleFrame
          ? convertFileSrc(visibleFrame.sourceImagePath)
          : null,
    [sourceFile, visibleFrame],
  );
  const previewImageSrc = useMemo(
    () =>
      !isTauriRuntime() && sourceFile
        ? previewOutputFrame
        : visibleFrame
          ? convertFileSrc(visibleFrame.previewImagePath)
          : null,
    [sourceFile, visibleFrame],
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
      if (!isTauriRuntime()) {
        return null;
      }

      const payload: PreviewConfig = {
        inputFile: sourceFile,
        ...sourceColorContext,
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
        setDegradedFromDolbyVision(Boolean(result.degradedFromDolbyVision));
        setDegradedFromSdrTonemap(Boolean(result.degradedFromSdrTonemap));
        lastFrameSeqRef.current = 0;
        return result.previewSessionId;
      } catch (err) {
        setPreviewState("error");
        setPreviewError(formatPreviewInvokeError(err));
        return null;
      }
    },
    [listenersReady, sourceFile, sourceColorContext, splitMode, splitterPosition, taskDraftSnapshot],
  );

  /**
   * 请求生成指定时间和参数对应的预览帧。
   * @param timeMs 当前时间点，单位毫秒
   * @param renderKey 本次渲染请求对应的前端 key
   * @param resetImageRecovery 是否允许新帧再次触发一次自动恢复
   */
  const requestFrame = useCallback(
    async (timeMs: number, renderKey: string, resetImageRecovery = true) => {
      if (!sourceFile) {
        return;
      }

      if (!isTauriRuntime()) {
        lastSubmittedRenderKeyRef.current = renderKey;
        if (resetImageRecovery) {
          fallbackRenderKeyRef.current = null;
        }
        setPreviewState("running");
        setPreviewSpeed(1.6);
        setEstimatedTranscodeSpeed(0.72);
        setDegradedFromTwoPass(true);
        setDegradedFromDolbyVision(Boolean(taskDraftSnapshot.video.preserveDolbyVisionMetadata));
        setDegradedFromSdrTonemap(false);
        setPreviewError(undefined);
        return;
      }

      const previewSessionId = await ensureSession(timeMs);
      if (!previewSessionId) {
        return;
      }

      lastSubmittedRenderKeyRef.current = renderKey;
      if (resetImageRecovery) {
        fallbackRenderKeyRef.current = null;
      }
      setPreviewState((state) => (state === "idle" ? "warming" : "updating"));

      void invoke<UpdatePreviewResponse>("update_preview", {
        previewSessionId,
        patch: {
          taskConfigSnapshot: taskDraftSnapshot,
          timeMs,
        },
      })
        .then((result) => {
          setDegradedFromTwoPass(Boolean(result.degradedFromTwoPass));
          setDegradedFromDolbyVision(Boolean(result.degradedFromDolbyVision));
          setDegradedFromSdrTonemap(Boolean(result.degradedFromSdrTonemap));
        })
        .catch((err) => {
          setPreviewState("error");
          setPreviewError(formatPreviewInvokeError(err));
        });
    },
    [ensureSession, sourceFile, taskDraftSnapshot],
  );

  /**
   * 图片资源加载失败时自动重新生成一次当前目标帧。
   */
  const recoverImageLoadFailure = useCallback(() => {
    if (fallbackRenderKeyRef.current === desiredRenderKey) {
      setPreviewState("error");
      setPreviewError(imageLoadFailedText);
      return;
    }

    // 当前图片路径已失效时立即隐藏旧帧，避免继续展示错误资源。
    fallbackRenderKeyRef.current = desiredRenderKey;
    clearFrameSnapshot();
    // 自动恢复期间保留标记，防止新返回的无效路径再次触发无限请求。
    void requestFrame(desiredTimeMs, desiredRenderKey, false);
  }, [clearFrameSnapshot, desiredRenderKey, desiredTimeMs, imageLoadFailedText, requestFrame]);

  /**
   * 用户主动重试当前目标帧；每次操作都重新提交渲染请求。
   */
  const retryCurrentFrame = useCallback(() => {
    fallbackRenderKeyRef.current = null;
    clearFrameSnapshot();
    setPreviewError(undefined);
    void requestFrame(desiredTimeMs, desiredRenderKey);
  }, [clearFrameSnapshot, desiredRenderKey, desiredTimeMs, requestFrame]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setListenerSetupFailed(false);
      setListenersReady(true);
      return;
    }

    let disposed = false;
    let unlistenFrame: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;

    /**
     * 释放当前已经完成注册的预览事件监听器。
     */
    const disposeListeners = () => {
      unlistenFrame?.();
      unlistenState?.();
      unlistenFrame = undefined;
      unlistenState = undefined;
    };

    /**
     * 依次注册帧与状态事件，并在注册期间卸载时回收迟到的监听器。
     */
    const setup = async () => {
      try {
        const nextUnlistenFrame = await listen<PreviewFrameEvent>("preview:frame", (event) => {
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

        // StrictMode 清理可能早于异步注册完成，迟到的监听器必须立即释放。
        if (disposed) {
          nextUnlistenFrame();
          return;
        }
        unlistenFrame = nextUnlistenFrame;

        const nextUnlistenState = await listen<PreviewStateEvent>("preview:state", (event) => {
          const payload = event.payload;
          if (!sessionIdRef.current || payload.previewSessionId !== sessionIdRef.current) {
            return;
          }
          setPreviewState(payload.state);
          setPreviewSpeed(payload.previewSpeed);
          setEstimatedTranscodeSpeed(payload.estimatedTranscodeSpeed);
          setDegradedFromTwoPass(Boolean(payload.degradedFromTwoPass));
          setDegradedFromDolbyVision(Boolean(payload.degradedFromDolbyVision));
          setDegradedFromSdrTonemap(Boolean(payload.degradedFromSdrTonemap));
          setPreviewError(
            payload.error ? formatPreviewInvokeError(payload.error) : undefined,
          );
        });

        if (disposed) {
          nextUnlistenState();
          disposeListeners();
          return;
        }
        unlistenState = nextUnlistenState;
        setListenerSetupFailed(false);
        setListenersReady(true);
      } catch (err) {
        disposeListeners();
        if (disposed) {
          return;
        }

        setListenersReady(false);
        setPreviewState("error");
        setListenerSetupFailed(true);
        setPreviewError(formatPreviewInvokeError(err));
      }
    };

    void setup();

    return () => {
      disposed = true;
      disposeListeners();
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
      setDegradedFromTwoPass(false);
      setDegradedFromDolbyVision(false);
      setDegradedFromSdrTonemap(false);
      return;
    }
    if (!listenersReady) {
      return;
    }

    if (!isTauriRuntime()) {
      setPreviewState("running");
      setPreviewSpeed(1.6);
      setEstimatedTranscodeSpeed(0.72);
      setDegradedFromTwoPass(true);
      setDegradedFromDolbyVision(Boolean(taskDraftSnapshot.video.preserveDolbyVisionMetadata));
      setDegradedFromSdrTonemap(false);
      setPreviewError(undefined);
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
  }, [listenersReady, sourceFile, sourceColorContext]);

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
    previewState: !isTauriRuntime() && sourceFile ? "running" : previewState,
    previewSpeed: !isTauriRuntime() && sourceFile ? undefined : previewSpeed,
    estimatedTranscodeSpeed: !isTauriRuntime() && sourceFile ? undefined : estimatedTranscodeSpeed,
    previewError: !isTauriRuntime() && sourceFile ? undefined : previewError,
    listenerSetupFailed,
    degradedFromTwoPass:
      !isTauriRuntime() && sourceFile
        ? taskDraftSnapshot.video.enableTwoPass
        : degradedFromTwoPass,
    degradedFromDolbyVision:
      !isTauriRuntime() && sourceFile
        ? Boolean(taskDraftSnapshot.video.preserveDolbyVisionMetadata)
        : degradedFromDolbyVision,
    degradedFromSdrTonemap: !isTauriRuntime() && sourceFile ? false : degradedFromSdrTonemap,
    requestFrame,
    recoverImageLoadFailure,
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
  sourceFps,
  sourceHdrType,
  sourceColorPrimaries,
  sourceColorTransfer,
  sourceColorSpace,
  sourceColorRange,
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
  const previewTimelineMaxSec = getPreviewTimelineMaxSec(durationSec, sourceFps);
  const taskDraftSnapshotKey = useMemo(
    () => JSON.stringify(taskDraftSnapshot),
    [taskDraftSnapshot],
  );
  const sourceColorContext = useMemo<PreviewSourceColorContext>(
    () => ({
      sourceHdrType,
      sourceColorPrimaries,
      sourceColorTransfer,
      sourceColorSpace,
      sourceColorRange,
    }),
    [sourceColorPrimaries, sourceColorRange, sourceColorSpace, sourceColorTransfer, sourceHdrType],
  );

  const timeline = usePreviewTimeline({
    durationSec: previewTimelineMaxSec,
    initialTimeSec,
    initialFrame,
    onCommitTimeMs: (timeMs) => {
      const renderKey = buildPreviewRenderKey(
        sourceFile,
        timeMs,
        taskDraftSnapshotKey,
        PREVIEW_RENDER_SCALE,
        sourceColorContext,
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
        sourceColorContext,
      ),
    [sourceColorContext, sourceFile, taskDraftSnapshotKey, timeline.currentTimeMs],
  );

  const previewSession = usePreviewFrameSession({
    sourceFile,
    sourceColorContext,
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
  const previewErrorDisplay = previewSession.listenerSetupFailed && previewSession.previewError
    ? `${t("preview.error.listenerPrefix")}${previewSession.previewError}`
    : previewSession.previewError;
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
  const firstPaneClass = "left-3 top-3";
  const secondPaneClass =
    splitMode === "vertical" ? "right-14 top-3" : "left-3 bottom-28";
  const emptyFrameContent = previewSession.previewError ? (
    <div className="mx-auto max-w-md rounded-lg border border-red-300/25 bg-red-950/35 p-4 text-center text-red-100">
      <div className="text-sm font-medium">{t("preview.frameFailed")}</div>
      <div className="mt-2 text-xs leading-5 text-red-100/80">{getPreviewErrorSummary(previewSession.previewError, t)}</div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" variant="secondary" onClick={previewSession.retryCurrentFrame}>{t("preview.retryCurrentFrame")}</Button>
        <details className="text-left text-xs text-red-100/75">
          <summary className="cursor-pointer rounded px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            {t("preview.technicalDetails")}
          </summary>
          <pre className="mt-2 max-h-28 max-w-sm overflow-auto whitespace-pre-wrap break-all rounded bg-black/35 p-2 font-mono text-[10px] leading-4">
            {previewErrorDisplay}
          </pre>
        </details>
      </div>
    </div>
  ) : (
    <span>{t("preview.frameLoading")}</span>
  );

  const runtime = useMemo<ComparePreviewRuntime>(
    () => ({
      previewState: previewSession.previewState,
      previewSpeed: previewSession.previewSpeed,
      estimatedTranscodeSpeed: previewSession.estimatedTranscodeSpeed,
      previewError: previewErrorDisplay,
      degradedFromTwoPass: previewSession.degradedFromTwoPass,
      degradedFromDolbyVision: previewSession.degradedFromDolbyVision,
      degradedFromSdrTonemap: previewSession.degradedFromSdrTonemap,
      currentTimeSec: timeline.currentTimeSec,
      durationSec,
      isFullscreen: previewFullscreenActive,
      currentFrame: previewSession.currentFrame,
    }),
    [
      durationSec,
      previewFullscreenActive,
      previewSession.currentFrame,
      previewSession.degradedFromDolbyVision,
      previewSession.degradedFromSdrTonemap,
      previewSession.degradedFromTwoPass,
      previewSession.estimatedTranscodeSpeed,
      previewErrorDisplay,
      previewSession.previewSpeed,
      previewSession.previewState,
      timeline.currentTimeSec,
    ],
  );
  const fullscreenButtonLabel = fullscreenButtonIcon === "close"
    ? t("preview.detached.close")
    : previewFullscreenActive
      ? t("preview.fullscreen.exit")
      : t("preview.fullscreen.enter");

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
            : "rounded-lg border"
        }`}
        onDoubleClick={handleFullscreenButtonClick}
      >
        {sourceFile ? (
          <div className={`relative w-full bg-black ${previewFullscreenActive ? "h-full" : "aspect-video xl:aspect-[8/5]"}`}>
            {hasFrame ? (
              <>
                <img
                  src={previewSession.sourceImageSrc ?? ""}
                  alt={t("preview.frame.source")}
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                  onError={previewSession.recoverImageLoadFailure}
                />
                <img
                  src={previewSession.previewImageSrc ?? ""}
                  alt={t("preview.frame.preview")}
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                  style={{ clipPath }}
                  onError={previewSession.recoverImageLoadFailure}
                />
              </>
            ) : (
              <div className="grid h-full place-items-center px-6 text-sm text-white/70">{emptyFrameContent}</div>
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

        {hasFrame ? (
          <div
            role="separator"
            tabIndex={0}
            aria-label={t("preview.separatorLabel")}
            aria-orientation={splitMode === "vertical" ? "vertical" : "horizontal"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitterPosition * 100)}
            className={`absolute ${
              splitMode === "vertical"
                ? "inset-y-0 w-1 -translate-x-1/2 cursor-col-resize"
                : "inset-x-0 h-1 -translate-y-1/2 cursor-row-resize"
            } bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.4)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70`}
            style={
              splitMode === "vertical"
                ? { left: `${splitterPosition * 100}%` }
                : { top: `${splitterPosition * 100}%` }
            }
            onPointerDown={splitterDrag.beginSplitterDrag}
            onKeyDown={(event) => {
              const decrease = event.key === "ArrowLeft" || event.key === "ArrowUp";
              const increase = event.key === "ArrowRight" || event.key === "ArrowDown";
              if (!decrease && !increase) {
                return;
              }
              event.preventDefault();
              // 键盘每次移动 2%，兼顾精确控制和可达性。
              onSplitterPositionChange(Math.min(0.98, Math.max(0.02, splitterPosition + (increase ? 0.02 : -0.02))));
            }}
          />
        ) : null}

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
          className={`absolute right-3 top-3 z-20 transition ${
            !isOverlayVisible && previewFullscreenActive ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <Button
            size="sm"
            variant="secondary"
            aria-label={fullscreenButtonLabel}
            title={fullscreenButtonLabel}
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
          className={`absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/75 px-3 py-2.5 transition ${
            !isOverlayVisible && previewFullscreenActive ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center">
            <Slider
              min={0}
              max={previewTimelineMaxSec}
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
              aria-label={t("preview.timelineLabel")}
            />
            <div className="text-xs text-white/75">
              {timeline.currentTimeSec.toFixed(2)} / {durationSec.toFixed(2)}s
            </div>
            <Button
              size="sm"
              variant={splitMode === "vertical" ? "default" : "secondary"}
              aria-pressed={splitMode === "vertical"}
              onClick={() => onSplitModeChange("vertical")}
            >
              {t("preview.splitVertical")}
            </Button>
            <Button
              size="sm"
              variant={splitMode === "horizontal" ? "default" : "secondary"}
              aria-pressed={splitMode === "horizontal"}
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
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/75">
            {previewSession.previewSpeed ? <span>{t("preview.currentSpeed", { value: previewSession.previewSpeed.toFixed(2) })}</span> : null}
            {timeline.isScrubbingTimeline ? <span>{t("preview.scrubbing")}</span> : null}
            {previewSession.previewError ? <span className="text-red-200">{t("preview.error.hint")}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
