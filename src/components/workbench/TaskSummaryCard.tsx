import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useI18n } from "../../i18n/I18nProvider";
import type { VideoMetadataResult } from "../../types/workbench";

type Props = {
  videoMetadata: VideoMetadataResult | null;
  codec: string;
  encoder: string;
  mode: string;
  twoPass: boolean;
  preserveDolbyVisionMetadata?: boolean;
  compact?: boolean;
};

export function TaskSummaryCard({
  videoMetadata,
  codec,
  encoder,
  mode,
  twoPass,
  preserveDolbyVisionMetadata,
  compact = false,
}: Props) {
  const { t } = useI18n();
  const metricClassName = compact
    ? "rounded-lg border bg-background p-2.5"
    : "rounded-lg border bg-background p-3";
  const metricValueClassName = compact ? "mt-0.5 truncate text-sm font-medium" : "mt-1 font-medium";

  return (
    <Card className="shadow-sm">
      <CardHeader className={compact ? "gap-0.5 p-3" : "gap-1 p-4"}>
        <CardTitle className={compact ? "text-base" : undefined}>{t("summary.title")}</CardTitle>
        <CardDescription className={compact ? "text-xs leading-5" : undefined}>
          {t("summary.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={compact ? "flex flex-col gap-3 p-3 pt-0" : "flex flex-col gap-4 p-4 pt-0"}>
        <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
          <Badge variant="outline">{codec.toUpperCase()}</Badge>
          <Badge variant="outline">{encoder}</Badge>
          <Badge variant="outline">{mode}</Badge>
          <Badge variant={twoPass ? "default" : "secondary"}>{twoPass ? "2-pass" : "1-pass"}</Badge>
          {preserveDolbyVisionMetadata ? <Badge variant="secondary">DV Preserve</Badge> : null}
        </div>

        <div className={compact ? "grid grid-cols-2 gap-2 text-xs" : "grid grid-cols-2 gap-3 text-sm"}>
          <div className={metricClassName}>
            <div className="text-muted-foreground">{t("summary.source")}</div>
            <div className={metricValueClassName}>
              {videoMetadata?.video?.width ?? "-"} x {videoMetadata?.video?.height ?? "-"}
            </div>
          </div>
          <div className={metricClassName}>
            <div className="text-muted-foreground">{t("summary.codec")}</div>
            <div className={metricValueClassName}>{videoMetadata?.video?.codecName ?? "-"}</div>
          </div>
          <div className={metricClassName}>
            <div className="text-muted-foreground">{t("summary.fps")}</div>
            <div className={metricValueClassName}>{videoMetadata?.video?.fps?.toFixed(2) ?? "-"}</div>
          </div>
          <div className={metricClassName}>
            <div className="text-muted-foreground">{t("summary.container")}</div>
            <div className={metricValueClassName}>{videoMetadata?.containerFormat ?? "-"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
