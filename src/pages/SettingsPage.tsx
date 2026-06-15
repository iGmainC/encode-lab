import { useState } from "react";
import { CheckCircle2, Cpu, DownloadCloud, Gauge, HardDrive, MonitorCog, RefreshCw, Settings2, ShieldAlert } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { FilePathActions } from "../components/common/FilePathActions";
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

type Props = {
  settings: AppSettings | null;
  ffmpegProbe: FfmpegProbeResult | null;
};

export function SettingsPage({ settings, ffmpegProbe }: Props) {
  const { language, setLanguage, t } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "ready" | "latest" | "installing" | "error"
  >("idle");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateInstallProgress | null>(null);
  const [updateError, setUpdateError] = useState("");

  /**
   * 检查 GitHub Release 中是否存在可安装更新。
   */
  async function checkUpdate() {
    setUpdateState("checking");
    setUpdateError("");
    setUpdateProgress(null);

    try {
      if (!isTauriRuntime()) {
        setUpdateResult(null);
        setUpdateState("latest");
        return;
      }

      const result = await checkForAppUpdate();
      setUpdateResult(result);
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
      if (!isTauriRuntime()) {
        setUpdateState("latest");
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

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="shadow-sm">
          <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <MonitorCog className="size-4" aria-hidden="true" />
                环境能力
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">这台机器当前能执行什么转码</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                工作台里的推荐、禁用和输出决策都应该来自这里的真实能力边界，而不是散落在各个参数项里。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:w-[280px]">
              <CapabilityMetric label="ffmpeg" ready={Boolean(ffmpegProbe?.ffmpegFound)} />
              <CapabilityMetric label="ffprobe" ready={Boolean(ffmpegProbe?.ffprobeFound)} />
              <Metric label={t("settings.concurrency")} value={String(settings?.concurrencyN ?? "-")} />
              <Metric label="DV 保留" value={ffmpegProbe?.dolbyVision.supportsPreservePipeline ? "可用" : "受限"} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-5">
            <CardTitle className="text-base">能力判断</CardTitle>
            <CardDescription>把技术探测翻译成产品限制。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-0 text-sm">
            <CapabilityRow
              ready={Boolean(ffmpegProbe?.ffmpegFound && ffmpegProbe.ffprobeFound)}
              title="本机预览和转码"
              description={ffmpegProbe?.ffmpegFound && ffmpegProbe.ffprobeFound ? "可以读取素材、生成预览并加入队列。" : "需要先安装或定位 FFmpeg/FFprobe。"}
            />
            <CapabilityRow
              ready={Boolean(ffmpegProbe?.dolbyVision.supportsPreservePipeline)}
              title="Dolby Vision 元数据保留"
              description={ffmpegProbe?.dolbyVision.supportsPreservePipeline ? "当前环境支持实验性保留链路。" : "当前环境缺少完整保留链路，工作台会限制该能力。"}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader className="border-b p-5">
              <CardTitle>{t("settings.runtime.title")}</CardTitle>
              <CardDescription>{t("settings.runtime.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-5 text-sm md:grid-cols-2">
              <SettingField icon={Gauge} label={t("settings.concurrency")} value={String(settings?.concurrencyN ?? "-")} />
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDrive className="size-4" aria-hidden="true" />
                  {t("settings.defaultOutputDir")}
                </div>
                <div className="mt-2">
                  <FilePathActions path={settings?.defaultOutputDir ?? ""} emptyText={t("settings.notSet")} />
                </div>
              </div>
              <SettingField icon={Cpu} label={t("settings.ffmpegStrategy")} value={settings?.ffmpegStrategy ?? "-"} />
              <SettingField icon={Settings2} label={t("settings.thumbnailMode")} value={settings?.thumbnailMode ?? "-"} />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="border-b p-5">
              <CardTitle>{t("settings.probe.title")}</CardTitle>
              <CardDescription>{t("settings.probe.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <ProbeRow label="ffmpeg" ready={Boolean(ffmpegProbe?.ffmpegFound)} value={ffmpegProbe?.ffmpegPath ?? t("top.notFound")} />
              <ProbeRow label="ffprobe" ready={Boolean(ffmpegProbe?.ffprobeFound)} value={ffmpegProbe?.ffprobePath ?? t("top.notFound")} />
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">版本</div>
                <div className="mt-1 break-all font-medium">{ffmpegProbe?.version ?? t("settings.versionEmpty")}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader className="border-b p-5">
              <CardTitle>{t("settings.preferences.title")}</CardTitle>
              <CardDescription>{t("settings.preferences.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <label className="grid gap-2 text-sm">
                <span className="text-muted-foreground">{t("settings.language")}</span>
                <Select value={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{t("settings.language.zh")}</SelectItem>
                    <SelectItem value="en-US">{t("settings.language.en")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="text-muted-foreground">{t("settings.theme")}</span>
                <Select value={themeMode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
                    <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
                    <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="border-b p-5">
              <CardTitle>{t("settings.update.title")}</CardTitle>
              <CardDescription>{t("settings.update.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 text-sm">
              <div className="rounded-lg border p-4">
                <div className="text-muted-foreground">{t("settings.update.current")}</div>
                <div className="mt-1 text-lg font-semibold">{updateResult?.currentVersion ?? "-"}</div>
              </div>
              {updateState === "ready" && updateResult?.available ? (
                <StateNotice>{t("settings.update.ready", { version: updateResult.version })}</StateNotice>
              ) : null}
              {updateState === "latest" ? <StateNotice>{t("settings.update.latest")}</StateNotice> : null}
              {updateState === "installing" ? (
                <StateNotice>
                  {updatePercent === null
                    ? t("settings.update.installing")
                    : t("settings.update.progress", { percent: updatePercent })}
                </StateNotice>
              ) : null}
              {updateState === "error" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                  {updateError || t("settings.update.failed")}
                </div>
              ) : null}
              <div className="grid gap-2">
                <Button
                  disabled={updateState === "checking" || updateState === "installing"}
                  onClick={() => void checkUpdate()}
                >
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  {updateState === "checking" ? t("settings.update.checking") : t("settings.update.check")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!updateResult?.available || updateState === "installing"}
                  onClick={() => void installUpdate()}
                >
                  <DownloadCloud data-icon="inline-start" aria-hidden="true" />
                  {t("settings.update.install")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function CapabilityMetric({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${ready ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
        {ready ? "就绪" : "缺失"}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function CapabilityRow({
  ready,
  title,
  description,
}: {
  ready: boolean;
  title: string;
  description: string;
}) {
  const Icon = ready ? CheckCircle2 : ShieldAlert;
  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <Icon className={`mt-0.5 size-4 ${ready ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} aria-hidden="true" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function SettingField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 break-words font-medium">{value}</div>
    </div>
  );
}

function ProbeRow({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return (
    <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[120px_1fr_auto] md:items-center">
      <div className="font-medium">{label}</div>
      <div className="min-w-0 break-words text-muted-foreground">{value}</div>
      <Badge className={ready ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}>
        {ready ? "已连接" : "未找到"}
      </Badge>
    </div>
  );
}

function StateNotice({ children }: { children: string }) {
  return <div className="rounded-lg border bg-muted/30 p-3">{children}</div>;
}
