# CLI Reminder Plugin Marketplace

为 Codex CLI、Claude Code 和 Grok Build 提供带声音的系统桌面通知，支持 macOS、Windows 和 Linux。

通知场景：

- 等待权限确认。
- 当前 turn 或后台 agent 完成。
- Hook 异步执行；通知失败不会批准、拒绝或阻塞 CLI。
- Codex 使用 **Approve for me** 自动审批时，不提醒每条权限请求。

插件源码位于 [`plugins/codex-cli-notifier`](./plugins/codex-cli-notifier)。为兼容已有 Codex 安装，Codex 插件 ID 继续使用 `codex-cli-notifier`；Claude Code 和 Grok Build 中显示为 `cli-reminder`。

## 环境要求

- Node.js 18 或更高版本。
- macOS：系统自带通知与声音组件。
- Windows：PowerShell 5.1 或 PowerShell 7。
- Linux：需要 `notify-send`；声音可选安装 `canberra-gtk-play` 或 `paplay`。

## 从 GitHub 安装

### Codex CLI

```bash
codex plugin marketplace add mature-chives/cli_remainder_plugin
codex plugin add codex-cli-notifier@cli-reminder-local
```

新开 Codex session，执行 `/hooks`，审查并信任 `PermissionRequest` 和 `Stop`。

### Claude Code

```bash
claude plugin marketplace add mature-chives/cli_remainder_plugin
claude plugin install cli-reminder@cli-reminder-marketplace
```

重启 Claude Code，或在现有 session 执行 `/reload-plugins`。首次启用插件 Hook 时按提示完成信任确认。

### Grok Build

```bash
grok plugin install 'mature-chives/cli_remainder_plugin#plugins/codex-cli-notifier'
```

安装确认时选择信任；自动化安装可追加 `--trust`。重新启动 Grok Build 后，可在 `/hooks` 或 `/plugins` 中检查加载状态。

## 克隆后本地安装

```bash
git clone https://github.com/mature-chives/cli_remainder_plugin.git
cd cli_remainder_plugin

codex plugin marketplace add .
codex plugin add codex-cli-notifier@cli-reminder-local

claude plugin marketplace add .
claude plugin install cli-reminder@cli-reminder-marketplace

grok plugin install ./plugins/codex-cli-notifier
```

声音配置、事件映射、测试命令和平台细节见[插件说明](./plugins/codex-cli-notifier/README.md)。
