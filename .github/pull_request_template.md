## Summary

<!-- What user-visible problem does this change solve? -->

## Root cause and approach

<!-- Explain the root cause, the chosen boundary, and why this is the smallest complete fix. -->

## Compatibility and risk

<!-- Note affected platforms, codecs, containers, storage, updater behavior, or migration concerns. -->

## Validation

- [ ] `bun run check`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Relevant manual workflow tested
- [ ] Documentation reviewed and updated when behavior changed

## Screenshots

<!-- Required for material UI changes; remove this section otherwise. -->

## Privacy checklist

- [ ] No private media, secrets, signing keys, full local paths, or unredacted logs are included.
