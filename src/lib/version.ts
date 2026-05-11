import { gt, parse, valid } from "semver";

/** Encode Lab 允许的发布 tag 格式。 */
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-beta)?$/;

/**
 * 将发布 tag 或应用版本统一为 semver 可解析格式。
 * @param value 版本号或 tag，例如 v1.2.3-beta
 * @returns 去掉 v 前缀后的 semver 字符串；非法输入返回 null
 */
export function normalizeReleaseVersion(value: string): string | null {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  const candidate = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;

  // 只接受约定的稳定版和 beta 版本，避免 1.0、latest 等非发布版本混入比较。
  if (!RELEASE_TAG_PATTERN.test(candidate)) {
    return null;
  }

  return valid(withoutPrefix);
}

/**
 * 判断候选版本是否比当前版本更新。
 * @param candidateVersion 候选版本，允许 v 前缀
 * @param currentVersion 当前版本，允许 v 前缀
 * @returns 候选版本更高时返回 true
 */
export function isNewerReleaseVersion(candidateVersion: string, currentVersion: string): boolean {
  const candidate = normalizeReleaseVersion(candidateVersion);
  const current = normalizeReleaseVersion(currentVersion);

  if (!candidate || !current) {
    return false;
  }

  // semver.gt 会正确处理 10.0.0 > 9.99.99，以及 10.0.0 > 10.0.0-beta。
  return gt(candidate, current);
}

/**
 * 格式化版本号用于界面展示。
 * @param value 版本号或 tag
 * @returns 带 v 前缀的版本号；非法输入原样返回
 */
export function formatReleaseVersion(value: string): string {
  const normalized = normalizeReleaseVersion(value);
  const parsed = normalized ? parse(normalized) : null;
  return parsed ? `v${parsed.version}` : value;
}
