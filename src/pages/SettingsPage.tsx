import { useState } from "react";
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
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.preferences.title")}</CardTitle>
          <CardDescription>{t("settings.preferences.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
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

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.update.title")}</CardTitle>
          <CardDescription>{t("settings.update.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-2 text-sm">
            <div className="text-muted-foreground">{t("settings.update.current")}</div>
            <div className="text-lg font-semibold">{updateResult?.currentVersion ?? "-"}</div>
            {updateState === "ready" && updateResult?.available ? (
              <div className="rounded-2xl border bg-muted/30 p-3">
                {t("settings.update.ready", { version: updateResult.version })}
              </div>
            ) : null}
            {updateState === "latest" ? (
              <div className="rounded-2xl border bg-muted/30 p-3">{t("settings.update.latest")}</div>
            ) : null}
            {updateState === "installing" ? (
              <div className="rounded-2xl border bg-muted/30 p-3">
                {updatePercent === null
                  ? t("settings.update.installing")
                  : t("settings.update.progress", { percent: updatePercent })}
              </div>
            ) : null}
            {updateState === "error" ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                {updateError || t("settings.update.failed")}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2 md:justify-end">
            <Button
              disabled={updateState === "checking" || updateState === "installing"}
              onClick={() => void checkUpdate()}
            >
              {updateState === "checking" ? t("settings.update.checking") : t("settings.update.check")}
            </Button>
            <Button
              variant="secondary"
              disabled={!updateResult?.available || updateState === "installing"}
              onClick={() => void installUpdate()}
            >
              {t("settings.update.install")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.runtime.title")}</CardTitle>
          <CardDescription>{t("settings.runtime.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">{t("settings.concurrency")}</div>
            <div className="mt-2 text-2xl font-semibold">{settings?.concurrencyN ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">{t("settings.defaultOutputDir")}</div>
            <div className="mt-2">
              <FilePathActions path={settings?.defaultOutputDir ?? ""} emptyText={t("settings.notSet")} />
            </div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">{t("settings.ffmpegStrategy")}</div>
            <div className="mt-2 text-sm">{settings?.ffmpegStrategy ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">{t("settings.thumbnailMode")}</div>
            <div className="mt-2 text-sm">{settings?.thumbnailMode ?? "-"}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.probe.title")}</CardTitle>
            <CardDescription>{t("settings.probe.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-2xl border p-4">ffmpeg: {ffmpegProbe?.ffmpegFound ? t("settings.found") : t("top.notFound")}</div>
            <div className="rounded-2xl border p-4">ffprobe: {ffmpegProbe?.ffprobeFound ? t("settings.found") : t("top.notFound")}</div>
            <div className="rounded-2xl border p-4 break-all md:col-span-2">{ffmpegProbe?.version ?? t("settings.versionEmpty")}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.title")}</CardTitle>
            <CardDescription>{t("settings.description")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("settings.future")}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
