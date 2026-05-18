import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { FilePathActions } from "../common/FilePathActions";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
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
    <Card className={cn("shadow-sm", isDragOverWindow ? "border-primary bg-primary/5" : "")}>
      <CardHeader className="gap-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{t("source.title")}</CardTitle>
            <CardDescription>{t("source.description")}</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={onPickSourceFile}>
              {t("source.pick")}
            </Button>
            <Button size="sm" variant="outline" onClick={onRetry} disabled={videoMetadataLoading}>
              {videoMetadataLoading ? t("source.loading") : t("source.retry")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("source.path")}</span>
          <FilePathActions path={sourceFilePath} emptyText={t("source.emptyPath")}>
            <input
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              name="source-file-path"
              autoComplete="off"
              value={sourceFilePath}
              onChange={(event) => setSourceFilePath(event.target.value)}
              placeholder="/Users/you/Videos/input.mp4…"
            />
          </FilePathActions>
        </label>

        <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
          {t("source.dropHint")}
        </div>

        {videoMetadataError ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>{t("source.errorTitle")}</AlertTitle>
            <AlertDescription>{videoMetadataError}</AlertDescription>
          </Alert>
        ) : null}

        {videoMetadata ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
            <FilePathActions path={videoMetadata.inputFile} />
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
