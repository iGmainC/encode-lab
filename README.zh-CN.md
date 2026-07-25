<p align="center">
  <img src="./app-icon.svg" width="96" alt="Encode Lab 图标" />
</p>

<h1 align="center">Encode Lab</h1>

<p align="center">
  一个本地优先、以真实转码证据驱动决策的桌面视频转码工作台。
</p>

<p align="center">
  在约束保护下配置参数，对比真实编码帧，再把确认后的任务交给可恢复的 FFmpeg 队列。
</p>

<p align="center">
  <a href="https://github.com/iGmainC/encode-lab/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/iGmainC/encode-lab/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/iGmainC/encode-lab/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/iGmainC/encode-lab?include_prereleases&sort=semver" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f766e.svg" /></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong> ·
  <a href="https://github.com/iGmainC/encode-lab/releases/latest">下载</a> ·
  <a href="./CONTRIBUTING.md">参与贡献</a>
</p>

> [!IMPORTANT]
> Encode Lab 仍处于 Beta 阶段。确认输出文件无误前请保留源素材；重要素材建议先截取短片段验证完整流程。

![Encode Lab 工作台](./design-qa-artifacts/pro-inspector-implementation-pass-6.jpg)

## 为什么做 Encode Lab？

很多 FFmpeg 图形界面停留在“把参数做成表单”。Encode Lab 更关注长时间转码开始前的真实决策：

1. 看懂素材规格和本机能力。
2. 在 Codec、容器、音频、HDR 和轨道保留约束下配置输出。
3. 真实编码一帧并与源帧对比，而不是展示表面滤镜效果。
4. 入队前确认可确定的输出事实和风险。
5. 在同一套本地流程里观察、取消、恢复任务并复盘结果。

应用完全在本机运行。素材路径、任务历史、方案、预览帧和命令输出不会上传到 Encode Lab 托管服务。

## 核心能力

- **统一专业工作台**：素材检查、视频/音频/HDR 参数、按帧对比、输出校验和入队动作保持在同一上下文。
- **用证据确认参数**：预览链路按当前参数编码单帧、重新解码，再提供源图与输出图的分割线对比。
- **能力驱动配置**：根据当前 runtime 探测可用编码器和限制，不把未验证的组合展示成承诺。
- **可恢复本地队列**：FIFO、可配置并发、实时指标、取消、异常退出恢复和最终输出原子发布。
- **Dolby Vision 边界保护**：专用 RPU 保留链路会在发布前校验源片、容器、全部轨道、输出元数据、帧数和逐帧 RPU 语义。
- **确定性运行环境**：受支持平台的正式包内置经过摘要校验的 FFmpeg/FFprobe、x265 CLI 和 dovi_tool。
- **本地参数方案**：保存与具体素材、输出目录解耦的参数快照。
- **中英文与明暗主题**。

## 支持平台

| 平台 | 正式发布目标 | 内置 runtime | 说明 |
| --- | --- | --- | --- |
| Apple Silicon，macOS 15+ | 支持 | 支持 | 除非 Release 明确说明已公证，否则使用 ad-hoc 签名。 |
| Linux x86_64，glibc 2.35+ | 支持 | 支持 | 发布流程生成 AppImage、Debian 和 RPM 包。 |
| Windows | 当前发布矩阵不支持 | 不支持 | 代码保留跨平台基础，但目前不提供受支持的 Windows 正式包。 |
| Intel Mac | 当前发布矩阵不支持 | 不支持 | 当前 runtime 基线为 Apple Silicon。 |

