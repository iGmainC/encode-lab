import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useI18n, type AppLanguage } from "../i18n/I18nProvider";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import type { AppSettings, FfmpegProbeResult } from "../types/workbench";

type Props = {
  settings: AppSettings | null;
  ffmpegProbe: FfmpegProbeResult | null;
};

export function SettingsPage({ settings, ffmpegProbe }: Props) {
  const { language, setLanguage, t } = useI18n();
  const { themeMode, setThemeMode } = useTheme();

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
            <div className="mt-2 break-all text-sm">{settings?.defaultOutputDir || t("settings.notSet")}</div>
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
