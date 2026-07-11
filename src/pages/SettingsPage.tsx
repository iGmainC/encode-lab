import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  CheckCircle2,
  CircleAlert,
  Cpu,
  DownloadCloud,
  Gauge,
  HardDrive,
  Languages,
  MonitorCog,
  Palette,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useI18n, type AppLanguage } from "../i18n/I18nProvider";
import { isTauriRuntime } from "../lib/tauriRuntime";
import {
  checkForAppUpdate,
  installAppUpdate,
  type UpdateCheckResult,
  type UpdateInstallProgress,
} from "../lib/updater";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import type { AppSettings, FfmpegProbeResult } from "../types/workbench";

/** 设置页输入数据。 */
type Props = {
  /** 桌面宿主返回的全局执行设置快照。 */
  settings: AppSettings | null;
  /** 桌面宿主对当前 FFmpeg 工具链的实时探测结果。 */
  ffmpegProbe: FfmpegProbeResult | null;
};

/** 更新检查和安装过程的前端状态。 */
type UpdateState = "idle" | "checking" | "ready" | "latest" | "installing" | "unavailable" | "error";

/** 页面内补充文案；已有翻译 key 仍优先通过 t() 获取。 */
type SettingsCopy = ReturnType<typeof getSettingsCopy>;

/**
 * 按当前界面语言补齐本页新增的专业状态文案。
 * @param language 当前界面语言
 * @returns 设置页补充文案
 */
function getSettingsCopy(language: AppLanguage) {
  if (language === "en-US") {
    return {
      ready: "Ready",
      unavailable: "Unavailable",
      limited: "Limited",
      required: "Required",
      readOnly: "Live snapshot",
      bundledRuntime: "Bundled runtime",
      systemRuntime: "System PATH",
      unknownRuntime: "Runtime unresolved",
      actualRuntime: "Actual runtime",
      actualRuntimeDescription: "The executable currently selected by the desktop runtime, not a stored preference.",
      concurrencyDescription: "Maximum simultaneous jobs used by the local FIFO scheduler.",
      concurrentJobs: "jobs",
      outputDescription: "Default output path for new tasks. It can still be overridden per task in the workbench.",
      outputConfigured: "New-task default",
      outputNotConfigured: "Not configured; new tasks can choose a directory in the workbench.",
      liveProbe: "Live probe",
      probePending: "Waiting for probe",
      coreToolchain: "Core toolchain",
      coreToolchainDescription: "Resolved binaries and versions used for metadata inspection, preview, and transcode.",
      detected: "Detected",
      notDetected: "Not detected",
      noVersion: "No version reported",
      noPath: "No executable path reported",
      dolbyVision: "Dolby Vision preserve pipeline",
      dolbyVisionReady: "The complete metadata preserve toolchain is available for supported source profiles.",
      dolbyVisionLimited: "The preserve pipeline is incomplete. Standard SDR/HDR transcode remains available.",
      profiles: "Profiles",
      encoders: "Encoders",
      preferencesNote: "These preferences apply locally and take effect immediately.",
      desktopOnly: "Update checks are available in the desktop app only.",
      browserPreview: "Browser preview",
      status: "Status",
    };
  }

  return {
    ready: "就绪",
    unavailable: "不可用",
    limited: "受限",
    required: "必需",
    readOnly: "实时快照",
    bundledRuntime: "随包 Runtime",
    systemRuntime: "系统 PATH",
    unknownRuntime: "Runtime 未解析",
    actualRuntime: "实际 Runtime",
    actualRuntimeDescription: "展示桌面宿主当前真正选中的可执行文件，而不是配置中的偏好值。",
    concurrencyDescription: "本机 FIFO 调度器允许同时执行的最大任务数。",
    concurrentJobs: "个任务",
    outputDescription: "新任务的默认输出路径；进入工作台后仍可按任务覆盖。",
    outputConfigured: "新任务默认值",
    outputNotConfigured: "尚未配置；新任务可在工作台中单独选择目录。",
    liveProbe: "实时探测",
    probePending: "等待探测",
    coreToolchain: "核心工具链",
    coreToolchainDescription: "元数据读取、预览和正式转码实际使用的二进制与版本。",
    detected: "已连接",
    notDetected: "未找到",
    noVersion: "未返回版本信息",
    noPath: "未返回可执行文件路径",
    dolbyVision: "Dolby Vision 保留链路",
    dolbyVisionReady: "完整元数据保留工具链已就绪，可用于当前支持的源片 Profile。",
    dolbyVisionLimited: "保留链路不完整；普通 SDR / HDR 转码仍可正常使用。",
    profiles: "Profile",
    encoders: "编码器",
    preferencesNote: "这些偏好只作用于本机界面，并会立即生效。",
    desktopOnly: "仅桌面应用支持检查和安装更新。",
    browserPreview: "浏览器预览",
    status: "状态",
  };
}

