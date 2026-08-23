# CLI Reminder Plugin Marketplace

这是一个可在 macOS、Windows 和 Linux 使用的 Codex 本地 marketplace。插件源码位于 [`plugins/codex-cli-notifier`](./plugins/codex-cli-notifier)。

插件通过 lifecycle hooks 监听：

- `PermissionRequest`：Codex 即将请求权限时通知。
- `Stop`：Codex 完成当前 turn 时通知。

## 当前电脑安装

```bash
codex plugin marketplace add /Users/shao/ClaudeCode/cli_remainder_plugin
codex plugin add codex-cli-notifier@cli-reminder-local
```

重新启动 Codex CLI，在新会话中执行 `/hooks`，审查并信任插件的两个 hooks。

## 在其他电脑使用

把整个仓库复制或通过 Git 克隆到目标电脑，然后在目标电脑运行：

```bash
codex plugin marketplace add /absolute/path/to/cli_remainder_plugin
codex plugin add codex-cli-notifier@cli-reminder-local
```

如果以后推送到 GitHub，也可以直接添加仓库：

```bash
codex plugin marketplace add owner/repository
codex plugin add codex-cli-notifier@cli-reminder-local
```

每台电脑首次安装或 hooks 发生变化后，都需要在新的 Codex 会话中执行 `/hooks` 重新审查和信任。

平台依赖和声音配置见[插件说明](./plugins/codex-cli-notifier/README.md)。
