import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useI18n } from "../../i18n/I18nProvider";
import type { FfmpegProbeResult } from "../../types/workbench";

type Props = {
  title: string;
  description: string;
  ffmpegProbe: FfmpegProbeResult | null;
  concurrencyN: number | string;
  onRefresh: () => void;
  onSeed: () => void;
  loading: boolean;
  seeding: boolean;
};

export function TopStatusBar({
  title,
  description,
  ffmpegProbe,
  concurrencyN,
  onRefresh,
  onSeed,
  loading,
  seeding,
}: Props) {
  const { t } = useI18n();

  return (
    <header className="border-b bg-background/95 px-4 py-4 backdrop-blur md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
          <div className="flex flex-wrap gap-2">
            <Badge variant={ffmpegProbe?.ffmpegFound ? "default" : "secondary"}>
              ffmpeg {ffmpegProbe?.ffmpegFound ? t("top.connected") : t("top.notFound")}
            </Badge>
            <Badge variant={ffmpegProbe?.ffprobeFound ? "default" : "secondary"}>
              ffprobe {ffmpegProbe?.ffprobeFound ? t("top.connected") : t("top.notFound")}
            </Badge>
            <Badge variant="outline">{t("top.concurrency", { value: concurrencyN })}</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onRefresh} disabled={loading || seeding}>
              {loading ? t("top.refreshing") : t("top.refresh")}
            </Button>
            <Button onClick={onSeed} disabled={loading || seeding}>
              {seeding ? t("top.seeding") : t("top.seed")}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
