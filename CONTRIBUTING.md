# Contributing to Encode Lab

Thanks for helping improve Encode Lab. Contributions are welcome across product behavior, FFmpeg correctness, Rust lifecycle management, frontend accessibility, documentation, testing, and platform packaging.

## Before opening an issue

1. Search existing issues and recent releases.
2. Confirm whether the behavior occurs in the latest release or current `main`.
3. Remove private media, local paths, tokens, signing material, and identifying metadata from screenshots and logs.
4. For a suspected vulnerability, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

Questions about unsupported media combinations are easier to investigate when the report includes redacted `ffprobe` stream and format output.

## Development setup

Required tooling:

- Bun as declared by the `packageManager` field in `package.json`;
- stable Rust with `rustfmt` and `clippy`;
- platform dependencies from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/iGmainC/encode-lab.git
cd encode-lab
bun install --frozen-lockfile
bun run tauri dev
```

The first desktop build downloads a checksummed runtime from [encode-lab-ffmpeg](https://github.com/iGmainC/encode-lab-ffmpeg). Set `ENCODE_LAB_FFMPEG_SKIP=1` only when the work does not require a packaged runtime and a compatible system FFmpeg is already available.

## Where to start

| Area | Primary paths |
| --- | --- |
| Workbench and UI policy | `src/pages/ProfessionalWorkbenchPage.tsx`, `src/components/workbench/`, `src/lib/workbenchPolicy.ts` |
| Preview lifecycle | `src/components/workbench/ComparePreviewPlayer.tsx`, `src-tauri/src/preview/` |
| Command construction | `src-tauri/src/transcode/command_builder.rs`, `src-tauri/src/ffmpeg_args.rs` |
| Queue and recovery | `src-tauri/src/transcode/job_manager.rs` |
| Storage | `src-tauri/src/storage/` |
| Product and compatibility rules | `docs/ffmpeg-v1-功能规格.md`, `docs/产品业务逻辑与功能模块调整.md` |
| Release automation | `.github/workflows/`, `scripts/resolve-release-version.ts`, `docs/releasing.md` |

Keep checkout-specific Dolby Vision rules scoped to Encode Lab's current x265/RPU pipeline. A result observed in this application is not automatically a universal statement about the codec.

## Making a change

- Start from the latest `main` and keep the change focused.
- Fix the root cause and review adjacent paths for the same failure mode.
- Reuse existing components and service boundaries.
- Add Chinese comments and JSDoc where logic, lifecycle, or business constraints are not obvious.
- Do not commit source media, generated runtime binaries, signing keys, local application data, or build output.
- Use conventional commits, for example `fix(preview): 回收迟到的预览帧`.
- Update existing documentation when behavior, compatibility boundaries, or the release process changes.

## Validation

Run the checks that match the affected area. The minimum pull-request gate is:

```bash
bun run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Changes to media compatibility should include focused command-builder or policy tests. Changes to process lifecycle or garbage collection should include cancellation, failure, and recovery coverage where practical.

## Pull requests

A useful pull request:

- explains the user-visible problem and root cause;
- describes compatibility or migration impact;
- lists the exact checks performed;
- includes before/after screenshots for material UI changes;
- keeps unrelated cleanup out of the patch;
- does not include secrets or private media.

By submitting a contribution, you agree that it may be distributed under the project's [MIT License](./LICENSE).
