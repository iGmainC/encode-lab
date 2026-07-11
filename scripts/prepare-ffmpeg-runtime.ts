import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** 默认专用 runtime 版本，对应 encode-lab-ffmpeg 仓库的 release tag。 */
const DEFAULT_RUNTIME_VERSION = "8.1.1-rpu.1";

/** GitHub Release 下载根地址；测试或镜像环境可通过环境变量覆盖。 */
const DEFAULT_RELEASE_BASE_URL = "https://github.com/iGmainC/encode-lab-ffmpeg/releases/download";

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
function runtimeExists(target: string): boolean {
  const executableSuffix = process.platform === "win32" ? ".exe" : "";
  const binDir = join(RUNTIME_ROOT, target, "bin");

  return (
    existsSync(join(binDir, `ffmpeg${executableSuffix}`)) &&
    existsSync(join(binDir, `ffprobe${executableSuffix}`)) &&
    existsSync(join(binDir, `x265${executableSuffix}`)) &&
    existsSync(join(binDir, `dovi_tool${executableSuffix}`)) &&
    existsSync(join(RUNTIME_ROOT, target, "manifest.json"))
  );
}

/**
 * 下载 GitHub Release asset。
 * @param url asset 下载地址
 * @param outputPath 本地输出文件
 */
async function downloadAsset(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "encode-lab-runtime-preparer",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`下载 FFmpeg runtime 失败: ${response.status} ${response.statusText}`);
  }

  // release asset 可能较大，使用 arrayBuffer 保持脚本简单且避免引入额外依赖。
  await Bun.write(outputPath, await response.arrayBuffer());
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

async function main(): Promise<void> {
  if (process.env.ENCODE_LAB_FFMPEG_SKIP === "1") {
    console.log("skip FFmpeg runtime preparation");
    return;
  }

  const target = resolveRuntimeTarget();
  const version = process.env.ENCODE_LAB_FFMPEG_VERSION ?? DEFAULT_RUNTIME_VERSION;
  const targetDir = join(RUNTIME_ROOT, target);
  if (runtimeExists(target) && process.env.ENCODE_LAB_FFMPEG_FORCE !== "1") {
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
  const tempDir = join(RUNTIME_ROOT, ".download");
  const archivePath = join(tempDir, assetName);

  await rm(tempDir, { force: true, recursive: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(RUNTIME_ROOT, { recursive: true });

  console.log(`download FFmpeg runtime: ${url}`);
  await downloadAsset(url, archivePath);

  // 先解压到临时目录，确认完整后再替换目标目录，避免中途失败留下半成品。
  await run("tar", ["-xzf", archivePath, "-C", tempDir]);
  await rm(targetDir, { force: true, recursive: true });
  await rename(join(tempDir, target), targetDir);
  await normalizeRuntimePermissions(targetDir);
  await normalizeCachedRuntimePermissions();
  await signDarwinRuntime(targetDir);
  await rm(tempDir, { force: true, recursive: true });

  console.log(`FFmpeg runtime ready: ${target}`);
}

await main();
