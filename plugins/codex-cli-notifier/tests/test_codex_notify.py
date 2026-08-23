import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "codex_notify.py"
HOOKS = Path(__file__).parents[1] / "hooks" / "hooks.json"
SPEC = importlib.util.spec_from_file_location("codex_notify", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
codex_notify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(codex_notify)


class NotificationForTests(unittest.TestCase):
    def test_permission_notification_uses_description_but_not_command(self):
        payload = {
            "hook_event_name": "PermissionRequest",
            "cwd": "/workspace/demo",
            "tool_name": "Bash",
            "tool_input": {
                "description": "允许访问官方文档吗？",
                "command": "curl https://example.invalid/?token=secret",
            },
        }

        title, body = codex_notify.notification_for(payload)

        self.assertEqual(title, "Codex：等待权限确认")
        self.assertIn("demo", body)
        self.assertIn("允许访问官方文档吗？", body)
        self.assertNotIn("secret", body)

    def test_stop_notification_compacts_assistant_message(self):
        payload = {
            "hook_event_name": "Stop",
            "cwd": "/workspace/demo",
            "last_assistant_message": "测试完成。\n\n所有检查均已通过。",
        }

        title, body = codex_notify.notification_for(payload)

        self.assertEqual(title, "Codex：任务已完成")
        self.assertEqual(body, "demo：测试完成。 所有检查均已通过。")

    def test_other_events_are_ignored(self):
        self.assertIsNone(codex_notify.notification_for({"hook_event_name": "SessionStart"}))

    def test_sound_defaults_to_glass_and_can_be_disabled(self):
        with mock.patch.dict(codex_notify.os.environ, {}, clear=True):
            self.assertEqual(codex_notify.configured_sound(), "Glass")

        with mock.patch.dict(
            codex_notify.os.environ, {"CODEX_NOTIFIER_SOUND": "none"}, clear=True
        ):
            self.assertIsNone(codex_notify.configured_sound())

    def test_macos_notification_passes_requested_sound(self):
        with mock.patch.object(codex_notify, "run_quietly", return_value=True) as run:
            result = codex_notify.notify_macos("title", "body", "Ping")

        self.assertTrue(result)
        self.assertEqual(run.call_count, 2)
        notification_command = run.call_args_list[0].args[0]
        sound_command = run.call_args_list[1].args[0]
        self.assertEqual(notification_command[0], "osascript")
        self.assertEqual(notification_command[1:3], ["-l", "JavaScript"])
        self.assertEqual(
            sound_command,
            ["afplay", "/System/Library/Sounds/Ping.aiff"],
        )

    def test_send_notification_uses_configured_sound(self):
        with mock.patch.dict(
            codex_notify.os.environ, {"CODEX_NOTIFIER_SOUND": "Pop"}, clear=True
        ), mock.patch.object(codex_notify, "notify_macos", return_value=True) as notify:
            result = codex_notify.send_notification("title", "body", system="Darwin")

        self.assertTrue(result)
        notify.assert_called_once_with("title", "body", "Pop")

    def test_linux_uses_canberra_sound_player_when_available(self):
        executables = {
            "notify-send": "/usr/bin/notify-send",
            "canberra-gtk-play": "/usr/bin/canberra-gtk-play",
        }
        with mock.patch.object(
            codex_notify.shutil, "which", side_effect=executables.get
        ), mock.patch.object(codex_notify, "run_quietly", return_value=True) as run:
            result = codex_notify.notify_linux("title", "body", "Glass")

        self.assertTrue(result)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(
            run.call_args_list[1].args[0],
            ["/usr/bin/canberra-gtk-play", "-i", "message-new-instant"],
        )

    def test_hooks_define_windows_command_override(self):
        payload = json.loads(HOOKS.read_text(encoding="utf-8"))
        for event_name in ("PermissionRequest", "Stop"):
            handler = payload["hooks"][event_name][0]["hooks"][0]
            self.assertIn("commandWindows", handler)
            self.assertIn("PLUGIN_ROOT", handler["commandWindows"])

    def test_main_swallows_invalid_json(self):
        with mock.patch.object(codex_notify, "send_notification") as send:
            result = codex_notify.main([], io.StringIO("not json"))

        self.assertEqual(result, 0)
        send.assert_not_called()

    def test_main_dispatches_valid_hook(self):
        payload = io.StringIO(
            '{"hook_event_name":"Stop","cwd":"/workspace/demo",'
            '"last_assistant_message":"done"}'
        )
        with mock.patch.object(codex_notify, "send_notification", return_value=True) as send:
            result = codex_notify.main([], payload)

        self.assertEqual(result, 0)
        send.assert_called_once_with("Codex：任务已完成", "demo：done")


if __name__ == "__main__":
    unittest.main()
