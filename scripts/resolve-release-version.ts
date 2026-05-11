import { valid } from "semver";

/** Encode Lab 允许发布的 tag 格式。 */
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-beta)?$/;

/**
 * 从命令行参数和 CI 环境中解析发布 tag。
 * @returns 发布 tag，例如 v1.2.3-beta
 */
function resolveReleaseTag(): string {
  const explicitTag = Bun.argv[2];
  const githubRef = process.env.GITHUB_REF;
  const githubRefName = process.env.GITHUB_REF_NAME;
  const envReleaseVersion = process.env.RELEASE_VERSION;

  // 本地显式传参优先，方便手动验证版本注入结果。
  if (explicitTag) {
    return explicitTag;
  }

  if (envReleaseVersion) {
    return envReleaseVersion.startsWith("v") ? envReleaseVersion : `v${envReleaseVersion}`;
  }

  if (githubRef?.startsWith("refs/tags/")) {
    return githubRef.slice("refs/tags/".length);
  }

  if (githubRefName) {
    return githubRefName;
  }

  throw new Error("missing release tag: pass vx.x.x, set RELEASE_VERSION, or run from a tag workflow");
}

/**
 * 校验并转成 Tauri 接受的应用版本。
 * @param tag 发布 tag
 * @returns 不带 v 前缀的应用版本
 */
function resolveAppVersion(tag: string): string {
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error("release tag must match vx.x.x or vx.x.x-beta");
  }

  const appVersion = tag.slice(1);
  if (!valid(appVersion)) {
    throw new Error(`release tag is not a valid semver version: ${tag}`);
  }

  return appVersion;
}

/**
 * 向 GitHub Actions step output 写入版本信息。
 * @param outputs 输出键值对
 */
async function writeGithubOutputs(outputs: Record<string, string>) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const content = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await Bun.write(outputPath, `${content}\n`);
}

const tagName = resolveReleaseTag();
const appVersion = resolveAppVersion(tagName);
const tauriConfig = JSON.stringify({ version: appVersion });

await writeGithubOutputs({
  tag_name: tagName,
  app_version: appVersion,
  tauri_config: tauriConfig,
});

// 本地执行时输出 shell 友好的结果，便于确认发布版本会如何注入到 Tauri。
console.log(`tag_name=${tagName}`);
console.log(`app_version=${appVersion}`);
console.log(`tauri_config=${tauriConfig}`);
