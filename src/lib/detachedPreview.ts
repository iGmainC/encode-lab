import type {
  CompareImageOrder,
  ComparePreviewFrameSnapshot,
  TaskDraftSnapshot,
  VideoStreamMetadata,
} from "../types/workbench";

/** 独立预览窗口读取的本地快照 key。 */
export const DETACHED_PREVIEW_STORAGE_KEY = "encode-lab:detached-preview";

/** 独立预览窗口同步事件名。 */
export const DETACHED_PREVIEW_UPDATE_EVENT = "preview-detached:update";

/** 独立预览窗口启动所需的最小预览快照。 */
export type DetachedPreviewPayload = {
  /** 源视频绝对路径 */
  sourceFile: string;
  /** 源视频时长，单位秒 */
  sourceDurationSec?: number;
  /** 源视频帧率；用于让独立窗口按真实帧数预留片尾安全区。 */
  sourceFps?: number;
  /** 源视频 HDR 类型；独立窗口重建预览 session 时继续保持 SDR 映射策略。 */
  sourceHdrType?: VideoStreamMetadata["hdrType"];
  /** 源视频色彩原色；独立窗口重建普通 HDR fallback 映射时继续固定 zscale 输入端。 */
  sourceColorPrimaries?: VideoStreamMetadata["colorPrimaries"];
  /** 源视频传递函数；独立窗口重建普通 HDR fallback 映射时继续固定 zscale 输入端。 */
  sourceColorTransfer?: VideoStreamMetadata["colorTransfer"];
  /** 源视频色彩矩阵；独立窗口重建普通 HDR fallback 映射时继续固定 zscale 输入端。 */
  sourceColorSpace?: VideoStreamMetadata["colorSpace"];
  /** 源视频色彩范围；独立窗口重建普通 HDR fallback 映射时继续固定 zscale 输入端。 */
  sourceColorRange?: VideoStreamMetadata["colorRange"];
  /** 当前任务参数快照 */
  taskDraftSnapshot: TaskDraftSnapshot;
  /** 分割线方向 */
  splitMode: "vertical" | "horizontal";
  /** 分割线位置，取值 0-1 */
  splitterPosition: number;
  /** 图层显示顺序 */
  compareOrder?: CompareImageOrder;
  /** 当前预览时间点，单位秒 */
  currentTimeSec?: number;
  /** 主窗口已生成的当前帧，用于独立窗口首屏复用 */
  currentFrame?: ComparePreviewFrameSnapshot;
  /** 快照更新时间，用于排查窗口同步问题 */
  updatedAt: number;
};

/**
 * 构造独立预览窗口快照，并在单一边界写入更新时间。
 * @param payload 除更新时间外的完整预览上下文
 * @param now 提供当前时间，测试时可注入稳定值
 */
export function buildDetachedPreviewPayload(
  payload: Omit<DetachedPreviewPayload, "updatedAt">,
  now: () => number = Date.now,
): DetachedPreviewPayload {
  return {
    ...payload,
    updatedAt: now(),
  };
}

/**
 * 写入独立预览窗口启动快照。
 * @param payload 当前主窗口预览参数
 */
export function writeDetachedPreviewPayload(payload: DetachedPreviewPayload) {
  localStorage.setItem(DETACHED_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * 读取独立预览窗口启动快照。
 * @returns 预览快照；不存在或解析失败时返回 null
 */
export function readDetachedPreviewPayload(): DetachedPreviewPayload | null {
  const raw = localStorage.getItem(DETACHED_PREVIEW_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DetachedPreviewPayload;
  } catch {
    return null;
  }
}