/**
 * 按实际探测路径判断当前执行来自随包 Runtime 还是系统 PATH。
 * @param ffmpegPath 当前 FFmpeg 可执行文件路径
 * @param copy 当前语言文案
 * @returns 用户可读的 Runtime 来源
 */
function resolveRuntimeSource(ffmpegPath: string | undefined, copy: SettingsCopy) {
  if (!ffmpegPath) {
    return copy.unknownRuntime;
  }

  // 随包二进制路径稳定包含 ffmpeg-runtime；其他已解析路径均视为系统回退来源。
  return ffmpegPath.includes("ffmpeg-runtime") ? copy.bundledRuntime : copy.systemRuntime;
}

/**
 * 将工具版本压缩成适合检查器顶栏展示的首行摘要。
 * @param version 探测返回的完整版本文本
 * @param fallback 缺少版本时的文案
 * @returns 单行版本摘要
 */
function formatVersionSummary(version: string | undefined, fallback: string) {
  return version?.split(/\r?\n/, 1)[0]?.trim() || fallback;
}

/**
 * 环境与设置页：以紧凑检查器呈现真实 Runtime、执行设置与高级能力。
 */
export function SettingsPage({ settings, ffmpegProbe }: Props) {
  const { language, setLanguage, t } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const copy = getSettingsCopy(language);
  const desktopRuntime = isTauriRuntime();
  const runtimeReady = Boolean(ffmpegProbe?.ffmpegFound && ffmpegProbe.ffprobeFound);
  const runtimeSource = resolveRuntimeSource(ffmpegProbe?.ffmpegPath, copy);
  const runtimeVersion = formatVersionSummary(ffmpegProbe?.version, copy.noVersion);
  const [currentVersion, setCurrentVersion] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateInstallProgress | null>(null);
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    let active = true;
    void getVersion()
      .then((version) => {
        if (active) {
          setCurrentVersion(version);
        }
      })
      .catch(() => {
        // 版本读取失败不影响更新器本身；用户仍可通过“检查更新”重试完整链路。
      });

    return () => {
      active = false;
    };
  }, [desktopRuntime]);

  /**
   * 检查 GitHub Release 中是否存在可安装更新。
   */
  async function checkUpdate() {
    setUpdateState("checking");
    setUpdateError("");
    setUpdateProgress(null);

    try {
      if (!desktopRuntime) {
        // 浏览器预览没有 updater 插件，不能把“无法检查”伪装成“已经最新”。
        setUpdateResult(null);
        setUpdateState("unavailable");
        return;
      }

      const result = await checkForAppUpdate();
      setUpdateResult(result);
      setCurrentVersion(result.currentVersion);
      setUpdateState(result.available ? "ready" : "latest");
    } catch (error) {
      setUpdateState("error");
      setUpdateError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 安装已检查到的更新，并在安装完成后重启应用。
   */
  async function installUpdate() {
    if (!updateResult?.available) {
      return;
    }

    setUpdateState("installing");
    setUpdateError("");

    try {
      if (!desktopRuntime) {
        setUpdateState("unavailable");
        return;
      }

      await installAppUpdate(updateResult.update, setUpdateProgress);
    } catch (error) {
      setUpdateState("error");
      setUpdateError(error instanceof Error ? error.message : String(error));
    }
  }

  const updatePercent =
    updateProgress?.contentLength && updateProgress.contentLength > 0
      ? Math.min(100, Math.round((updateProgress.downloadedBytes / updateProgress.contentLength) * 100))
      : null;
  const displayedAppVersion = updateResult?.currentVersion || currentVersion || (desktopRuntime ? "-" : copy.browserPreview);

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Runtime status">
        <div className="flex min-h-16 flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${runtimeReady ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive"}`}>
              <MonitorCog className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                Runtime
                <StatusBadge status={runtimeReady ? "ready" : "missing"} copy={copy} />
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={runtimeVersion}>
                {runtimeVersion}
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
            <Badge variant="outline" className="font-mono font-normal">
              {runtimeSource}
            </Badge>
            <Badge variant="outline" className="font-mono font-normal">
              N={settings?.concurrencyN ?? "-"}
            </Badge>
            <Badge
              variant="outline"
              className={ffmpegProbe?.dolbyVision.supportsPreservePipeline ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
            >
              DV {ffmpegProbe?.dolbyVision.supportsPreservePipeline ? copy.ready : copy.limited}
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-xl border bg-card">
            <SectionHeader
              title={t("settings.runtime.title")}
              description={t("settings.runtime.description")}
              action={<Badge variant="secondary">{copy.readOnly}</Badge>}
            />
            <div className="divide-y">
              <InspectorRow
                icon={Cpu}
                label={copy.actualRuntime}
                description={copy.actualRuntimeDescription}
              >
                <div className="min-w-0">
                  <div className="font-medium">{runtimeSource}</div>
                  <div className="mt-1 max-w-xl break-all font-mono text-xs text-muted-foreground">
                    {ffmpegProbe?.ffmpegPath ?? copy.noPath}
                  </div>
                </div>
              </InspectorRow>

              <InspectorRow
                icon={Gauge}
                label={t("settings.concurrency")}
                description={copy.concurrencyDescription}
              >
                <div className="font-mono text-base font-semibold tabular-nums">
                  {settings?.concurrencyN ?? "-"} <span className="text-xs font-normal text-muted-foreground">{copy.concurrentJobs}</span>
                </div>
              </InspectorRow>

              <InspectorRow
                icon={HardDrive}
                label={t("settings.defaultOutputDir")}
                description={copy.outputDescription}
              >
                <div className="min-w-0">
                  <div className="break-all font-mono text-xs font-medium">
                    {settings?.defaultOutputDir || t("settings.notSet")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {settings?.defaultOutputDir ? copy.outputConfigured : copy.outputNotConfigured}
                  </div>
                </div>
              </InspectorRow>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border bg-card">
            <SectionHeader
              title={copy.coreToolchain}
              description={copy.coreToolchainDescription}
              action={
                <Badge variant="outline" className="font-normal">
                  {ffmpegProbe ? copy.liveProbe : copy.probePending}
                </Badge>
              }
            />
            <div className="divide-y">
              <ToolRow
                name="ffmpeg"
                ready={Boolean(ffmpegProbe?.ffmpegFound)}
                path={ffmpegProbe?.ffmpegPath}
                version={ffmpegProbe?.version}
                copy={copy}
              />
              <ToolRow
                name="ffprobe"
                ready={Boolean(ffmpegProbe?.ffprobeFound)}
                path={ffmpegProbe?.ffprobePath}
                copy={copy}
              />
            </div>

            <div className="border-t bg-muted/25 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {copy.dolbyVision}
                      <StatusBadge
                        status={ffmpegProbe?.dolbyVision.supportsPreservePipeline ? "ready" : "limited"}
                        copy={copy}
                      />
                    </div>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                      {ffmpegProbe?.dolbyVision.supportsPreservePipeline ? copy.dolbyVisionReady : copy.dolbyVisionLimited}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[45%] sm:justify-end">
                  <Badge variant="outline" className="font-mono font-normal">
                    x265 {ffmpegProbe?.dolbyVision.x265CliFound ? copy.detected : copy.notDetected}
                  </Badge>
                  <Badge variant="outline" className="font-mono font-normal">
                    dovi_tool {ffmpegProbe?.dolbyVision.doviToolFound ? copy.detected : copy.notDetected}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                <div className="rounded-lg border bg-background px-3 py-2">
                  <span className="font-medium text-foreground">{copy.profiles}:</span>{" "}
                  {ffmpegProbe?.dolbyVision.supportedProfiles.join(", ") || "-"}
                </div>
                <div className="rounded-lg border bg-background px-3 py-2">
                  <span className="font-medium text-foreground">{copy.encoders}:</span>{" "}
                  {ffmpegProbe?.dolbyVision.supportedEncoders.join(", ") || "-"}
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="overflow-hidden rounded-xl border bg-card">
            <SectionHeader
              title={t("settings.preferences.title")}
              description={copy.preferencesNote}
            />
            <div className="divide-y">
              <PreferenceRow icon={Languages} label={t("settings.language")}>
                <Select value={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
                  <SelectTrigger className="w-full sm:w-44 xl:w-full" aria-label={t("settings.language")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{t("settings.language.zh")}</SelectItem>
                    <SelectItem value="en-US">{t("settings.language.en")}</SelectItem>
                  </SelectContent>
                </Select>
              </PreferenceRow>
              <PreferenceRow icon={Palette} label={t("settings.theme")}>
                <Select value={themeMode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
                  <SelectTrigger className="w-full sm:w-44 xl:w-full" aria-label={t("settings.theme")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
                    <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
                    <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
                  </SelectContent>
                </Select>
              </PreferenceRow>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border bg-card">
            <SectionHeader
              title={t("settings.update.title")}
              description={t("settings.update.description")}
            />
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <div>
                  <div className="text-xs text-muted-foreground">{t("settings.update.current")}</div>
                  <div className="mt-0.5 font-mono font-semibold">{displayedAppVersion}</div>
                </div>
                <Badge variant="outline" className="font-normal">
                  {copy.status}: {updateState === "ready" ? copy.ready : updateState === "error" ? copy.unavailable : "-"}
                </Badge>
              </div>

              {updateState === "ready" && updateResult?.available ? (
                <StateNotice tone="success">{t("settings.update.ready", { version: updateResult.version })}</StateNotice>
              ) : null}
              {updateState === "latest" ? <StateNotice tone="success">{t("settings.update.latest")}</StateNotice> : null}
              {updateState === "installing" ? (
                <StateNotice>
                  {updatePercent === null
                    ? t("settings.update.installing")
                    : t("settings.update.progress", { percent: updatePercent })}
                </StateNotice>
              ) : null}
              {updateState === "unavailable" || !desktopRuntime ? (
                <StateNotice>{copy.desktopOnly}</StateNotice>
              ) : null}
              {updateState === "error" ? (
                <StateNotice tone="error">{updateError || t("settings.update.failed")}</StateNotice>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <Button
                  variant="outline"
                  disabled={!desktopRuntime || updateState === "checking" || updateState === "installing"}
                  onClick={() => void checkUpdate()}
                >
                  <RefreshCw className={updateState === "checking" ? "animate-spin" : ""} data-icon="inline-start" aria-hidden="true" />
                  {updateState === "checking" ? t("settings.update.checking") : t("settings.update.check")}
                </Button>
                <Button
                  disabled={!updateResult?.available || updateState === "installing"}
                  onClick={() => void installUpdate()}
                >
                  <DownloadCloud data-icon="inline-start" aria-hidden="true" />
                  {t("settings.update.install")}
                </Button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** 区块标题栏参数。 */
type SectionHeaderProps = {
  /** 区块标题。 */
  title: string;
  /** 区块职责摘要。 */
  description: string;
  /** 可选的状态或动作。 */
  action?: ReactNode;
};

/**
 * 渲染统一的紧凑区块标题，保持设置页扫描节奏一致。
 */
function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 border-b px-4 py-3.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** 检查器配置行参数。 */
type InspectorRowProps = {
  /** 行首图标。 */
  icon: LucideIcon;
  /** 配置名称。 */
  label: string;
  /** 配置作用说明。 */
  description: string;
  /** 当前配置值。 */
  children: ReactNode;
};

/**
 * 用左右对齐的信息行替代卡片网格，便于专业用户快速比较配置和值。
 */
function InspectorRow({ icon: Icon, label, description, children }: InspectorRowProps) {
  return (
    <div className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(200px,0.8fr)_minmax(260px,1.2fr)] md:items-center">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0 md:justify-self-stretch">{children}</div>
    </div>
  );
}

/** 工具链探测行参数。 */
type ToolRowProps = {
  /** 二进制名称。 */
  name: string;
  /** 当前是否已解析到可执行文件。 */
  ready: boolean;
  /** 实际可执行文件路径。 */
  path?: string;
  /** 工具版本文本。 */
  version?: string;
  /** 当前语言文案。 */
  copy: SettingsCopy;
};

/**
 * 展示一个真实工具探测结果；路径和版本均来自后端探测而非静态配置。
 */
function ToolRow({ name, ready, path, version, copy }: ToolRowProps) {
  const Icon = ready ? CheckCircle2 : CircleAlert;

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-center">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${ready ? "text-primary" : "text-destructive"}`} aria-hidden="true" />
        <span className="font-mono text-sm font-semibold">{name}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {copy.required}
        </span>
      </div>
      <div className="min-w-0">
        <div className="break-all font-mono text-xs text-muted-foreground">{path ?? copy.noPath}</div>
        {version ? (
          <div className="mt-1 truncate text-xs text-muted-foreground" title={version}>
            {formatVersionSummary(version, copy.noVersion)}
          </div>
        ) : null}
      </div>
      <StatusBadge status={ready ? "ready" : "missing"} copy={copy} />
    </div>
  );
}

