# Encode Lab 发布手册

本文档面向项目维护者，描述 GitHub Release、Tauri updater 和安装包校验的唯一正式发布路径。日常开发不需要发布密钥。

## 发布链路

```text
main 上的签名 tag
  → 校验 tag 格式和 main 归属
  → 前端测试/构建 + Rust fmt/clippy/test
  → macOS Apple Silicon 与 Linux x86_64 并行构建
  → Tauri updater 签名并发布 Release
  → 校验 latest.json、签名和匿名下载
  → 生成并上传 SHA256SUMS
```

发布工作流只监听 `v*` tag，版本解析脚本进一步限制为：

- `vX.Y.Z`
- `vX.Y.Z-beta`

Tauri 构建版本由 tag 注入，不需要在发布提交里临时修改配置文件。

## 一次性配置

### Updater 签名

仓库 Actions Secrets 必须包含：

| Secret | 必需 | 用途 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 是 | 对 updater 安装包签名 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 视密钥而定 | 解密受密码保护的私钥 |

公钥写在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 中，可以公开；私钥只能保存在 GitHub Actions Secrets 和维护者的安全备份中。

如需轮换密钥，必须先发布同时信任新公钥的过渡版本，再用新私钥签后续版本。直接替换公钥会让尚未升级的客户端无法验证新版本。

### macOS 签名边界

当前社区构建使用 Tauri 配置中的 ad-hoc 签名，不是 Apple Developer ID 签名，也不执行公证。README 和 Release Notes 不得把这类构建描述为“已认证”或“已公证”。

未来接入 Developer ID 时，应同时补齐证书、Apple 凭据、公证步骤和真实安装验证，再调整公开说明。

## 发布前检查

1. 确认目标提交已经进入 `main`，工作区没有遗漏的发布改动。
2. 确认 CI 通过。
3. 根据改动检查 README、兼容边界、第三方声明和 Release Notes 分类。
4. 本地执行与 CI 一致的门禁：

```bash
bun install --frozen-lockfile
bun run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

5. 先验证准备发布的版本：

```bash
bun run release:version -- v0.1.0-beta
```

## 创建发布

推荐创建 GPG 或 SSH 签名 tag：

```bash
git switch main
git pull --ff-only origin main
git tag -s v0.1.0-beta -m "Encode Lab v0.1.0-beta"
git push origin v0.1.0-beta
```

推送 tag 后，`.github/workflows/release.yml` 自动完成发布。不要手动上传同名安装包，也不要在工作流运行期间编辑 Release。

当前 updater 固定访问：

```text
https://github.com/iGmainC/encode-lab/releases/latest/download/latest.json
```

因此，即使版本名带 `-beta`，GitHub Release 也必须保持普通 Release，而不能标记为 GitHub Prerelease；否则 `/releases/latest` 不会指向它。Beta 状态由 SemVer 后缀、README 警告和 Release 文案表达。

## 发布验收

工作流变绿后仍应完成一次人工验收：

- Release 对应的 tag 与预期提交一致；
- macOS 与 Linux 安装资产都存在；
- `latest.json`、updater `.sig` 文件和 `SHA256SUMS` 存在；
- 未登录 GitHub 的环境可以下载 `latest.json` 和安装包；
- `SHA256SUMS` 能校验下载文件；
- 在至少一个目标平台完成启动、打开素材、生成预览和开始/取消短任务；
- 应用内更新检查能识别新版本。

Linux 可使用：

```bash
sha256sum --check SHA256SUMS
```

macOS 可按清单中的单个文件执行：

```bash
shasum -a 256 "<下载文件>"
```

## 失败与恢复

### tag 尚未推送

修复问题、重新执行门禁，再在正确提交上创建 tag。

### 工作流失败且 Release 尚未被用户消费

先定位失败阶段：

- `Verify release tag`：tag 格式错误或不在 `main` 历史；
- `Release quality gate`：代码、格式、测试或构建失败；
- `Build`：平台依赖、runtime 下载、签名或打包失败；
- `Verify updater release assets`：Release 不完整、签名缺失或公开下载不可达。

只有确认不存在已发布、已下载或已被 updater 发现的资产时，才可以删除不完整 Release 和远端 tag，修复后重新创建。不要移动一个已经公开使用的 tag。

### 已公开版本存在问题

不要覆盖安装包、移动 tag 或重写 `latest.json`。在 `main` 修复根因，递增补丁版本并发布新的 tag。必要时在问题 Release 顶部添加警告，并保留资产供问题追踪和校验。

如果问题涉及密钥泄露，立即停止发布、吊销相关凭据，并按 updater 密钥轮换方案准备过渡版本。

## 版本与渠道约定

- `vX.Y.Z-beta`：当前默认渠道，允许产品和兼容边界继续收敛；
- `vX.Y.Z`：稳定版本，必须完成目标平台安装和 updater 验收；
- 已发布版本不可复用；
- 不从临时分支发布；
- 不用手工 Release 绕过质量门禁。
