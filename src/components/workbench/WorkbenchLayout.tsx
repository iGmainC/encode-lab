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
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-muted/20">
        <TopStatusBar
          title={title}
          description={description}
          navItems={navItems}
          ffmpegProbe={ffmpegProbe}
          concurrencyN={concurrencyN}
          onRefresh={onRefresh}
          onSeed={onSeed}
          loading={loading}
          seeding={seeding}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1480px] px-4 py-4 md:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
