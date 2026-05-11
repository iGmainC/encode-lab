import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import {
  DETACHED_PREVIEW_UPDATE_EVENT,
  readDetachedPreviewPayload,
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
  const [payload, setPayload] = useState<DetachedPreviewPayload | null>(() => readDetachedPreviewPayload());
  const [splitMode, setSplitMode] = useState<"vertical" | "horizontal">(
    () => payload?.splitMode ?? "vertical",
  );
  const [splitterPosition, setSplitterPosition] = useState(() => payload?.splitterPosition ?? 0.5);
  const [compareOrder, setCompareOrder] = useState<CompareImageOrder>(
    () => payload?.compareOrder ?? "source-first",
  );
  const [, setRuntime] = useState<ComparePreviewRuntime>(emptyRuntime);

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
    const currentWindow = getCurrentWebviewWindow();
    let isLockingWindow = false;

    /**
     * 串行恢复窗口约束，避免 resize 事件连续触发时重复调用系统窗口 API。
     */
    const enforceWindowLock = async () => {
      if (isLockingWindow) {
        return;
      }

      isLockingWindow = true;
      await lockCurrentPreviewWindow(currentWindow);
      isLockingWindow = false;
    };

    // 独立窗口创建后主动锁定系统全屏；失败时仍保持独立窗口展示。
    void enforceWindowLock();

    let unlistenPayload: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    const setupListener = async () => {
      unlistenPayload = await currentWindow.listen<DetachedPreviewPayload>(
        DETACHED_PREVIEW_UPDATE_EVENT,
        (event) => {
          setPayload(event.payload);
        },
      );
      unlistenResize = await currentWindow.onResized(() => {
        // 用户或系统改变窗口尺寸后，立即恢复为锁定的系统全屏窗口。
        void enforceWindowLock();
      });
    };

    void setupListener();

    return () => {
      if (unlistenPayload) {
        unlistenPayload();
      }
      if (unlistenResize) {
        unlistenResize();
      }
    };
  }, []);

  /**
   * 关闭独立预览窗口。
   */
  const closeDetachedWindow = async () => {
    await getCurrentWebviewWindow().close().catch(() => {});
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
