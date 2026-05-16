import { useEffect, useState } from "react";
import type React from "react";
import { Check, Copy, Eye, EyeOff, FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "../ui/button";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

type Props = {
  /** 需要操作的本机绝对路径。 */
  path: string;
  /** 路径为空时展示的占位文案。 */
  emptyText?: string;
  /** 是否默认展示完整路径；客户端界面默认隐藏长路径。 */
  defaultExpanded?: boolean;
  /** 输入源场景需要保持可编辑时，由调用方提供展开后的编辑控件。 */
  children?: React.ReactNode;
};

/**
 * 统一承载本机路径的展示和操作，避免绝对路径直接污染客户端界面。
 * @param props 路径展示和操作参数
 */
export function FilePathActions({ path, emptyText = "-", defaultExpanded = false, children }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [revealError, setRevealError] = useState("");
  const displayName = formatPathName(path);
  const hasPath = path.trim().length > 0;

  useEffect(() => {
    // 路径变化后旧的定位失败状态不再适用，避免误报新路径已失效。
    setRevealError("");
  }, [path]);

  /**
   * 在系统文件管理器中定位当前路径。
   */
  async function revealPath() {
    if (!hasPath) {
      return;
    }

    try {
      await revealItemInDir(path);
      setRevealError("");
    } catch {
      // 文件可能已移动、删除，或所在卷暂不可访问；保留路径操作但给出明确反馈。
      setRevealError(t("path.revealFailed"));
    }
  }

  /**
   * 将完整路径复制到系统剪贴板。
   */
  async function copyPath() {
    if (!hasPath) {
      return;
    }

    await navigator.clipboard.writeText(path);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1200);
  }

  if (!hasPath) {
    return children ? <>{children}</> : <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  const CopyIcon = copied ? Check : Copy;
  const ToggleIcon = expanded ? EyeOff : Eye;
  const toggleLabel = expanded ? t("path.hideFull") : t("path.showFull");
  const hiddenLabel = t("path.hidden", { name: displayName });
  const revealLabel = t(resolveRevealLabelKey());

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={displayName}>
          {expanded ? t("path.fullShown") : hiddenLabel}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            onClick={() => void revealPath()}
            title={revealLabel}
            aria-label={revealLabel}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => void copyPath()}
            title={t("path.copy")}
            aria-label={t("path.copy")}
          >
            <CopyIcon className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setExpanded((current) => !current)}
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            <ToggleIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {revealError ? <div className="text-xs text-destructive">{revealError}</div> : null}
      {expanded ? (children ?? <div className="break-words rounded-md bg-muted px-3 py-2 text-xs [overflow-wrap:anywhere]">{path}</div>) : null}
    </div>
  );
}

/**
 * 从绝对路径中提取适合客户端展示的短名称。
 * @param path 本机路径
 */
export function formatPathName(path: string) {
  const normalized = path.trim();
  if (!normalized) {
    return "";
  }

  // 同时兼容 macOS/Linux 和 Windows 路径分隔符。
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

/**
 * 识别当前桌面系统对应的文件管理器文案。
 * @returns 路径定位按钮的国际化 key
 */
function resolveRevealLabelKey(): TranslationKey {
  const platform = window.navigator.platform.toLowerCase();
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platformInfo = `${platform} ${userAgent}`;

  if (platformInfo.includes("mac")) {
    return "path.reveal.finder";
  }

  if (platformInfo.includes("win")) {
    return "path.reveal.explorer";
  }

  // Linux 桌面环境文件管理器不统一，由 Tauri opener 交给系统默认实现。
  return "path.reveal.fileManager";
}
