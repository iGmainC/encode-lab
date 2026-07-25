import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import {
  clearDetachedPreviewPayload,
  DETACHED_PREVIEW_UPDATE_EVENT,
  readDetachedPreviewPayload,
  releaseDetachedPreviewFrame,
  resolveDetachedPreviewPayload,
  type DetachedPreviewPayload,
} from "../lib/detachedPreview";
import { useI18n } from "../i18n/I18nProvider";
import type { CompareImageOrder, ComparePreviewRuntime } from "../types/workbench";

/** 独立预览窗口的默认运行态，用于接收预览组件回传状态。 */
const emptyRuntime: ComparePreviewRuntime = {
  previewState: "idle",
  previewSpeed: undefined,
  estimatedTranscodeSpeed: undefined,
  previewError: undefined,
  degradedFromTwoPass: false,
  degradedFromDolbyVision: false,
  degradedFromSdrTonemap: false,
  currentTimeSec: 0,
  durationSec: 0,
  isFullscreen: true,
};

/**
 * 独立窗口内兜底锁定系统全屏状态。
 * @param currentWindow 当前 Tauri Webview 窗口
 */
async function lockCurrentPreviewWindow(currentWindow: ReturnType<typeof getCurrentWebviewWindow>) {
  // 先禁用系统缩放按钮，再禁用调整尺寸，保证 macOS 标题栏按钮状态同步。
  await currentWindow.setMaximizable(false).catch(() => {});
  await currentWindow.setMinimizable(false).catch(() => {});
  await currentWindow.setResizable(false).catch(() => {});
  await currentWindow.setFullscreen(true).catch(() => {});
}

/**
 * 独立系统全屏预览页。
 * @returns 仅包含按帧对比组件的窗口级预览界面
 */
