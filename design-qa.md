# Pro Inspector Design QA

## Findings

- No actionable P0/P1/P2 findings remain.
- P3 intentional deviation: the implementation preserves the real 16:9 preview frame instead of stretching it to the taller generated reference slot.
- P3 follow-up: the redesigned professional copy is complete in Chinese, but English i18n parity is not yet release-complete.

## Source Visual Truth

- Path: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-source-1487x1058.png`
- Direction: selected Pro Inspector option 1.
- Target state: dark desktop professional transcoding workbench with source facts, one-frame comparison, deterministic output validation and a persistent parameter inspector.
- Viewport: `1487 x 1058`.

## Implementation Evidence

- Prototype URL: `http://localhost:1420/workbench`
- Final browser screenshot: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-implementation-pass-6.jpg`
- Viewport: `1487 x 1058`.
- State: browser QA source `Travel_2024_Film.mov`, HDR10, H.265/libx265, CRF 23, source resolution/FPS, 10-bit pixel format, MP4 output.
- Responsive evidence: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-1024x768.jpg` and `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-390x844.jpg`; DOM measurements showed no horizontal overflow at either width.
- Native evidence: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-native-dv-safe-end.png`, using a real Dolby Vision Profile 5 source at the safe end position `60.816 / 61.216s`.

## Full-view Comparison Evidence

- Combined source/implementation input: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-comparison-pass-6.jpg`
- The implementation matches the source hierarchy: compact left navigation, source/plan context row, source fact strip, dominant split preview, deterministic output bar and a full-height right inspector.
- The primary CTA remains visible without scrolling at the target desktop viewport.

## Focused Region Comparison Evidence

- Workbench/preview region: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-focus-workbench-pass-6.jpg`
- Parameter inspector region: `/Users/igmainc/Projects/encode-lab/design-qa-artifacts/pro-inspector-focus-inspector-pass-6.jpg`
- The implementation intentionally uses native switches, selects, slider and scroll containment from the existing component system while retaining the reference density and alignment.

## Primary Interactions Tested

- Video, Audio, Color/HDR and Output tabs open and retain the same task context.
- Parameter tabs support roving focus plus ArrowLeft/ArrowRight/Home/End keyboard navigation.
- CRF and structured video controls update the live task snapshot and output validation.
- `Copy` collapses all re-encode controls, emits `COPY · copy`, and removes rate, scale, FPS, pixel-format and color re-encode semantics.
- Invalid clip input (`start=10`, `end=5`) produces a blocking error and disables enqueue instead of silently converting to full-duration output.
- Template application returns to the workbench while preserving source, task name, clip range and output directory.
- Inline save-plan UI opens; browser mode returns an explicit Tauri-boundary error instead of pretending to persist.
- Legacy `/source`, `/task-config` and `/preview` routes redirect to `/workbench`.
- Browser fullscreen action returns an explicit desktop-host boundary message.
- Jobs, Templates and Settings routes render their redesigned professional inspector views.
- Browser console warnings/errors after the final interaction pass: `[]`.

## Native End-to-End Evidence

- Imported `/Users/igmainc/Downloads/encode-lab-dv-e2e/test-p5-first-minute.mkv` through the latest debug bundle.
- Profile 5 ordinary re-encode is blocked and the enqueue CTA is disabled while RPU preservation is off.
- Enabling Dolby Vision RPU preservation locks H.265/libx265, MKV, source resolution/FPS, complete duration, 10-bit output and Profile 5 color matrix requirements; validation then passes.
- Pressing End on the preview timeline resolves to `60.816s`, leaving ten source frames of guard space, and successfully renders a real source/output comparison.
- Independent Tauri fullscreen preview opens with the current frame, split position, direction and timestamp, and closes back to the main workbench.
- No real job was enqueued and no test template was persisted during QA.

## Fidelity Surfaces

- Typography: Geist remains the product font; hierarchy, small-label density and monospace parameter values follow the selected reference.
- Spacing: compact 160px navigation, 12px workbench gaps, narrow fact rows and a 460px inspector preserve a professional information density.
- Color: existing semantic tokens provide neutral dark surfaces, blue actions, green readiness, amber warnings and destructive blocking errors.
- Assets: preview imagery uses real raster assets in browser QA and real FFmpeg-generated frames in Tauri; no CSS art or fake estimate is used.
- Product semantics: the workbench separates source facts, adjustable parameters, preview evidence and deterministic output facts. Unknown size/time remains explicitly unknown.

## Comparison History

1. Pass 1 — P1 layout: the full-width source summary pushed the inspector below the preview and the primary CTA fell off-screen. Fixed with the desktop `minmax(0, 1fr) / 460px` workbench grid. Evidence: `pro-inspector-implementation-pass-1.jpg` and `pro-inspector-comparison-pass-1.jpg`.
2. Pass 2 — P1 viewport hierarchy: the inspector became persistent and the CTA returned to the first viewport. Focused inspection then exposed HDR defaults that still allowed 8-bit/BT.709 output for HDR sources. Evidence: `pro-inspector-implementation-pass-2.jpg` and `pro-inspector-comparison-pass-2.jpg`.
3. Native E2E — P1 EOF failure: exact-duration preview could produce an FFmpeg-successful but undecodable container header. Fixed at the root with an eight-frame sample plus two-frame guard and actionable retry/details UI. Final native evidence is `pro-inspector-native-dv-safe-end.png`.
4. Parameter-flow audit — P1 correctness: invalid clip ranges, non-finite values, stale source metadata and stream-copy/re-encode mixing could bypass visual intent. Fixed with immediate metadata invalidation, centralized finite/range policy, handler-level revalidation and canonical Copy semantics in both frontend and Rust command generation.
5. Pass 6 — final visual and interaction comparison. No actionable P0/P1/P2 differences remain. Evidence: `pro-inspector-comparison-pass-6.jpg`, `pro-inspector-focus-workbench-pass-6.jpg` and `pro-inspector-focus-inspector-pass-6.jpg`.

## Implementation Checklist

- [x] Unified `/workbench` professional flow.
- [x] Adjustable professional video/audio/color/output parameters.
- [x] Real source/output single-frame comparison.
- [x] Persistent enqueue action and deterministic validation.
- [x] No fabricated size, time, speed or quality estimate.
- [x] HDR/Dolby Vision safeguards and source-profile constraints.
- [x] Stream-copy semantics separated from re-encode controls.
- [x] Template save/apply task-boundary semantics.
- [x] Job, template and environment inspector pages.
- [x] Browser and Tauri host boundaries are explicit.
- [x] Desktop, compact and mobile viewport checks.
- [x] Browser console clean.
- [x] Latest Tauri debug bundle built and exercised with a real Profile 5 source.

## Follow-up Polish

- P3: complete English translations for all new Pro Inspector copy before making English a release requirement.
- P3: split the roughly 591 kB frontend bundle by route if startup profiling shows a real need.

final result: passed
