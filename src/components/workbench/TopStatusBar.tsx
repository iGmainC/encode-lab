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
  "/preview": Film,
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
    <>
      <header className="shrink-0 border-b bg-background/95 px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={encodeLabIcon}
              alt="Encode Lab"
              width={40}
              height={40}
              className="size-9 rounded-lg border bg-background object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold" translate="no">Encode Lab</div>
              <div className="truncate text-xs text-muted-foreground">{title}</div>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading || seeding}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {loading ? t("top.refreshing") : t("top.refresh")}
          </Button>
        </div>
        <nav aria-label="Primary" className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {navItems.map((item) => {
            const Icon = iconMap[item.to as keyof typeof iconMap] ?? Film;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
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
      </header>

      <aside className="hidden w-[236px] shrink-0 flex-col border-r bg-background/95 px-3 py-4 backdrop-blur-xl lg:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-2 pb-5">
            <img
              src={encodeLabIcon}
              alt="Encode Lab"
              width={40}
              height={40}
              className="size-9 rounded-lg border bg-background object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold" translate="no">
                Encode Lab
              </div>
              <div className="truncate text-xs text-muted-foreground">Local Workspace</div>
            </div>
          </div>

          <nav aria-label="Primary" className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = iconMap[item.to as keyof typeof iconMap] ?? Film;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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

        <div className="mt-auto space-y-3 border-t pt-4">
          <div className="grid gap-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">ffmpeg</span>
              <Badge variant={ffmpegProbe?.ffmpegFound ? "default" : "secondary"}>
                {ffmpegProbe?.ffmpegFound ? t("top.connected") : t("top.notFound")}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">ffprobe</span>
              <Badge variant={ffmpegProbe?.ffprobeFound ? "default" : "secondary"}>
                {ffmpegProbe?.ffprobeFound ? t("top.connected") : t("top.notFound")}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t("top.concurrency", { value: concurrencyN })}</span>
            </div>
          </div>
          <div className="grid gap-2">
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading || seeding}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {loading ? t("top.refreshing") : t("top.refresh")}
            </Button>
            <Button size="sm" onClick={onSeed} disabled={loading || seeding}>
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
      </aside>
    </>
  );
}
