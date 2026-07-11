import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** 默认专用 runtime 版本，对应 encode-lab-ffmpeg 仓库的 release tag。 */
const DEFAULT_RUNTIME_VERSION = "8.1.1-rpu.6";

/** GitHub Release 下载根地址；测试或镜像环境可通过环境变量覆盖。 */
const DEFAULT_RELEASE_BASE_URL = "https://github.com/iGmainC/encode-lab-ffmpeg/releases/download";

/** 默认 Release 资产摘要；构建不能在未校验来源的情况下解包并签名可执行文件。 */
const DEFAULT_ARCHIVE_SHA256: Record<string, string> = {
  "darwin-arm64": "2922303dfbce238e376f594d638259041f008f6e768d79478fbf85dd7c437f03",
  "linux-x64": "7b8775660b3cae6f58b8b271379ec51d9a9816f543d35ba29cda6d4f529f7cf1",
};

/** runtime 文件落点；Tauri 会把这个目录作为 resources 一起打包。 */
const RUNTIME_ROOT = join(import.meta.dir, "..", "src-tauri", "ffmpeg-runtime");

/** Cargo 开发/发布构建复制 runtime 资源的常见缓存目录。 */
const TAURI_TARGET_ROOT = join(import.meta.dir, "..", "src-tauri", "target");

/**
 * 获取当前构建平台对应的 runtime target。
 * @returns encode-lab-ffmpeg release artifact 使用的平台名
 */
function resolveRuntimeTarget(): string {
  if (process.env.ENCODE_LAB_FFMPEG_TARGET) {
    return process.env.ENCODE_LAB_FFMPEG_TARGET;
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }

  throw new Error(
    `当前平台暂未提供 Encode Lab FFmpeg runtime: ${process.platform}-${process.arch}`,
  );
}

/**
 * 判断目标 runtime 是否已经具备必需二进制。
 * @param target runtime target 名称
 * @returns 已存在且不需要重新下载时返回 true
 */
function runtimeDirectoryMatches(targetDir: string, target: string, version: string): boolean {
  const executableSuffix = target.startsWith("windows-") ? ".exe" : "";
  const binDir = join(targetDir, "bin");
  const manifestPath = join(targetDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    return false;
  }

  let manifest: { runtimeVersion?: string; target?: string };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return false;
  }

  return (
    manifest.runtimeVersion === version &&
    manifest.target === target &&
    existsSync(join(binDir, `ffmpeg${executableSuffix}`)) &&
    existsSync(join(binDir, `ffprobe${executableSuffix}`)) &&
    existsSync(join(binDir, `x265${executableSuffix}`)) &&
    existsSync(join(binDir, `dovi_tool${executableSuffix}`))
  );
}

/** 判断当前安装目录是否确实是请求的 runtime 版本。 */
function runtimeExists(target: string, version: string): boolean {
  return runtimeDirectoryMatches(join(RUNTIME_ROOT, target), target, version);
}

/** 解析当前资产的可信摘要；自定义版本必须显式提供摘要。 */
function resolveArchiveSha256(target: string, version: string): string {
  const override = process.env.ENCODE_LAB_FFMPEG_SHA256?.trim().toLowerCase();
  if (override) {
    return override;
  }

  if (version === DEFAULT_RUNTIME_VERSION && DEFAULT_ARCHIVE_SHA256[target]) {
    return DEFAULT_ARCHIVE_SHA256[target];
  }

  throw new Error(
    `runtime ${version}/${target} 缺少可信 SHA-256；请设置 ENCODE_LAB_FFMPEG_SHA256`,
  );
}

/**
 * 下载 GitHub Release asset。
 * @param url asset 下载地址
 * @param outputPath 本地输出文件
 */
async function downloadAsset(
  url: string,
  outputPath: string,
  expectedSha256: string,
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "encode-lab-runtime-preparer",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`下载 FFmpeg runtime 失败: ${response.status} ${response.statusText}`);
  }

  // 下载完成后先核对固定摘要，错误资产绝不能进入解包和签名阶段。
  const bytes = await response.arrayBuffer();
  const actualSha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `FFmpeg runtime SHA-256 不匹配: expected=${expectedSha256}, actual=${actualSha256}`,
    );
  }
  await Bun.write(outputPath, bytes);
}

/**
 * 运行系统命令并在失败时抛出明确错误。
 * @param command 命令名
 * @param args 参数数组
 */
