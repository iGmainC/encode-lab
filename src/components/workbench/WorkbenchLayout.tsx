import { ReactNode } from "react";
import { TopStatusBar } from "./TopStatusBar";
import type { FfmpegProbeResult } from "../../types/workbench";

type LayoutItem = {
  label: string;
  to: string;
};

type Props = {
  title: string;
  description: string;
  navItems: LayoutItem[];
  ffmpegProbe: FfmpegProbeResult | null;
  concurrencyN: number | string;
  onRefresh: () => void;
  loading: boolean;
  compactHeader?: boolean;
  children: ReactNode;
};

export function WorkbenchLayout({
  title,
  description,
  navItems,
  ffmpegProbe,
  concurrencyN,
  onRefresh,
  loading,
  compactHeader = false,
  children,
}: Props) {
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-muted/20 lg:flex-row">
        <TopStatusBar
          title={title}
          description={description}
          navItems={navItems}
          ffmpegProbe={ffmpegProbe}
          concurrencyN={concurrencyN}
          onRefresh={onRefresh}
          loading={loading}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-3 py-3 md:px-4">
            {!compactHeader ? (
              <section className="flex min-w-0 flex-col gap-2 border-b pb-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground" translate="no">
                  Encode Lab
                </div>
                <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
                  </div>
                </div>
              </section>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
