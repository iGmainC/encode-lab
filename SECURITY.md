# Security policy

## Supported versions

Encode Lab is currently beta software. Security fixes are applied to the latest release line and `main`; older beta releases may not receive backports.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private reporting form:

https://github.com/iGmainC/encode-lab/security/advisories/new

Please include:

- affected version or commit;
- platform and architecture;
- impact and realistic attack scenario;
- minimal reproduction steps or proof of concept;
- whether untrusted media, paths, templates, or advanced arguments are required;
- any suggested mitigation.

Do not attach private source media unless explicitly requested through a secure channel. Prefer a synthetic reproducer and redacted logs.

The maintainer will aim to acknowledge a report within 7 days, confirm the initial assessment within 14 days, and coordinate disclosure after a fix is available. These are targets rather than contractual response times.

## Security boundaries

Encode Lab processes untrusted media through native command-line tools. The project therefore treats the following as security-sensitive:

- FFmpeg/FFprobe, x265, and dovi_tool versioning and provenance;
- command-line argument validation and prevention of additional input/output injection;
- local path validation and controlled temporary directories;
- updater signatures and public release-asset integrity;
- process cancellation, partial-file publication, and crash recovery;
- accidental disclosure of local paths or media metadata in diagnostics.

The bundled runtime is downloaded from a versioned public release and verified against a pinned SHA-256 before packaging. Updater bundles are signed separately through Tauri's updater signing mechanism.

## Out of scope

Reports that only describe unsupported codecs, expected quality loss from lossy encoding, or local denial of service from intentionally enormous trusted inputs may be handled as ordinary bugs unless they cross a security boundary.
