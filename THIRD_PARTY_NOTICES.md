# Third-party notices

Encode Lab source code is licensed under the [MIT License](./LICENSE). Official application bundles also contain third-party software that remains subject to its own license terms.

## Encode Lab FFmpeg runtime

Supported release bundles include a separately built command-line runtime containing:

- FFmpeg and FFprobe;
- x265 CLI;
- dovi_tool;
- the libraries linked into those tools.

The runtime enables GPL components, including x264/x265 support. The resulting FFmpeg binaries are therefore distributed under the applicable GPL terms recorded by the runtime project; they are not relicensed under Encode Lab's MIT License.

The corresponding build scripts, exact versions, configure flags, manifests, checksums, legal notes, and source references are maintained in the public [iGmainC/encode-lab-ffmpeg](https://github.com/iGmainC/encode-lab-ffmpeg) repository. A copy of the runtime legal notice and manifest is included in each runtime archive and application resource bundle.

Encode Lab's runtime build policy does not permit FFmpeg's `--enable-nonfree` option.

## JavaScript and Rust dependencies

Frontend and Rust dependencies remain subject to the license declared by each upstream package. Their exact resolved versions are recorded in `bun.lock` and `src-tauri/Cargo.lock`.

This notice is an engineering summary, not legal advice. If a generated bundle and this file disagree, the license files shipped with the relevant third-party component govern that component.
