import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { formatReleaseVersion, isNewerReleaseVersion } from "./version";

/** Tauri 在远端 updater manifest 缺失或不是 JSON 时返回的固定错误片段。 */
const INVALID_RELEASE_JSON_ERROR = "Could not fetch a valid release JSON from the remote";

export type UpdateCheckResult =
  | {
      /** 是否发现可安装更新。 */
      available: false;
      /** 当前应用版本。 */
      currentVersion: string;
    }
  | {
      /** 是否发现可安装更新。 */
      available: true;
      /** 当前应用版本。 */
      currentVersion: string;
      /** 新版本号。 */
      version: string;
      /** GitHub Release 正文。 */
      body?: string;
      /** Tauri updater 资源句柄。 */
      update: Update;
    };

export type UpdateInstallProgress = {
  /** 已下载字节数。 */
  downloadedBytes: number;
  /** 总字节数；服务端未返回时为空。 */
  contentLength?: number;
};

/**
 * 检查 GitHub Release updater 是否存在新版本。
 * @returns 更新检查结果
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getVersion();
  let update: Update | null;

  try {
    update = await check();
  } catch (error) {
    // 远端 latest.json 缺失时，插件只能给出通用解析错误；这里补充发布产物根因提示。
    if (error instanceof Error && error.message.includes(INVALID_RELEASE_JSON_ERROR)) {
      throw new Error("GitHub Release 缺少有效的 latest.json 更新清单，请检查发布流水线是否生成并上传签名 updater 产物。");
    }

    throw error;
  }

  if (!update || !isNewerReleaseVersion(update.version, currentVersion)) {
    update?.close();
    return {
      available: false,
      currentVersion: formatReleaseVersion(currentVersion),
    };
  }

  return {
    available: true,
    currentVersion: formatReleaseVersion(currentVersion),
    version: formatReleaseVersion(update.version),
    body: update.body,
    update,
  };
}

/**
 * 下载并安装更新，安装完成后重启应用。
 * @param update Tauri updater 返回的更新句柄
 * @param onProgress 下载进度回调
 */
export async function installAppUpdate(
  update: Update,
  onProgress: (progress: UpdateInstallProgress) => void,
) {
  let downloadedBytes = 0;
  let contentLength: number | undefined;

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloadedBytes = 0;
      contentLength = event.data.contentLength;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    }

    // Finished 事件保留最后一次下载进度，避免安装阶段进度回退。
    onProgress({ downloadedBytes, contentLength });
  });

  await relaunch();
}
