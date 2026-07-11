import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/translations";

/** 当前桌面端允许直接拖入的常见视频扩展名。 */
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "m4v", "webm", "flv", "ts"]);

/** 拖放提示保存稳定翻译键，避免切换语言时重建原生窗口监听。 */
type DropNoticeState = {
  key: TranslationKey;
  params?: Record<string, string | number>;
};

/**
 * 只在挂载当前 Hook 的工作台页面接收 Tauri 文件拖放。
 * @param onSourceFile 接收通过校验的首个视频路径
 * @returns 拖放高亮和用户可读提示
 */
export function useSourceDropTarget(onSourceFile: (path: string) => void) {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropNoticeState, setDropNoticeState] = useState<DropNoticeState | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOver(true);
          return;
        }

        if (event.payload.type === "leave") {
          setIsDragOver(false);
          return;
        }

        setIsDragOver(false);
        const paths = event.payload.paths ?? [];
        const videoPaths = paths.filter(isSupportedVideoPath);
        if (videoPaths.length === 0) {
          setDropNoticeState({ key: "workbench.drop.unsupported" });
          return;
        }

        // 当前任务仍是单素材语义，明确告知多文件时只接收首个视频。
        onSourceFile(videoPaths[0]);
        setDropNoticeState(
          videoPaths.length > 1
            ? {
              key: "workbench.drop.multiple",
              params: {
                name: getPathName(videoPaths[0]),
                count: videoPaths.length - 1,
              },
            }
            : null,
        );
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        if (!disposed) {
          setDropNoticeState({ key: "workbench.drop.listenerFailed" });
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onSourceFile]);

  const dropNotice = dropNoticeState
    ? t(dropNoticeState.key, dropNoticeState.params)
    : null;

  return { isDragOver, dropNotice, clearDropNotice: () => setDropNoticeState(null) };
}

/**
 * 判断拖入路径是否为当前支持的视频格式。
 * @param path 本机文件路径
 */
function isSupportedVideoPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(extension);
}

/**
 * 从跨平台路径中提取文件名。
 * @param path 本机文件路径
 */
function getPathName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
