import { DatabaseZap, Film, FolderKanban, Library, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import encodeLabIcon from "../../assets/encode-lab-icon.png";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import type { FfmpegProbeResult } from "../../types/workbench";

const iconMap = {
  "/task-config": Film,
  "/jobs": FolderKanban,
  "/templates": Library,
  "/settings": Settings2,
} as const;

type Props = {
  title: string;
  description: string;
  navItems: { label: string; to: string }[];
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
  navItems,
  ffmpegProbe,
  concurrencyN,
  onRefresh,
  onSeed,
  loading,
  seeding,
}: Props) {
  const { t } = useI18n();

  return (
    <header className="shrink-0 border-b bg-background/88 px-4 py-3 backdrop-blur-xl md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={encodeLabIcon}
              alt="Encode Lab"
              width={40}
              height={40}
              className="size-10 rounded-lg border bg-background object-cover"
            />
            <div className="min-w-0">
              <div
                className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                translate="no"
              >
                Encode Lab
              </div>
              <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
            <div className="flex flex-wrap gap-1.5">
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
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                {loading ? t("top.refreshing") : t("top.refresh")}
              </Button>
              <Button onClick={onSeed} disabled={loading || seeding}>
                {seeding ? (
                  <DatabaseZap data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Sparkles data-icon="inline-start" aria-hidden="true" />
                )}
                {seeding ? t("top.seeding") : t("top.seed")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          <nav aria-label="Primary" className="flex gap-1 overflow-x-auto pb-1 lg:justify-end lg:pb-0">
            {navItems.map((item) => {
              const Icon = iconMap[item.to as keyof typeof iconMap] ?? Film;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex min-w-max items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
