import type { TaskDraftSnapshot, VideoStreamMetadata } from "../types/workbench";

/**
 * 格式化帧率并移除无意义的尾随零。
 * @param value 帧率数值
 */
export function formatFps(value?: number | null) {
  return typeof value === "number" ? value.toFixed(3).replace(/\.?0+$/, "") : "-";
}

/**
 * 将秒数格式化为紧凑时长。
 * @param value 时长，单位秒
 */
export function formatDuration(value?: number | null) {
  if (typeof value !== "number" || value <= 0) {
    return "-";
  }
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

/**
 * 将字节数格式化为可读容量。
 * @param value 文件大小，单位字节
 */
export function formatBytes(value?: number | null) {
  if (typeof value !== "number" || value <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * 将后端 HDR 枚举翻译为界面标签。
 * @param value HDR 类型
 */
export function formatHdrType(value?: VideoStreamMetadata["hdrType"]) {
  const labels: Record<NonNullable<VideoStreamMetadata["hdrType"]>, string> = {
    Sdr: "SDR",
    Hdr10: "HDR10",
    Hlg: "HLG",
    DolbyVision: "Dolby Vision",
    Unknown: "未知",
  };
  return value ? labels[value] : "-";
}

/**
 * 从跨平台路径中提取文件名。
 * @param path 本机文件路径
 */
export function getPathName(path?: string | null) {
  if (!path) {
    return "-";
  }
  return path.split(/[\\/]/).pop() || path;
}

/**
 * 根据当前草稿构造预告输出文件名。
 * @param inputFile 源文件路径
 * @param snapshot 当前任务快照
 */
export function buildOutputFileName(inputFile: string, snapshot: TaskDraftSnapshot) {
  const inputName = getPathName(inputFile);
  const baseName = inputName.replace(/\.[^.]+$/, "") || "output";
  const renderedPattern = snapshot.output.fileNamePattern
    .split("{inputName}").join(baseName)
    .split("{taskName}").join(snapshot.name || "task");
  return `${renderedPattern}.${snapshot.container.format}`;
}

/**
 * 返回源文件所在目录；无法解析时返回空字符串。
 * @param path 本机文件路径
 */
export function getParentDirectory(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : "";
}
