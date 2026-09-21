# Changelog · DSH Scriptor (v8)

此处记录 DSH 工作台安装包版本。v6 的更新记录保留在 master 分支。

## Unreleased

尚无未发布变更。

## [0.1.0-preview.1] — 2026-09-20

首个面向公开安装的开发预览版。

### Added

- 本地小说书仓、作品设计、章细纲、写稿、审读、改稿、定稿与记忆流程。
- 原生书房编辑、定稿检索、章节/关联视图和定稿导出。
- 卷摘要候选、卷末核对及暂停后的文件状态恢复。
- 公开源码构建、自动化检查、安装包校验、贡献规范与使用教程。

### Packaging

- 主包 `@linfengqaqtat/dsh-scriptor`，运行技能与脚本随包交付。
- 可选 `@webnovel/embedding-provider` 0.0.8：嵌入、场景识别与重排；首次安装默认停用。
- 继承 GPL-3.0-only，补齐实际内联依赖的许可证与源码材料。

### Compatibility

- Windows；Node 22.19.0 起的 22.x 或 24.x，推荐 24.15.0；源码构建 pnpm 9.0.0，宿主插件管理 pnpm 11.7.0；DSH 0.1.5-rc.2。
- 预览期配置与书仓契约可能变化，升级前备份。v6/v7 书仓没有自动迁移承诺。
- tarball 使用无空格安装路径；主包保留 npm 发布保护，通过 GitHub Release 分发。

### Known limitations

- Linux/macOS 尚未完成产品安装和浏览器验收。
- API 连接、模型效果、速率限制和账单由所选服务决定；单元测试不代表真实模型质量。
- 不支持把 Web 工作台未经保护地直接暴露到公网。
