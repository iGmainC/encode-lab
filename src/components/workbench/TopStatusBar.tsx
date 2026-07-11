import { CheckCircle2, CircleAlert, Film, FolderKanban, Library, RefreshCw, Settings2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import encodeLabIcon from "../../assets/encode-lab-icon.png";
import { Button } from "../ui/button";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import type { FfmpegProbeResult } from "../../types/workbench";

const iconMap = {
  "/workbench": Film,
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
  loading: boolean;
};

export function TopStatusBar({
  title,
  navItems,
  ffmpegProbe,
  concurrencyN,
  onRefresh,
  loading,
}: Props) {
  const { t } = useI18n();
  const runtimeState = ffmpegProbe === null
    ? "pending"
    : ffmpegProbe.ffmpegFound && ffmpegProbe.ffprobeFound
      ? "ready"
      : "failed";

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
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
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

      <aside className="hidden w-40 shrink-0 flex-col border-r bg-background/95 px-2.5 py-4 lg:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-1.5 pb-5">
            <img
              src={encodeLabIcon}
              alt="Encode Lab"
              width={40}
              height={40}
              className="size-8 rounded-lg border bg-background object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold" translate="no">
                Encode Lab
              </div>
              <div className="truncate text-xs text-muted-foreground">Pro Inspector</div>
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
                        ? "bg-primary/10 text-primary shadow-sm"
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

          <div className="mt-auto space-y-2 border-t pt-3">
            <Button className="w-full justify-start" variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : ""} aria-hidden="true" />
              {loading ? t("top.refreshing") : t("top.refresh")}
            </Button>
            <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
              runtimeState === "ready"
                ? "text-emerald-600 dark:text-emerald-400"
                : runtimeState === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}>
              {runtimeState === "ready" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : runtimeState === "failed" ? (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <RefreshCw className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              )}
              <span>
                {runtimeState === "ready" ? "系统就绪" : runtimeState === "failed" ? "运行时异常" : "正在探测"}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">并发 {concurrencyN}</span>
              </span>
            </div>
          </div>
          </div>
      </aside>
    </>
  );
}
