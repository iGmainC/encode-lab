import { describe, expect, test } from "bun:test";
import { translations, type TranslationKey } from "../i18n/translations";
import type { JobMetricsEvent } from "../types/workbench";
import { formatJobStepLabel } from "./jobMetrics";

/** 使用英文词典构造最小翻译函数。 */
function translateEnglish(key: TranslationKey, params?: Record<string, string | number>) {
  return (translations["en-US"][key] ?? key).replace(
    /\{\{(\w+)}}/g,
    (_, name: string) => String(params?.[name] ?? ""),
  );
}

/** 构造任务指标，保留后端中文 label 以验证前端不会直接泄漏它。 */
function buildMetrics(overrides: Partial<JobMetricsEvent> = {}): JobMetricsEvent {
  return {
    jobId: "job-1",
    stepIndex: 1,
    stepCount: 1,
    stepLabel: "提取源 RPU 动态元数据",
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("job metrics localization", () => {
  test("uses the stable step code instead of the backend language label", () => {
    expect(formatJobStepLabel(
      buildMetrics({ stepCode: "dv_extract_source_rpu" }),
      translateEnglish,
    )).toBe("Extract source RPU metadata");
  });

  test("uses a localized generic phase for legacy events without a step code", () => {
    expect(formatJobStepLabel(
      buildMetrics({ stepIndex: 2, stepCount: 3 }),
      translateEnglish,
    )).toBe("Execution stage 2/3");
  });
});
