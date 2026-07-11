import type { TranslationKey } from "../i18n/translations";
import type { JobMetricsEvent, JobStepCode } from "../types/workbench";

/** 不带动态阶段序号的任务步骤翻译键。 */
const JOB_STEP_KEYS: Partial<Record<JobStepCode, TranslationKey>> = {
  dv_extract_source_video: "jobStep.dvExtractSourceVideo",
  dv_extract_source_rpu: "jobStep.dvExtractSourceRpu",
  dv_encode_base_layer: "jobStep.dvEncodeBaseLayer",
  dv_extract_output_video: "jobStep.dvExtractOutputVideo",
  dv_extract_output_rpu: "jobStep.dvExtractOutputRpu",
  dv_export_source_rpu: "jobStep.dvExportSourceRpu",
  dv_export_output_rpu: "jobStep.dvExportOutputRpu",
  dv_verify_output: "jobStep.dvVerifyOutput",
  finalize_output: "jobStep.finalizeOutput",
};

/** 国际化函数的最小契约，避免工具层依赖 React Context。 */
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * 按稳定 stepCode 渲染任务阶段，绝不直接展示后端携带的单语言 label。
 * @param metrics 当前任务指标；缺省时返回通用转码状态
 * @param t 当前语言翻译函数
 */
export function formatJobStepLabel(metrics: JobMetricsEvent | undefined, t: Translate) {
  if (!metrics) {
    return t("jobStep.transcoding");
  }

  if (metrics.stepCode === "ffmpeg_transcode") {
    return metrics.stepCount > 1
      ? t("jobStep.ffmpegTranscodePhase", {
        current: metrics.stepIndex,
        total: metrics.stepCount,
      })
      : t("jobStep.ffmpegTranscode");
  }

  const key = metrics.stepCode ? JOB_STEP_KEYS[metrics.stepCode] : undefined;
  if (key) {
    return t(key);
  }

  // 旧后端没有 stepCode 时使用通用本地化描述，避免把中文 stepLabel 泄漏到英文界面。
  return metrics.stepCount > 1
    ? t("jobStep.genericPhase", {
      current: metrics.stepIndex,
      total: metrics.stepCount,
    })
    : t("jobStep.transcoding");
}
