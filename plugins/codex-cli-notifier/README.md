# CLI Reminder

在 Codex CLI、Claude Code 或 Grok Build 等待权限确认或完成任务时播放可分别配置的声音，不显示不可操作的桌面通知横幅。

## 事件映射

| CLI | Hook 事件 | 通知行为 |
| --- | --- | --- |
| Codex | `PermissionRequest` | 播放权限声音 |
| Codex | `Stop` | 当前 turn 完成时仅播放声音 |
| Claude Code | `PermissionRequest` | 播放权限声音 |
| Claude Code | `Notification` | 延迟权限事件播放权限声音；后台完成事件播放完成声音 |
| Claude Code | `Stop` | 当前 turn 完成时仅播放声音 |
| Grok Build | `Notification` | 权限/输入事件播放权限声音；后台完成事件播放完成声音 |
| Grok Build | `Stop` | 当前 turn 完成时仅播放声音 |

Claude Code 可能在 `PermissionRequest` 后约六秒再次发出 `permission_prompt`。插件会按 session 去重，同一次权限请求只提醒一次。Grok Build 使用 camelCase Hook 输入，插件会自动转换。

Codex 设置 `approvals_reviewer = "auto_review"`（界面中的 **Approve for me**）时，插件默认不播放 `PermissionRequest` 声音，避免自动审批的每条命令都响；`Stop` 任务完成声音不受影响。若希望自动审批时仍提醒：

```bash
export CLI_REMINDER_NOTIFY_AUTO_APPROVALS=1
```

这个过滤只作用于 Codex，不改变 Claude Code 和 Grok Build 的通知行为。

## 跨平台实现

提醒核心是无第三方 npm 依赖的 Node.js 脚本，通过 CLI 提供的插件根目录变量定位自身，不依赖固定安装路径：

- macOS：`afplay`。
- Linux：优先使用 `canberra-gtk-play`，其次使用 `paplay`。
- Windows：PowerShell `System.Media.SystemSounds`。

需要 Node.js 18 或更高版本。Windows 需要 PowerShell；Ubuntu/Debian 通常还需安装提供 `canberra-gtk-play` 或 `paplay` 的系统包。

旧入口 `scripts/codex_notify.py` 仍然保留，会转发到共享 Node.js 核心，以兼容此前的手动配置。

## 声音设置

默认启用声音。macOS 默认权限声音和完成声音均为 `Glass`。可以分别配置：

```bash
export CLI_REMINDER_PERMISSION_SOUND=Glass
export CLI_REMINDER_COMPLETION_SOUND=Glass
```

macOS 可换成 `Pop` 等系统声音。Linux 默认使用 `dialog-warning` 和 `complete`，Windows 默认使用 `Exclamation` 和 `Asterisk`。

原有的 `CLI_REMINDER_SOUND` 仍可统一覆盖两类声音；事件专用设置优先级更高。分别关闭某类声音：

```bash
export CLI_REMINDER_PERMISSION_SOUND=none
export CLI_REMINDER_COMPLETION_SOUND=none
```

Windows PowerShell 中使用：

```powershell
$env:CLI_REMINDER_PERMISSION_SOUND = "Exclamation"
$env:CLI_REMINDER_COMPLETION_SOUND = "Asterisk"
```

需要在启动对应 CLI 前设置环境变量。旧的 `CODEX_NOTIFIER_SOUND` 仍受支持，但 `CLI_REMINDER_SOUND` 优先。

## 隐私与可靠性

- 权限和完成事件都只播放声音，不向桌面通知系统发送工具参数或助手摘要。
- Hook 异步运行，异常、缺少声音组件或播放失败都会静默退出，不改变权限或任务流程。

## 测试

```bash
node --test tests/test_cli_notify.js
node scripts/cli_notify.js --self-test --product "CLI Reminder"
```

第二条命令会依次播放权限声音和完成声音，不显示桌面通知。

验证三套插件格式：

```bash
claude plugin validate .
grok plugin validate .
```

## 插件清单

- Codex：`.codex-plugin/plugin.json` + `hooks/hooks.json`
- Claude Code：`.claude-plugin/plugin.json` + `hooks/claude-hooks.json`
- Grok Build：直接使用 Claude Code 兼容清单和 Hook
