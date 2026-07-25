import { invoke } from "@tauri-apps/api/core";
import type {
  CompareImageOrder,
  ComparePreviewFrameSnapshot,
  TaskDraftSnapshot,
  VideoStreamMetadata,
} from "../types/workbench";

/** 独立预览窗口同步事件名。 */
export const DETACHED_PREVIEW_UPDATE_EVENT = "preview-detached:update";

let lastDetachedPreviewUpdatedAt = 0; // 主窗口内的单调快照序号，避免同毫秒更新无法排序。

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
  /** 独立窗口正在持有的临时帧副本 id */
  framePinId?: string;
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
  const updatedAt = Math.max(now(), lastDetachedPreviewUpdatedAt + 1);
  lastDetachedPreviewUpdatedAt = updatedAt;
  return {
    ...payload,
    updatedAt,
  };
}

/**
 * 将独立预览窗口启动快照写入 Rust 进程内邮箱。
 * @param payload 当前主窗口预览参数
 */
export async function writeDetachedPreviewPayload(payload: DetachedPreviewPayload) {
  // Rust 邮箱只保管原始字符串，避免 JSON 对象键重排后改变预览 render key。
  await invoke("set_detached_preview_payload", { payload: JSON.stringify(payload) });
}

/**
 * 从 Rust 进程内邮箱读取独立预览窗口启动快照。
 * @returns 预览快照；不存在时返回 null
 */
export async function readDetachedPreviewPayload(): Promise<DetachedPreviewPayload | null> {
  const payload = await invoke<string | null>("get_detached_preview_payload");
  return payload ? (JSON.parse(payload) as DetachedPreviewPayload) : null;
}

/** 清空独立预览窗口的进程内启动快照。 */
export async function clearDetachedPreviewPayload() {
  await invoke("clear_detached_preview_payload").catch(() => {});
}

/**
 * 按更新时间合并快照，避免异步首次读取覆盖已到达的窗口事件。
 * @param current 当前窗口快照
 * @param incoming 新读取或事件到达的快照
 * @returns 时间更新的快照
 */
export function selectLatestDetachedPreviewPayload(
  current: DetachedPreviewPayload | null,
  incoming: DetachedPreviewPayload,
): DetachedPreviewPayload {
  return current && current.updatedAt >= incoming.updatedAt ? current : incoming;
}

/** 快照选择结果；被拒绝的新快照需要归还其独占 pin。 */
export type DetachedPreviewPayloadSelection = {
  /** 最终应展示的快照 */
  payload: DetachedPreviewPayload;
  /** 因乱序被拒绝、且不再被任何窗口持有的 pin */
  rejectedFramePinId?: string;
};

/**
 * 选择最新快照，并显式返回乱序快照需要释放的 pin。
 * @param current 当前窗口快照
 * @param incoming 新读取或事件到达的快照
 * @returns 选中的快照和可安全释放的旧事件 pin
 */
export function resolveDetachedPreviewPayload(
  current: DetachedPreviewPayload | null,
  incoming: DetachedPreviewPayload,
): DetachedPreviewPayloadSelection {
  const payload = selectLatestDetachedPreviewPayload(current, incoming);
  const rejectedFramePinId = payload === current
    && incoming.framePinId !== current?.framePinId
    ? incoming.framePinId
    : undefined;
  return { payload, rejectedFramePinId };
}

/** 后端固定预览帧后返回的受控副本。 */
type PinPreviewFrameResponse = {
  /** 临时帧副本 id */
  framePinId: string;
  /** 固定后的源图路径 */
  sourceImagePath: string;
  /** 固定后的预览图路径 */
  previewImagePath: string;
};

/**
 * 为独立窗口固定当前帧，使主 session 可以独立回收历史 PNG。
 * @param frame 主窗口当前预览帧
 * @returns 固定帧和 pin id；无当前帧时两者均为 undefined
 */
export async function pinDetachedPreviewFrame(frame?: ComparePreviewFrameSnapshot): Promise<{
  currentFrame?: ComparePreviewFrameSnapshot;
  framePinId?: string;
}> {
  if (!frame) {
    return {};
  }

  const pinned = await invoke<PinPreviewFrameResponse>("pin_preview_frame", {
    sourceImagePath: frame.sourceImagePath,
    previewImagePath: frame.previewImagePath,
  });
  return {
    framePinId: pinned.framePinId,
    currentFrame: {
      ...frame,
      sourceImagePath: pinned.sourceImagePath,
      previewImagePath: pinned.previewImagePath,
    },
  };
}

/**
 * 释放独立窗口不再使用的临时帧副本。
 * @param framePinId 待释放的 pin id
 */
export async function releaseDetachedPreviewFrame(framePinId?: string) {
  if (!framePinId) {
    return;
  }
  await invoke("release_preview_frame", { framePinId }).catch(() => {});
}
