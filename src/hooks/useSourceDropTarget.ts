import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/tauriRuntime";

/** 当前桌面端允许直接拖入的常见视频扩展名。 */
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "m4v", "webm", "flv", "ts"]);

/**
 * 只在挂载当前 Hook 的工作台页面接收 Tauri 文件拖放。
 * @param onSourceFile 接收通过校验的首个视频路径
 * @returns 拖放高亮和用户可读提示
 */
export function useSourceDropTarget(onSourceFile: (path: string) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);

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
          setDropNotice("未找到支持的视频文件，请选择 MP4、MOV、MKV 等常见格式。");
          return;
        }

        // 当前任务仍是单素材语义，明确告知多文件时只接收首个视频。
        onSourceFile(videoPaths[0]);
        setDropNotice(
          videoPaths.length > 1
            ? `已导入 ${getPathName(videoPaths[0])}，其余 ${videoPaths.length - 1} 个视频未加入当前任务。`
            : null,
        );
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        if (!disposed) {
          setDropNotice("桌面拖放监听启动失败，仍可使用“选择源素材”。");
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onSourceFile]);

  return { isDragOver, dropNotice, clearDropNotice: () => setDropNotice(null) };
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