async function run(command: string, args: string[]): Promise<void> {
  const process = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`);
  }
}

/**
 * 恢复 runtime 文件的 owner 写权限。
 * Tauri 增量构建会覆盖 target 中的资源；上游只读二进制会导致后续构建无法替换旧副本。
 * @param targetDir 当前平台 runtime 目录
 */
async function normalizeRuntimePermissions(targetDir: string): Promise<void> {
  if (!existsSync(targetDir)) {
    return;
  }

  await run("chmod", ["-R", "u+w", targetDir]);
}

/** 修复旧构建缓存中继承的只读权限，避免 Tauri 无法覆盖同名资源。 */
async function normalizeCachedRuntimePermissions(): Promise<void> {
  for (const profile of ["debug", "release"]) {
    await normalizeRuntimePermissions(join(TAURI_TARGET_ROOT, profile, "ffmpeg-runtime"));
  }
}

/**
 * 对 macOS runtime 做 ad-hoc 签名。
 * Homebrew 依赖库在重新打包后可能带失效签名，arm64 macOS 会直接 kill 子进程。
 * @param targetDir 已解压的 runtime 目录
 */
async function signDarwinRuntime(targetDir: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const libDir = join(targetDir, "lib");
  if (existsSync(libDir)) {
    const libFiles = await readdir(libDir);
    for (const file of libFiles.filter((name) => name.endsWith(".dylib")).sort()) {
      const libraryPath = join(libDir, file);
      // 上游 MoltenVK 可能以只读权限发布，重签名前先恢复 owner 写权限。
      await run("chmod", ["u+w", libraryPath]);
      await run("codesign", ["--force", "--sign", "-", libraryPath]);
    }
  }

  const binDir = join(targetDir, "bin");
  if (existsSync(binDir)) {
    const binFiles = await readdir(binDir);
    for (const file of binFiles.sort()) {
      // 依赖库先签，再签可执行文件，避免可执行文件引用的代码签名状态不一致。
      await run("codesign", ["--force", "--sign", "-", join(binDir, file)]);
    }
  }
}

/** 恢复上次替换在进程异常退出后可能留下的备份目录。 */
async function recoverRuntimeBackup(targetDir: string): Promise<void> {
  const backupDir = `${targetDir}.backup`;
  if (!existsSync(backupDir)) {
    return;
  }

  if (!existsSync(targetDir)) {
    // 旧目录已移走但新目录尚未就位时，优先恢复最后一份可用 runtime。
    await rename(backupDir, targetDir);
    return;
  }

  await rm(backupDir, { force: true, recursive: true });
}

/** 用已验证的临时目录替换现有 runtime；新目录就位失败时恢复旧目录。 */
async function replaceRuntimeDirectory(stagedDir: string, targetDir: string): Promise<void> {
  const backupDir = `${targetDir}.backup`;

  if (existsSync(targetDir)) {
    await rename(targetDir, backupDir);
  }

  try {
    await rename(stagedDir, targetDir);
  } catch (error) {
    if (existsSync(backupDir) && !existsSync(targetDir)) {
      await rename(backupDir, targetDir);
    }
    throw error;
  }

  // 清理失败时让构建失败，避免把旧 runtime 备份一起打进应用资源。
  await rm(backupDir, { force: true, recursive: true });
}

async function main(): Promise<void> {
  if (process.env.ENCODE_LAB_FFMPEG_SKIP === "1") {
    console.log("skip FFmpeg runtime preparation");
    return;
  }

  const target = resolveRuntimeTarget();
  const version = process.env.ENCODE_LAB_FFMPEG_VERSION ?? DEFAULT_RUNTIME_VERSION;
  const targetDir = join(RUNTIME_ROOT, target);
  await recoverRuntimeBackup(targetDir);
  if (runtimeExists(target, version) && process.env.ENCODE_LAB_FFMPEG_FORCE !== "1") {
    // 即使不重新下载，也修复旧 runtime 留下的只读文件，保证 cargo 增量构建可覆盖资源。
    await normalizeRuntimePermissions(targetDir);
    await normalizeCachedRuntimePermissions();
    console.log(`FFmpeg runtime already exists: ${target}`);
    return;
  }

  const baseUrl = process.env.ENCODE_LAB_FFMPEG_BASE_URL ?? DEFAULT_RELEASE_BASE_URL;
  const tag = `ffmpeg-${version}`;
  const assetName = `encode-lab-ffmpeg-${target}.tar.gz`;
  const url = `${baseUrl}/${tag}/${assetName}`;
  const expectedSha256 = resolveArchiveSha256(target, version);
  const tempDir = join(RUNTIME_ROOT, ".download");
  const archivePath = join(tempDir, assetName);

  await rm(tempDir, { force: true, recursive: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(RUNTIME_ROOT, { recursive: true });

  console.log(`download FFmpeg runtime: ${url}`);
  await downloadAsset(url, archivePath, expectedSha256);

  // 先在临时目录完成版本核对、权限修复和签名，避免破坏当前可用 runtime。
  await run("tar", ["-xzf", archivePath, "-C", tempDir]);
  const stagedDir = join(tempDir, target);
  if (!runtimeDirectoryMatches(stagedDir, target, version)) {
    throw new Error(`下载资产的 manifest 或必需二进制不匹配: ${version}/${target}`);
  }
  await normalizeRuntimePermissions(stagedDir);
  await signDarwinRuntime(stagedDir);
  await replaceRuntimeDirectory(stagedDir, targetDir);
  await normalizeCachedRuntimePermissions();
  await rm(tempDir, { force: true, recursive: true });

  console.log(`FFmpeg runtime ready: ${target}`);
}

await main();
