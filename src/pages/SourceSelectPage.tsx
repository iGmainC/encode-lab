import { ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { SourceVideoCard } from "../components/workbench/SourceVideoCard";
import { StepFlowHeader } from "../components/workbench/StepFlowHeader";
import { useTaskDraft } from "../context/TaskDraftContext";
import { useI18n } from "../i18n/I18nProvider";

type Props = {
  onContinue: () => void;
};

export function SourceSelectPage({ onContinue }: Props) {
  const { t } = useI18n();
  const {
    setStep,
    sourceFilePath,
    setSourceFilePath,
    videoMetadata,
    videoMetadataLoading,
    videoMetadataError,
    isDragOverWindow,
    pickSourceFile,
    retryVideoMetadata,
  } = useTaskDraft();
  const canContinue = Boolean(sourceFilePath.trim()) && Boolean(videoMetadata) && !videoMetadataLoading && !videoMetadataError;

  /**
   * 进入参数配置页，源文件读取失败或仍在读取时停留在当前步骤。
   */
  function continueToConfig() {
    if (!canContinue) {
      return;
    }

    setStep("config");
    onContinue();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <StepFlowHeader currentStep="source" />
      <SourceVideoCard
        sourceFilePath={sourceFilePath}
        setSourceFilePath={setSourceFilePath}
        videoMetadata={videoMetadata}
        videoMetadataLoading={videoMetadataLoading}
        videoMetadataError={videoMetadataError}
        onRetry={() => void retryVideoMetadata()}
        onPickSourceFile={() => void pickSourceFile()}
        isDragOverWindow={isDragOverWindow}
      />
      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">{t("source.next.title")}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {canContinue ? t("source.next.description") : t("source.next.waiting")}
            </div>
          </div>
          <Button className="shrink-0" disabled={!canContinue} onClick={continueToConfig}>
            <ArrowRight data-icon="inline-start" aria-hidden="true" />
            {t("source.next.action")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
