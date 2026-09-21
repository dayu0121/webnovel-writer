# 备份、升级与卸载

## 备份两类资产

停止相关实例，再分别备份：

- 作品工作目录：书仓全部文件、书仓 `.git`、草稿区以及工作范围内的书房素材。书仓 Git 不能代替包含草稿和书房内容的完整备份。
- DSH home：profile 配置、设置及需要保留的会话。它可能包含凭据，备份应私下加密保管，不能提交公共仓库。

记录主包、可选包、DSH 和 Node 版本。插件源码仓库与小说书仓是不同目录，不要误把其中一个当作另一个的备份。

## 更新

1. 阅读目标版本的 Compatibility、已知问题与迁移说明。
2. 完成备份，停止指定 profile 的运行实例。
3. 下载并校验新 `.tgz`，向同一个 profile 安装该精确版本，随后重启。
4. 检查书房入口、技能是否各一份，核对实际书仓状态；先用合成副本试写。

```powershell
dsh plugin --profile scriptor add C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.1.tgz
dsh --profile scriptor --dump-config
```

上面展示命令形状，更新时换成实际目标版本文件。不要用同版本不同内容的包覆盖，也不要同时保留开发 file patch。

## 回退

代码回退与数据回退不同。目标版本若改变书仓格式，安装旧包不能自动还原已经迁移的数据。停止实例，保存故障现场，按发行说明使用兼容旧包与对应完整备份恢复；未提供迁移/回退证据时不要在唯一原稿上尝试。

本预览版不支持自动迁移 v6/v7 书仓。

## 卸载与重装

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor
dsh --profile scriptor --dump-config
```

卸载移除插件及其配置贡献，不删除作者书仓、书房或已有模型凭据。确认配置已无主包后，可重新按安装教程添加；可选 embedding-provider 需要单独卸载。
