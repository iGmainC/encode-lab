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
};

export function TaskSummaryCard({
  videoMetadata,
  codec,
  encoder,
  mode,
  twoPass,
  preserveDolbyVisionMetadata,
}: Props) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("summary.title")}</CardTitle>
        <CardDescription>{t("summary.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{codec.toUpperCase()}</Badge>
          <Badge variant="outline">{encoder}</Badge>
          <Badge variant="outline">{mode}</Badge>
          <Badge variant={twoPass ? "default" : "secondary"}>{twoPass ? "2-pass" : "1-pass"}</Badge>
          {preserveDolbyVisionMetadata ? <Badge variant="secondary">DV Preserve</Badge> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">{t("summary.source")}</div>
            <div className="mt-1 font-medium">
              {videoMetadata?.video?.width ?? "-"} x {videoMetadata?.video?.height ?? "-"}
            </div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">{t("summary.codec")}</div>
            <div className="mt-1 font-medium">{videoMetadata?.video?.codecName ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">{t("summary.fps")}</div>
            <div className="mt-1 font-medium">{videoMetadata?.video?.fps?.toFixed(2) ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">{t("summary.container")}</div>
            <div className="mt-1 font-medium">{videoMetadata?.containerFormat ?? "-"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
