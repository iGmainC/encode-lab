import type {
  CompareImageOrder,
  ComparePreviewFrameSnapshot,
  TaskDraftSnapshot,
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
