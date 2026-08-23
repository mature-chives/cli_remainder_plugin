# Codex CLI Notifier

在 Codex CLI 等待权限确认或完成当前 turn 时发送带声音的原生桌面通知。插件通过 `PLUGIN_ROOT` 定位自身，不依赖安装目录，因此可在 macOS、Windows 和 Linux 之间复用。

## 先试零代码方案

如果终端支持 OSC 9 通知，直接在 `~/.codex/config.toml` 中加入：

```toml
[tui]
notifications = ["approval-requested", "agent-turn-complete"]
notification_method = "auto"
notification_condition = "always"
```

这已经能覆盖大多数场景。插件方案适合需要独立于终端能力的系统通知。

## 插件行为

- `PermissionRequest`：显示“Codex：等待权限确认”。
- `Stop`：显示“Codex：任务已完成”，并附上最后一条助手消息的短摘要。
- 默认同时播放提示音。
- 不展示原始命令参数，避免把 token、路径参数等内容放进通知。
- 通知异步发送；即使通知失败，也不会批准、拒绝或阻塞 Codex。

插件使用系统自带能力，无第三方 Python 依赖：

- macOS：`osascript` JXA + `afplay`，系统自带。
- Linux：`notify-send`；声音优先使用 `canberra-gtk-play`，其次使用 `paplay` 或桌面通知声音 hint。
- Windows：Python Launcher `py` + PowerShell + `System.Windows.Forms.NotifyIcon`。

三种平台都需要 Python 3。Ubuntu/Debian 通常还需要安装 `notify-send`；如果需要更稳定的声音播放，再安装提供 `canberra-gtk-play` 的系统包。

## 声音设置

默认启用声音。macOS 默认使用系统的 `Glass` 提示音：

```bash
export CODEX_NOTIFIER_SOUND=Glass
```

macOS 可以改成其他系统声音，例如 `Ping` 或 `Pop`：

```bash
export CODEX_NOTIFIER_SOUND=Ping
```

关闭声音：

```bash
export CODEX_NOTIFIER_SOUND=none
```

环境变量需要在启动 Codex CLI 之前设置。自定义系统声音名只适用于 macOS；Linux 使用桌面消息提示音，Windows 使用系统提示音。

## 不安装插件，直接试用 hook（仅当前路径）

把以下内容加入用户级 `~/.codex/config.toml`，并把路径替换为本机脚本绝对路径：

```toml
[[hooks.PermissionRequest]]

[[hooks.PermissionRequest.hooks]]
type = "command"
command = 'python3 "/absolute/path/to/plugins/codex-cli-notifier/scripts/codex_notify.py"'
commandWindows = '''py -3 -c "import runpy;runpy.run_path(r'C:\absolute\path\to\plugins\codex-cli-notifier\scripts\codex_notify.py',run_name='__main__')"'''
timeout = 8
async = true

[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = 'python3 "/absolute/path/to/plugins/codex-cli-notifier/scripts/codex_notify.py"'
commandWindows = '''py -3 -c "import runpy;runpy.run_path(r'C:\absolute\path\to\plugins\codex-cli-notifier\scripts\codex_notify.py',run_name='__main__')"'''
timeout = 8
async = true
```

重启 Codex CLI 后执行 `/hooks`，检查并信任这两个 hook。

## 测试

```bash
python3 -m unittest discover -s tests -v
python3 scripts/codex_notify.py --self-test
```

第二条命令会实际发送一条带声音的桌面通知。macOS 首次运行时可能需要在“系统设置 > 通知”中允许相关通知和声音。

## 作为插件分发

目录包含 Codex 插件所需的 `.codex-plugin/plugin.json`，并通过默认的 `hooks/hooks.json` 自动暴露 lifecycle hooks。仓库根目录已经提供 `.agents/plugins/marketplace.json`；安装 marketplace 和插件后，新开一个 session，并在 `/hooks` 中审查和信任 hook。