安装包、updater 签名和 `SHA256SUMS` 清单发布在 [GitHub Releases](https://github.com/iGmainC/encode-lab/releases/latest)。

### macOS 首次启动

当前社区构建使用 ad-hoc 签名且未经过 Apple 公证。首次启动时，macOS 可能要求你在**系统设置 → 隐私与安全性**中明确允许打开。

### Linux AppImage

```bash
chmod +x ./<下载文件>.AppImage
./<下载文件>.AppImage
```

## Dolby Vision 支持边界

Encode Lab 不会宣称所有 Dolby Vision 素材都能安全重编码。当前专用保留链路有意保持严格：

- 单层 Profile 5 / compatibility ID 0，或 Profile 8 / compatibility ID 1；
- 必须包含 BL + RPU，不能包含 EL；
- 10-bit、恒定帧率 HEVC；
- 不允许裁剪、缩放、变帧率、截取或 2-pass；
- MKV 用于保留完整轨道语义；
- MP4 只开放已验证的 Profile 8.1 路线和兼容音频 Copy，不能包含字幕、附件、data、TrueHD、DTS 或 PCM。

不支持的组合会在入队前被明确拒绝。完整且仅适用于本项目实现的规则见 [V1 功能规格](./docs/ffmpeg-v1-%E5%8A%9F%E8%83%BD%E8%A7%84%E6%A0%BC.md)。

## 本地开发

### 前置条件

- 与 `package.json` 声明一致的 [Bun](https://bun.sh/)
- 当前稳定版 [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 2 平台依赖](https://v2.tauri.app/start/prerequisites/)
- 首次桌面构建时可联网下载经过摘要校验的 Encode Lab FFmpeg runtime

### 启动桌面应用

```bash
git clone https://github.com/iGmainC/encode-lab.git
cd encode-lab
bun install --frozen-lockfile
bun run tauri dev
```

只做界面开发时也可以启动浏览器模式：

```bash
bun run dev -- --host localhost
```

浏览器模式使用有明确标记的示例数据，不提供桌面端写入、原生窗口和真实转码队列能力。

### 验证修改

```bash
bun run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

GitHub Actions 会在 Pull Request 和 `main` 推送时重复执行前端检查与 Rust 跨平台测试。

## 技术结构

```text
React + TypeScript
  ├─ 工作台与参数策略
  ├─ 按帧对比与前端状态
  └─ Tauri 命令/事件边界
               │
Rust + Tauri
  ├─ 媒体探测与能力识别
  ├─ 预览子进程生命周期
  ├─ 命令与专用执行计划
  ├─ FIFO 队列与异常恢复
  └─ 原子 JSON 存储
               │
内置命令行 runtime
  └─ FFmpeg · FFprobe · x265 · dovi_tool
```

持久数据写入平台应用数据目录；预览帧、质量评估日志、passlog、partial 文件和多阶段工作区进入系统临时目录并主动回收。

## 发布流程

发布 tag 只接受 `vX.Y.Z` 或 `vX.Y.Z-beta`：

```bash
bun run release:version -- v0.1.0-beta
git tag -s v0.1.0-beta -m "Encode Lab v0.1.0-beta"
git push origin v0.1.0-beta
```

Release 工作流会验证 tag 位于 `main` 历史、执行质量门禁、构建受支持平台安装包、签名 updater 资产、生成 Release Notes，并校验 `latest.json`、签名和匿名下载地址。维护者配置与回滚流程见 [docs/releasing.md](./docs/releasing.md)。

## 项目文档

- [产品主流程与模块边界](./docs/%E4%BA%A7%E5%93%81%E4%B8%9A%E5%8A%A1%E9%80%BB%E8%BE%91%E4%B8%8E%E5%8A%9F%E8%83%BD%E6%A8%A1%E5%9D%97%E8%B0%83%E6%95%B4.md)
- [V1 产品与技术规格](./docs/ffmpeg-v1-%E5%8A%9F%E8%83%BD%E8%A7%84%E6%A0%BC.md)
- [开发路线与验收清单](./docs/development-roadmap.md)
- [分布式转码探索](./docs/%E8%8A%82%E7%82%B9%E6%8B%93%E5%B1%95%E4%B8%8E%E5%88%86%E5%B8%83%E5%BC%8F%E8%BD%AC%E7%A0%81%E8%AE%BE%E8%AE%A1.md)

## 贡献与安全

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)；安全问题请按 [SECURITY.md](./SECURITY.md) 使用 GitHub 私密漏洞报告。

请勿在公开 Issue 中上传私人素材、完整本机路径、签名密钥或未经脱敏的 FFmpeg 日志。

## 许可证

Encode Lab 源代码使用 [MIT License](./LICENSE)。

正式安装包包含采用独立许可证的命令行工具，其中内置 FFmpeg runtime 启用了 GPL 组件。适用条款和源码引用见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 与可复现构建仓库 [encode-lab-ffmpeg](https://github.com/iGmainC/encode-lab-ffmpeg)。
