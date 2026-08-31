"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const notifier = require("../scripts/cli_notify.js");
const pluginRoot = path.resolve(__dirname, "..");

test("Codex permission notification uses description but not command", () => {
  const payload = {
    hook_event_name: "PermissionRequest",
    cwd: "/workspace/demo",
    tool_name: "Bash",
    tool_input: {
      description: "允许访问官方文档吗？",
      command: "curl https://example.invalid/?token=secret",
    },
  };
  const result = notifier.notificationFor(payload, { PLUGIN_ROOT: pluginRoot });
  assert.equal(result.title, "Codex：等待权限确认");
  assert.match(result.body, /demo/);
  assert.match(result.body, /允许访问官方文档吗/);
  assert.doesNotMatch(result.body, /secret/);
});

test("Claude Stop compacts the final assistant message", () => {
  const payload = {
    hook_event_name: "Stop",
    cwd: "/workspace/demo",
    last_assistant_message: "测试完成。\n\n所有检查均已通过。",
  };
  const result = notifier.notificationFor(payload, { CLAUDE_PLUGIN_ROOT: pluginRoot });
  assert.equal(result.title, "Claude Code：任务已完成");
  assert.equal(result.body, "demo：测试完成。 所有检查均已通过。");
});

test("Grok camelCase hook payload is normalized", () => {
  const payload = {
    hookEventName: "Stop",
    cwd: "C:\\workspace\\demo",
    lastAssistantMessage: "done",
  };
  const result = notifier.notificationFor(payload, { GROK_PLUGIN_ROOT: pluginRoot });
  assert.equal(result.title, "Grok Build：任务已完成");
  assert.match(result.body, /done/);
});

test("Claude and Grok Notification permission events are supported", () => {
  const payload = {
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    cwd: "/workspace/demo",
    message: "Claude needs your permission",
  };
  const result = notifier.notificationFor(payload, { CLAUDE_PLUGIN_ROOT: pluginRoot });
  assert.equal(result.kind, "permission");
  assert.equal(result.title, "Claude Code：等待权限确认");
});

test("background agent completion notification is supported", () => {
  const payload = {
    hook_event_name: "Notification",
    notification_type: "agent_completed",
    message: "Background agent completed",
  };
  const result = notifier.notificationFor(payload, { CLAUDE_PLUGIN_ROOT: pluginRoot });
  assert.equal(result.kind, "complete");
  assert.equal(result.title, "Claude Code：后台任务已完成");
});

test("unrelated events and notifications are ignored", () => {
  assert.equal(notifier.notificationFor({ hook_event_name: "SessionStart" }, {}), null);
  assert.equal(
    notifier.notificationFor(
      { hook_event_name: "Notification", notification_type: "auth_success" },
      { CLAUDE_PLUGIN_ROOT: pluginRoot },
    ),
    null,
  );
});

test("sound uses generic setting and keeps legacy Codex setting", () => {
  assert.equal(notifier.configuredSound({}), "Glass");
  assert.equal(notifier.configuredSound({ CODEX_NOTIFIER_SOUND: "Ping" }), "Ping");
  assert.equal(notifier.configuredSound({ CLI_REMINDER_SOUND: "none" }), null);
  assert.equal(notifier.configuredEventSound("permission", {}, "darwin"), "Glass");
  assert.equal(notifier.configuredEventSound("complete", {}, "darwin"), "Glass");
  assert.equal(notifier.configuredEventSound("permission", {}, "linux"), "dialog-warning");
  assert.equal(notifier.configuredEventSound("complete", {}, "win32"), "Asterisk");
  assert.equal(
    notifier.configuredEventSound(
      "permission",
      { CLI_REMINDER_PERMISSION_SOUND: "Pop", CLI_REMINDER_SOUND: "Glass" },
      "darwin",
    ),
    "Pop",
  );
  assert.equal(
    notifier.configuredEventSound(
      "complete",
      { CLI_REMINDER_COMPLETION_SOUND: "none" },
      "darwin",
    ),
    null,
  );
});

test("Codex approve for me suppresses permission notifications", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-reminder-codex-"));
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    'approvals_reviewer = "auto_review"\n\n[projects."/workspace"]\ntrust_level = "trusted"\n',
  );
  const env = {
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CODEX_HOME: codexHome,
    PLUGIN_ROOT: pluginRoot,
  };
  const payload = {
    hook_event_name: "PermissionRequest",
    permission_mode: "default",
    session_id: "auto-review-session",
    tool_name: "Bash",
  };
  const notification = notifier.notificationFor(payload, env);
  assert.equal(notifier.productName(payload, env), "Codex");
  assert.equal(notifier.codexApprovalsReviewer(payload, env), "auto_review");
  assert.equal(notifier.shouldDispatch(notification, payload, env), false);
});

test("manual Codex approval and non-Codex hooks still notify", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-reminder-codex-"));
  fs.writeFileSync(path.join(codexHome, "config.toml"), 'approvals_reviewer = "user"\n');
  const payload = {
    hook_event_name: "PermissionRequest",
    permission_mode: "default",
    session_id: "manual-review-session",
    tool_name: "Bash",
  };
  const codexEnv = { CODEX_HOME: codexHome, PLUGIN_ROOT: pluginRoot };
  const claudeEnv = { CLAUDE_PLUGIN_ROOT: pluginRoot, CODEX_HOME: codexHome };
  assert.equal(
    notifier.shouldDispatch(notifier.notificationFor(payload, codexEnv), payload, codexEnv),
    true,
  );
  assert.equal(
    notifier.shouldDispatch(notifier.notificationFor(payload, claudeEnv), payload, claudeEnv),
    true,
  );
});

