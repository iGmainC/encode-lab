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
 * @param unknownLabel 未识别类型的本地化标签
 */
export function formatHdrType(
  value?: VideoStreamMetadata["hdrType"],
  unknownLabel = "Unknown",
) {
  const labels: Record<NonNullable<VideoStreamMetadata["hdrType"]>, string> = {
    Sdr: "SDR",
    Hdr10: "HDR10",
    Hlg: "HLG",
    DolbyVision: "Dolby Vision",
    Unknown: unknownLabel,
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

/** 输出文件名预告；jobId 与冲突序号只能在真正入队时确定。 */
export type OutputFileNamePreview = {
  /** 与后端一致清理后的文件名主干。 */
  sanitizedStem: string;
  /** 包含动态后缀占位符的可展示文件名。 */
  displayName: string;
};

/** 默认动态后缀使用语言无关的技术占位符；界面可传入本地化文案。 */
const DEFAULT_DYNAMIC_SUFFIX_PLACEHOLDER = "<job-id:8>[-N]";

/**
 * 按后端 `sanitize_file_stem` 的规则清理输出文件名主干。
 * @param value 已展开变量的文件名主干
 * @returns 可安全用于预告的文件名主干
 */
export function sanitizeOutputFileStem(value: string) {
  const sanitized = Array.from(value)
    .map((character) => {
      const isControl = /\p{Cc}/u.test(character);
      if (!isControl && !/[\\/:*?"<>|]/u.test(character)) {
        return character;
      }

      // 与后端一致：控制字符和路径分隔符直接移除，其余高风险字符替换为下划线。
      return isControl || character === "/" || character === "\\" ? "" : "_";
    })
    .join("")
    .trim()
    .replace(/^\.+|\.+$/gu, "");

  return sanitized || "encode-lab-output";
}

/**
 * 根据当前草稿构造与后端命名规则一致的输出文件名预告。
 * @param inputFile 源文件路径
 * @param snapshot 当前任务快照
 * @param dynamicSuffixPlaceholder jobId 与冲突序号的展示占位符
 * @returns 清理后的主干和带动态后缀占位符的文件名
 */
export function buildOutputFileNamePreview(
  inputFile: string,
  snapshot: TaskDraftSnapshot,
  dynamicSuffixPlaceholder = DEFAULT_DYNAMIC_SUFFIX_PLACEHOLDER,
): OutputFileNamePreview {
  const inputName = inputFile.split(/[\\/]/).filter(Boolean).pop() || "input";
  const lastDotIndex = inputName.lastIndexOf(".");
  // 点文件没有扩展名；普通文件仅去掉最后一段扩展名，与后端 Path::file_stem 对齐。
  const inputStem = lastDotIndex > 0 ? inputName.slice(0, lastDotIndex) : inputName;
  const renderedPattern = snapshot.output.fileNamePattern
    .split("{inputName}").join(inputStem || "input")
    .split("{taskName}").join(snapshot.name || "task");
  const sanitizedStem = sanitizeOutputFileStem(renderedPattern);

  return {
    sanitizedStem,
    displayName: `${sanitizedStem}-${dynamicSuffixPlaceholder}.${snapshot.container.format}`,
  };
}

/**
 * 返回源文件所在目录；无法解析时返回空字符串。
 * @param path 本机文件路径
 */
export function getParentDirectory(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : "";
}
