import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useI18n } from "../../i18n/I18nProvider";
import type { VideoMetadataResult } from "../../types/workbench";

type Props = {
  sourceFilePath: string;
  setSourceFilePath: (value: string) => void;
  videoMetadata: VideoMetadataResult | null;
  videoMetadataLoading: boolean;
  videoMetadataError: string | null;
  onRetry: () => void;
  onPickSourceFile: () => void;
  isDragOverWindow: boolean;
};

export function SourceVideoCard({
  sourceFilePath,
  setSourceFilePath,
  videoMetadata,
  videoMetadataLoading,
  videoMetadataError,
  onRetry,
  onPickSourceFile,
  isDragOverWindow,
}: Props) {
  const { t } = useI18n();

  return (
    <Card className={isDragOverWindow ? "border-primary bg-primary/5" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t("source.title")}</CardTitle>
            <CardDescription>{t("source.description")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onPickSourceFile}>
              {t("source.pick")}
            </Button>
            <Button size="sm" variant="outline" onClick={onRetry} disabled={videoMetadataLoading}>
              {videoMetadataLoading ? t("source.loading") : t("source.retry")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t("source.path")}</span>
          <input
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            value={sourceFilePath}
            onChange={(event) => setSourceFilePath(event.target.value)}
            placeholder="/Users/you/Videos/input.mp4"
          />
        </label>

        <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          {t("source.dropHint")}
        </div>

        {videoMetadataError ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>{t("source.errorTitle")}</AlertTitle>
            <AlertDescription>{videoMetadataError}</AlertDescription>
          </Alert>
        ) : null}

        {videoMetadata ? (
          <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground">{videoMetadata.inputFile}</div>
            <div className="flex flex-wrap gap-2">
              {videoMetadata.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("source.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
