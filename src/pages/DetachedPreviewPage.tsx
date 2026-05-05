import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import {
  DETACHED_PREVIEW_UPDATE_EVENT,
  readDetachedPreviewPayload,
  type DetachedPreviewPayload,
} from "../lib/detachedPreview";
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
 * 独立系统全屏预览页。
 * @returns 仅包含按帧对比组件的窗口级预览界面
 */
export function DetachedPreviewPage() {
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

    // 独立窗口创建后主动请求系统全屏；失败时仍保持独立窗口展示。
    void currentWindow.setFullscreen(true).catch(() => {});

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await currentWindow.listen<DetachedPreviewPayload>(
        DETACHED_PREVIEW_UPDATE_EVENT,
        (event) => {
          setPayload(event.payload);
        },
      );
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
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
        请先在主窗口选择源视频，再打开独立预览窗口。
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
