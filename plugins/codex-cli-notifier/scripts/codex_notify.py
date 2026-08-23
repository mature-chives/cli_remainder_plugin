#!/usr/bin/env python3
"""Send native desktop notifications for selected Codex hook events."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from typing import Any, Mapping, Optional, Sequence, TextIO, Tuple


MAX_BODY_LENGTH = 240
DEFAULT_SOUND_NAME = "Glass"
DISABLED_SOUND_VALUES = {"0", "false", "none", "off", "silent"}
MACOS_SOUND_DIRECTORY = Path("/System/Library/Sounds")
LINUX_FREEDESKTOP_SOUND = Path(
    "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"
)


def compact_text(value: object, limit: int = MAX_BODY_LENGTH) -> str:
    """Collapse whitespace and truncate a value for a desktop notification."""
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def project_name(payload: Mapping[str, Any]) -> str:
    cwd = str(payload.get("cwd") or "").strip()
    if not cwd:
        return "Codex"
    name = Path(cwd).name
    return name or cwd


def notification_for(payload: Mapping[str, Any]) -> Optional[Tuple[str, str]]:
    """Build a title/body pair without exposing raw command arguments."""
    event_name = payload.get("hook_event_name")
    project = project_name(payload)

    if event_name == "PermissionRequest":
        tool_name = compact_text(payload.get("tool_name") or "tool", 48)
        tool_input = payload.get("tool_input")
        description = ""
        if isinstance(tool_input, Mapping):
            description = compact_text(tool_input.get("description"))

        title = "Codex：等待权限确认"
        body = description or f"{project} 中的 {tool_name} 正在等待你的批准。"
        if description:
            body = f"{project} · {tool_name}：{description}"
        return title, compact_text(body)

    if event_name == "Stop":
        summary = compact_text(payload.get("last_assistant_message"))
        title = "Codex：任务已完成"
        body = f"{project}：{summary}" if summary else f"{project} 的当前任务已经结束。"
        return title, compact_text(body)

    return None


def run_quietly(command: Sequence[str]) -> bool:
    try:
        completed = subprocess.run(
            list(command),
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=4,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def configured_sound() -> Optional[str]:
    """Return the configured sound name, or None when sound is disabled."""
    value = os.environ.get("CODEX_NOTIFIER_SOUND", DEFAULT_SOUND_NAME).strip()
    if value.lower() in DISABLED_SOUND_VALUES:
        return None
    return value or DEFAULT_SOUND_NAME


def notify_macos(title: str, body: str, sound: Optional[str]) -> bool:
    script = (
        "function run(argv) { "
        "const app = Application.currentApplication(); "
        "app.includeStandardAdditions = true; "
        "app.displayNotification(argv[1], { withTitle: argv[0] }); "
        "}"
    )
    notified = run_quietly(["osascript", "-l", "JavaScript", "-e", script, title, body])

    if sound and Path(sound).name == sound:
        sound_path = MACOS_SOUND_DIRECTORY / f"{sound}.aiff"
        if sound_path.is_file():
            run_quietly(["afplay", str(sound_path)])

    return notified


def notify_linux(title: str, body: str, sound: Optional[str]) -> bool:
    executable = shutil.which("notify-send")
    if not executable:
        return False

    sound_command: Optional[Sequence[str]] = None
    if sound:
        canberra = shutil.which("canberra-gtk-play")
        paplay = shutil.which("paplay")
        if canberra:
            sound_command = [canberra, "-i", "message-new-instant"]
        elif paplay and LINUX_FREEDESKTOP_SOUND.is_file():
            sound_command = [paplay, str(LINUX_FREEDESKTOP_SOUND)]

    command = [executable, "--app-name=Codex"]
    if sound and sound_command is None:
        command.append("--hint=string:sound-name:message-new-instant")
    command.extend([title, body])
    notified = run_quietly(command)
    if sound_command is not None:
        run_quietly(sound_command)
    return notified


def notify_windows(title: str, body: str, sound: Optional[str]) -> bool:
    executable = shutil.which("powershell.exe") or shutil.which("powershell")
    if not executable:
        return False

    sound_command = "[System.Media.SystemSounds]::Exclamation.Play();" if sound else ""
    script = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$icon=New-Object System.Windows.Forms.NotifyIcon;"
        "$icon.Icon=[System.Drawing.SystemIcons]::Information;"
        "$icon.BalloonTipTitle=$env:CODEX_NOTIFY_TITLE;"
        "$icon.BalloonTipText=$env:CODEX_NOTIFY_BODY;"
        "$icon.Visible=$true;"
        f"{sound_command}"
        "$icon.ShowBalloonTip(5000);"
        "Start-Sleep -Milliseconds 5500;"
        "$icon.Dispose()"
    )
    env = os.environ.copy()
    env["CODEX_NOTIFY_TITLE"] = title
    env["CODEX_NOTIFY_BODY"] = body
    try:
        completed = subprocess.run(
            [executable, "-NoProfile", "-NonInteractive", "-Command", script],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=7,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def send_notification(title: str, body: str, system: Optional[str] = None) -> bool:
    current_system = system or platform.system()
    sound = configured_sound()
    if current_system == "Darwin":
        return notify_macos(title, body, sound)
    if current_system == "Linux":
        return notify_linux(title, body, sound)
    if current_system == "Windows":
        return notify_windows(title, body, sound)
    return False


def read_payload(stream: TextIO) -> Optional[Mapping[str, Any]]:
    try:
        payload = json.load(stream)
    except (json.JSONDecodeError, OSError, TypeError):
        return None
    return payload if isinstance(payload, Mapping) else None


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Send a sample desktop notification and exit.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None, stream: TextIO = sys.stdin) -> int:
    args = parse_args(argv)
    if args.self_test:
        send_notification("Codex：通知测试", "如果你看到这条消息，通知工具已可用。")
        return 0

    payload = read_payload(stream)
    if payload is None:
        return 0

    notification = notification_for(payload)
    if notification is not None:
        send_notification(*notification)

    # Hook failures must never block or alter the Codex approval/stop flow.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