export function DetachedPreviewPage() {
  const { t } = useI18n();
  const [payload, setPayload] = useState<DetachedPreviewPayload | null>(null);
  const payloadRef = useRef<DetachedPreviewPayload | null>(null);
  const activeFramePinIdRef = useRef<string | undefined>(undefined);
  const pendingFramePinIdsRef = useRef(new Set<string>());
  const isClosingWindowRef = useRef(false);
  const [splitMode, setSplitMode] = useState<"vertical" | "horizontal">(
    () => payload?.splitMode ?? "vertical",
  );
  const [splitterPosition, setSplitterPosition] = useState(() => payload?.splitterPosition ?? 0.5);
  const [compareOrder, setCompareOrder] = useState<CompareImageOrder>(
    () => payload?.compareOrder ?? "source-first",
  );
  const [, setRuntime] = useState<ComparePreviewRuntime>(emptyRuntime);

  /**
   * 合并异步邮箱和窗口事件，并立即释放被乱序规则拒绝的帧 pin。
   * @param incoming 新读取或事件到达的快照
   */
  const applyDetachedPreviewPayload = useCallback((incoming: DetachedPreviewPayload) => {
    if (isClosingWindowRef.current) {
      // 关窗期间迟到的邮箱读取或窗口事件不能重新取得资源所有权。
      void releaseDetachedPreviewFrame(incoming.framePinId);
      return;
    }
    const current = payloadRef.current;
    const selection = resolveDetachedPreviewPayload(current, incoming);
    if (selection.rejectedFramePinId) {
      // 被拒绝的事件不会进入 React 提交阶段，必须在这里直接归还独占副本。
      void releaseDetachedPreviewFrame(selection.rejectedFramePinId);
    }
    if (selection.payload === current) {
      return;
    }

    payloadRef.current = selection.payload;
    if (selection.payload.framePinId) {
      // React 可能合并连续 setState；先登记 pin，提交后统一判断哪些快照从未真正展示。
      pendingFramePinIdsRef.current.add(selection.payload.framePinId);
    }
    setPayload(selection.payload);
  }, []);

  /**
   * 释放已提交帧和尚未进入 effect 的最新帧，覆盖关窗与 React 提交之间的竞态。
   */
  const releaseWindowFramePins = useCallback(async () => {
    const framePinIds = new Set(
      [
        activeFramePinIdRef.current,
        payloadRef.current?.framePinId,
        ...pendingFramePinIdsRef.current,
      ].filter(
        (framePinId): framePinId is string => Boolean(framePinId),
      ),
    );
    activeFramePinIdRef.current = undefined;
    pendingFramePinIdsRef.current.clear();
    payloadRef.current = null;
    await Promise.all([...framePinIds].map((framePinId) => releaseDetachedPreviewFrame(framePinId)));
  }, []);

  useEffect(() => {
    let disposed = false;
    void readDetachedPreviewPayload()
      .then((initialPayload) => {
        if (!disposed && initialPayload) {
          applyDetachedPreviewPayload(initialPayload);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [applyDetachedPreviewPayload]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    // 主窗口同步新快照时，也同步外部控制区记住的分割线状态。
    setSplitMode(payload.splitMode);
    setSplitterPosition(payload.splitterPosition);
    setCompareOrder(payload.compareOrder ?? "source-first");
  }, [payload]);

  useEffect(() => {
    const previousFramePinId = activeFramePinIdRef.current;
    activeFramePinIdRef.current = payload?.framePinId;
    const releasableFramePinIds = new Set(pendingFramePinIdsRef.current);
    pendingFramePinIdsRef.current.clear();
    if (payload?.framePinId) {
      // 当前提交真正使用的 pin 必须继续保留，其他 pending pin 均为 React 合并掉的快照。
      releasableFramePinIds.delete(payload.framePinId);
    }
    if (previousFramePinId && previousFramePinId !== payload?.framePinId) {
      releasableFramePinIds.add(previousFramePinId);
    }
    for (const framePinId of releasableFramePinIds) {
      // 新快照已完成 React 提交，此时才能释放上一对图片和未展示的中间快照。
      void releaseDetachedPreviewFrame(framePinId);
    }
  }, [payload?.framePinId]);

  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    let isLockingWindow = false;

    /**
     * 串行恢复窗口约束，避免 resize 事件连续触发时重复调用系统窗口 API。
     */
    const enforceWindowLock = async () => {
      if (isLockingWindow || isClosingWindowRef.current) {
        return;
      }

      isLockingWindow = true;
      await lockCurrentPreviewWindow(currentWindow);
      isLockingWindow = false;
    };

    // 独立窗口创建后主动锁定系统全屏；失败时仍保持独立窗口展示。
    void enforceWindowLock();

    let disposed = false;
    let unlistenPayload: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    const setupListener = async () => {
      const disposePayload = await currentWindow.listen<DetachedPreviewPayload>(
        DETACHED_PREVIEW_UPDATE_EVENT,
        (event) => {
          applyDetachedPreviewPayload(event.payload);
        },
      );
      if (disposed) {
        disposePayload();
        return;
      }
      unlistenPayload = disposePayload;

      const disposeResize = await currentWindow.onResized(() => {
        // 用户或系统改变窗口尺寸后，立即恢复为锁定的系统全屏窗口。
        void enforceWindowLock();
      });
      if (disposed) disposeResize();
      else unlistenResize = disposeResize;

      const disposeClose = await currentWindow.onCloseRequested(() => {
        // 关窗会先退出系统全屏并触发 resize；必须停止全屏恢复，避免抵消关闭过程。
        isClosingWindowRef.current = true;
        void releaseWindowFramePins();
        void clearDetachedPreviewPayload();
      });
      if (disposed) disposeClose();
      else unlistenClose = disposeClose;
    };

    void setupListener().catch(() => {
      // 监听失败不影响当前帧展示；下一次打开独立窗口会重新初始化。
    });

    return () => {
      disposed = true;
      unlistenPayload?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [applyDetachedPreviewPayload, releaseWindowFramePins]);

  /**
   * 关闭独立预览窗口。
   */
  const closeDetachedWindow = async () => {
    isClosingWindowRef.current = true;
    await releaseWindowFramePins();
    await clearDetachedPreviewPayload();
    // 通过 Rust 主进程关窗，避免 WebView 核心窗口权限在动态窗口中静默拒绝。
    await invoke("close_detached_preview_window").catch(() => {});
  };

  if (!payload?.sourceFile) {
    return (
      <div className="grid h-screen place-items-center bg-black px-6 text-center text-sm text-white/70">
        {t("preview.detached.noSource")}
      </div>
    );
  }

  return (
    <ComparePreviewPlayer
      sourceFile={payload.sourceFile}
      sourceDurationSec={payload.sourceDurationSec}
      sourceFps={payload.sourceFps}
      sourceHdrType={payload.sourceHdrType}
      sourceColorPrimaries={payload.sourceColorPrimaries}
      sourceColorTransfer={payload.sourceColorTransfer}
      sourceColorSpace={payload.sourceColorSpace}
      sourceColorRange={payload.sourceColorRange}
      taskDraftSnapshot={payload.taskDraftSnapshot}
      splitMode={splitMode}
      splitterPosition={splitterPosition}
      compareOrder={compareOrder}
      initialTimeSec={payload.currentTimeSec}
      initialFrame={payload.currentFrame}
      onSplitModeChange={setSplitMode}
      onSplitterPositionChange={setSplitterPosition}
      onCompareOrderChange={setCompareOrder}
      onRuntimeChange={setRuntime}
      fillViewport
      deferSessionUntilInteraction={Boolean(payload.currentFrame)}
      onFullscreenButtonClick={() => void closeDetachedWindow()}
      fullscreenButtonIcon="close"
    />
  );
}
