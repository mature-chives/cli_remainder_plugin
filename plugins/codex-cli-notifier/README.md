# CLI Reminder

在 Codex CLI、Claude Code 或 Grok Build 等待权限确认、完成当前 turn 或结束后台 agent 时，发送带声音的原生桌面通知。

## 事件映射

| CLI | Hook 事件 | 通知行为 |
| --- | --- | --- |
| Codex | `PermissionRequest` | 立即提醒等待权限确认 |
| Codex | `Stop` | 提醒当前 turn 已完成 |
| Claude Code | `PermissionRequest` | 立即提醒等待权限确认 |
| Claude Code | `Notification` | 兼容延迟的 `permission_prompt` 和后台 `agent_completed` |
| Claude Code | `Stop` | 提醒当前 turn 已完成 |
| Grok Build | `Notification` | 提醒权限/输入通知和后台完成通知 |
| Grok Build | `Stop` | 提醒当前 turn 已完成 |

Claude Code 可能在 `PermissionRequest` 后约六秒再次发出 `permission_prompt`。插件会按 session 去重，同一次权限请求只提醒一次。Grok Build 使用 camelCase Hook 输入，插件会自动转换。

Codex 设置 `approvals_reviewer = "auto_review"`（界面中的 **Approve for me**）时，插件默认不发送 `PermissionRequest` 通知，避免自动审批的每条命令都响；`Stop` 任务完成通知不受影响。若希望自动审批时仍提醒：

```bash
export CLI_REMINDER_NOTIFY_AUTO_APPROVALS=1
```

这个过滤只作用于 Codex，不改变 Claude Code 和 Grok Build 的通知行为。

## 跨平台实现

通知核心是无第三方 npm 依赖的 Node.js 脚本，通过 CLI 提供的插件根目录变量定位自身，不依赖固定安装路径：

- macOS：`osascript` JXA + `afplay`。
- Linux：`notify-send`；声音优先使用 `canberra-gtk-play`，其次使用 `paplay` 或通知声音 hint。
- Windows：PowerShell + `System.Windows.Forms.NotifyIcon`。

需要 Node.js 18 或更高版本。Windows 需要 PowerShell；Ubuntu/Debian 通常还需安装提供 `notify-send` 的系统包。

旧入口 `scripts/codex_notify.py` 仍然保留，会转发到共享 Node.js 核心，以兼容此前的手动配置。

## 声音设置

默认启用声音。统一环境变量是 `CLI_REMINDER_SOUND`：

```bash
export CLI_REMINDER_SOUND=Glass
```

macOS 可换成 `Ping`、`Pop` 等系统声音。关闭声音：

```bash
export CLI_REMINDER_SOUND=none
```

Windows PowerShell 中使用：

```powershell
$env:CLI_REMINDER_SOUND = "none"
```

需要在启动对应 CLI 前设置环境变量。旧的 `CODEX_NOTIFIER_SOUND` 仍受支持，但 `CLI_REMINDER_SOUND` 优先。

## 隐私与可靠性

- 权限通知只读取工具名称和可选 `description`，不会显示原始命令参数。
- 完成通知最多显示 240 个字符的助手摘要。
- Hook 异步运行，异常、缺少桌面组件或通知失败都会静默退出，不改变权限或任务流程。

## 测试

```bash
node --test tests/test_cli_notify.js
node scripts/cli_notify.js --self-test --product "CLI Reminder"
```

第二条命令会实际发送一条带声音的桌面通知。macOS 首次运行时，可能需要在“系统设置 > 通知”中允许相关通知和声音。

验证三套插件格式：

```bash
claude plugin validate .
grok plugin validate .
```

## 插件清单

- Codex：`.codex-plugin/plugin.json` + `hooks/hooks.json`
- Claude Code：`.claude-plugin/plugin.json` + `hooks/claude-hooks.json`
- Grok Build：直接使用 Claude Code 兼容清单和 Hook