/** 偏好设置行参数。 */
type PreferenceRowProps = {
  /** 偏好图标。 */
  icon: LucideIcon;
  /** 偏好名称。 */
  label: string;
  /** 可交互的偏好控件。 */
  children: ReactNode;
};

/**
 * 渲染紧凑偏好控件行。
 */
function PreferenceRow({ icon: Icon, label, children }: PreferenceRowProps) {
  return (
    <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center xl:grid-cols-1">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {label}
      </div>
      {children}
    </div>
  );
}

/** 状态徽标参数。 */
type StatusBadgeProps = {
  /** ready 表示主链路就绪，missing 表示必需项缺失，limited 表示可选能力受限。 */
  status: "ready" | "missing" | "limited";
  /** 当前语言文案。 */
  copy: SettingsCopy;
};

/**
 * 将核心缺失和可选能力受限区分开，避免把 Dolby Vision 受限误报为全局故障。
 */
function StatusBadge({ status, copy }: StatusBadgeProps) {
  const label = status === "ready" ? copy.ready : status === "missing" ? copy.unavailable : copy.limited;
  const className =
    status === "ready"
      ? "bg-accent text-accent-foreground"
      : status === "missing"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "bg-secondary text-secondary-foreground";

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

/** 更新反馈提示参数。 */
type StateNoticeProps = {
  /** 提示内容。 */
  children: ReactNode;
  /** 提示语义。 */
  tone?: "neutral" | "success" | "error";
};

/**
 * 渲染更新器的紧凑反馈状态。
 */
function StateNotice({ children, tone = "neutral" }: StateNoticeProps) {
  const className =
    tone === "success"
      ? "border-accent bg-accent/40 text-accent-foreground"
      : tone === "error"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "bg-muted/30 text-muted-foreground";

  return <div className={`rounded-lg border p-3 text-xs leading-5 ${className}`}>{children}</div>;
}