test("auto approval notification can be explicitly restored", () => {
  const payload = {
    hook_event_name: "PermissionRequest",
    approvals_reviewer: "auto_review",
    session_id: "forced-auto-review-session",
    tool_name: "Bash",
  };
  const env = {
    CLI_REMINDER_NOTIFY_AUTO_APPROVALS: "1",
    PLUGIN_ROOT: pluginRoot,
  };
  const notification = notifier.notificationFor(payload, env);
  assert.equal(notifier.shouldDispatch(notification, payload, env), true);
});

test("completion dispatches sound without a desktop notification", () => {
  const calls = [];
  const notification = notifier.notificationFor(
    {
      hook_event_name: "Stop",
      cwd: "/workspace/demo",
      last_assistant_message: "done",
    },
    { PLUGIN_ROOT: pluginRoot },
  );
  const result = notifier.dispatchNotification(
    notification,
    {},
    { PLUGIN_ROOT: pluginRoot },
    {
      platform: "darwin",
      runtime: {
        existsSync: () => true,
        runQuietly: (command, args) => {
          calls.push([command, args]);
          return true;
        },
      },
    },
  );
  assert.equal(result, true);
  assert.deepEqual(calls, [["afplay", ["/System/Library/Sounds/Glass.aiff"]]]);
});

test("permission dispatches the configured sound without a desktop notification", () => {
  const calls = [];
  const notification = notifier.notificationFor(
    { hook_event_name: "PermissionRequest", tool_name: "Bash" },
    { PLUGIN_ROOT: pluginRoot },
  );
  notifier.dispatchNotification(
    notification,
    {},
    { PLUGIN_ROOT: pluginRoot },
    {
      platform: "darwin",
      runtime: {
        existsSync: () => true,
        runQuietly: (command, args) => {
          calls.push([command, args]);
          return true;
        },
      },
    },
  );
  assert.deepEqual(calls, [["afplay", ["/System/Library/Sounds/Glass.aiff"]]]);
});

test("Linux uses distinct canberra sounds for permission and completion", () => {
  const calls = [];
  const runtime = {
    findExecutable: (name) =>
      name === "canberra-gtk-play" ? "/usr/bin/canberra-gtk-play" : null,
    runQuietly: (command, args) => {
      calls.push([command, args]);
      return true;
    },
  };
  assert.equal(notifier.sendSound({ kind: "permission", platform: "linux", runtime }), true);
  assert.equal(notifier.sendSound({ kind: "complete", platform: "linux", runtime }), true);
  assert.deepEqual(calls[0], [
    "/usr/bin/canberra-gtk-play",
    ["-i", "dialog-warning"],
  ]);
  assert.deepEqual(calls[1], [
    "/usr/bin/canberra-gtk-play",
    ["-i", "complete"],
  ]);
});

test("Windows uses distinct system sounds without creating a NotifyIcon", () => {
  const invocations = [];
  const runtime = {
    env: { PATH: "C:\\Windows\\System32", PATHEXT: ".EXE" },
    findExecutable: (name) =>
      name === "powershell" ? "C:\\Windows\\System32\\WindowsPowerShell\\powershell.exe" : null,
    runQuietly: (command, args, options) => {
      invocations.push({ command, args, options });
      return true;
    },
  };
  assert.equal(notifier.sendSound({ kind: "permission", platform: "win32", runtime }), true);
  assert.equal(notifier.sendSound({ kind: "complete", platform: "win32", runtime }), true);
  assert.match(invocations[0].args.at(-1), /SystemSounds.*Exclamation/);
  assert.match(invocations[1].args.at(-1), /SystemSounds.*Asterisk/);
  assert.doesNotMatch(invocations[0].args.at(-1), /NotifyIcon/);
  assert.doesNotMatch(invocations[1].args.at(-1), /NotifyIcon/);
});

test("delayed Claude permission notification is deduplicated", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-reminder-test-"));
  const env = { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_PLUGIN_ROOT: pluginRoot };
  const request = {
    hook_event_name: "PermissionRequest",
    session_id: "session-1",
    tool_name: "Bash",
  };
  const delayed = {
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    session_id: "session-1",
  };
  const immediateNotification = notifier.notificationFor(request, env);
  const delayedNotification = notifier.notificationFor(delayed, env);
  assert.equal(notifier.shouldDispatch(immediateNotification, request, env, 1_000), true);
  assert.equal(notifier.shouldDispatch(delayedNotification, delayed, env, 7_000), false);
});

test("hook files expose the expected events and launch the shared script", () => {
  const codexHooks = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"),
  );
  const claudeHooks = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "hooks", "claude-hooks.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(codexHooks.hooks).sort(), ["PermissionRequest", "Stop"]);
  assert.deepEqual(Object.keys(claudeHooks.hooks).sort(), [
    "Notification",
    "PermissionRequest",
    "Stop",
  ]);
  for (const groups of Object.values(claudeHooks.hooks)) {
    assert.equal(groups[0].hooks[0].command, "node");
    assert.equal(groups[0].hooks[0].args[0], "-e");
    assert.match(groups[0].hooks[0].args[1], /GROK_PLUGIN_ROOT/);
    assert.match(groups[0].hooks[0].args[1], /CLAUDE_PLUGIN_ROOT/);
  }
});

test("Claude manifest selects its dedicated hook file", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(manifest.name, "cli-reminder");
  assert.equal(manifest.hooks, "./hooks/claude-hooks.json");
});
