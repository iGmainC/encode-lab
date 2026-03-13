import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
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
  onSeed: () => void;
  loading: boolean;
  seeding: boolean;
  children: ReactNode;
};

export function WorkbenchLayout({
  title,
  description,
  navItems,
  ffmpegProbe,
  concurrencyN,
  onRefresh,
  onSeed,
  loading,
  seeding,
  children,
}: Props) {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 lg:flex-row lg:p-6">
        <AppSidebar items={navItems} />
        <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-3xl border bg-background shadow-sm">
          <TopStatusBar
            title={title}
            description={description}
            ffmpegProbe={ffmpegProbe}
            concurrencyN={concurrencyN}
            onRefresh={onRefresh}
            onSeed={onSeed}
            loading={loading}
            seeding={seeding}
          />
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
