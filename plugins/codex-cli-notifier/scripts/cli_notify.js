#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BODY_LENGTH = 240;
const DEFAULT_SOUND_NAME = "Glass";
const DISABLED_SOUND_VALUES = new Set(["0", "false", "none", "off", "silent"]);
const MACOS_SOUND_DIRECTORY = "/System/Library/Sounds";
const LINUX_FREEDESKTOP_SOUND =
  "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga";
const PERMISSION_DEDUPE_WINDOW_MS = 30_000;
const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

function compactText(value, limit = MAX_BODY_LENGTH) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function field(payload, snakeCase, camelCase) {
  return payload[snakeCase] ?? payload[camelCase];
}

function hookEventName(payload, env = process.env) {
  return field(payload, "hook_event_name", "hookEventName") || env.GROK_HOOK_EVENT || "";
}

function notificationType(payload, env = process.env) {
  return (
    field(payload, "notification_type", "notificationType") ||
    field(payload, "hook_name", "hookName") ||
    env.GROK_HOOK_NAME ||
    ""
  );
}

function productName(payload = {}, env = process.env) {
  if (env.CLI_REMINDER_PRODUCT) return compactText(env.CLI_REMINDER_PRODUCT, 40);
  if (env.GROK_PLUGIN_ROOT || env.GROK_HOOK_EVENT || payload.hookEventName) {
    return "Grok Build";
  }
  if (env.PLUGIN_ROOT) return "Codex";
  if (env.CLAUDE_PLUGIN_ROOT) return "Claude Code";
  return "CLI Reminder";
}

function projectName(payload, product) {
  const cwd = String(
    payload.cwd || field(payload, "workspace_root", "workspaceRoot") || "",
  ).trim();
  if (!cwd) return product;
  return path.basename(path.normalize(cwd)) || cwd;
}

function permissionMessage(payload) {
  const toolInput = field(payload, "tool_input", "toolInput");
  if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
    return compactText(toolInput.description);
  }
  return compactText(payload.message);
}

function looksLikePermissionNotification(payload, type) {
  if (type === "permission_prompt" || type === "permission-request") return true;
  const text = `${payload.title || ""} ${payload.message || ""}`;
  return /permission|approval|approve|权限|批准|确认/i.test(text);
}

function looksLikeCompletionNotification(payload, type) {
  if (type === "agent_completed" || type === "agent-completed") return true;
  const text = `${payload.title || ""} ${payload.message || ""}`;
  return /agent.*(completed|finished)|任务.*(完成|结束)|后台.*(完成|结束)/i.test(text);
}

function notificationFor(payload, env = process.env) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const eventName = hookEventName(payload, env);
  const product = productName(payload, env);
  const project = projectName(payload, product);

  if (eventName === "PermissionRequest") {
    const toolName = compactText(field(payload, "tool_name", "toolName") || "tool", 48);
    const description = permissionMessage(payload);
    const body = description
      ? `${project} · ${toolName}：${description}`
      : `${project} 中的 ${toolName} 正在等待你的批准。`;
    return {
      body: compactText(body),
      kind: "permission",
      sourceEvent: eventName,
      title: `${product}：等待权限确认`,
    };
  }

  if (eventName === "Stop") {
    const summary = compactText(
      field(payload, "last_assistant_message", "lastAssistantMessage") || payload.message,
    );
    return {
      body: compactText(summary ? `${project}：${summary}` : `${project} 的当前任务已经结束。`),
      kind: "complete",
      sourceEvent: eventName,
      title: `${product}：任务已完成`,
    };
  }

  if (eventName === "Notification") {
    const type = notificationType(payload, env);
    if (looksLikePermissionNotification(payload, type)) {
      return {
        body: compactText(payload.message || `${project} 正在等待你的批准。`),
        kind: "permission",
        sourceEvent: eventName,
        title: `${product}：等待权限确认`,
      };
    }
    if (looksLikeCompletionNotification(payload, type)) {
      return {
        body: compactText(payload.message || `${project} 的后台任务已经结束。`),
        kind: "complete",
        sourceEvent: eventName,
        title: `${product}：后台任务已完成`,
      };
    }
  }

  return null;
}

function sessionKey(payload) {
  return String(
    field(payload, "session_id", "sessionId") ||
      payload.cwd ||
      field(payload, "workspace_root", "workspaceRoot") ||
      "default",
  );
}

function dedupeFile(payload, env = process.env) {
  const root =
    env.GROK_PLUGIN_DATA ||
    env.CLAUDE_PLUGIN_DATA ||
    path.join(os.tmpdir(), "cli-reminder");
  const digest = crypto.createHash("sha256").update(sessionKey(payload)).digest("hex").slice(0, 24);
  return path.join(root, `permission-${digest}.json`);
}

function markImmediatePermission(payload, env = process.env, now = Date.now()) {
  try {
    const target = dedupeFile(payload, env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ timestamp: now }), { mode: 0o600 });
  } catch {
    // Notification failures must never affect the CLI approval flow.
  }
}

function hadRecentImmediatePermission(
  payload,
  env = process.env,
  now = Date.now(),
  windowMs = PERMISSION_DEDUPE_WINDOW_MS,
) {
  try {
    const state = JSON.parse(fs.readFileSync(dedupeFile(payload, env), "utf8"));
    return Number.isFinite(state.timestamp) && now - state.timestamp >= 0 && now - state.timestamp <= windowMs;
  } catch {
    return false;
  }
}

function shouldDispatch(notification, payload, env = process.env, now = Date.now()) {
  if (!notification || notification.kind !== "permission") return Boolean(notification);
  if (
    notification.sourceEvent === "PermissionRequest" &&
    codexAutoApprovalEnabled(payload, env) &&
    !notifyAutoApprovals(env)
  ) {
    return false;
  }
  if (notification.sourceEvent === "PermissionRequest") {
    markImmediatePermission(payload, env, now);
    return true;
  }
  if (notification.sourceEvent === "Notification") {
    return !hadRecentImmediatePermission(payload, env, now);
  }
  return true;
}

function configuredSound(env = process.env) {
  const raw = Object.prototype.hasOwnProperty.call(env, "CLI_REMINDER_SOUND")
    ? env.CLI_REMINDER_SOUND
    : env.CODEX_NOTIFIER_SOUND;
  const value = String(raw ?? DEFAULT_SOUND_NAME).trim();
  if (DISABLED_SOUND_VALUES.has(value.toLowerCase())) return null;
  return value || DEFAULT_SOUND_NAME;
}

function topLevelTomlString(source, key) {
  for (const line of String(source || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break;
    const match = new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`).exec(trimmed);
    if (match) return match[1];
  }
  return null;
}

function codexApprovalsReviewer(payload, env = process.env) {
  const payloadValue = field(payload, "approvals_reviewer", "approvalsReviewer");
  if (payloadValue) return String(payloadValue);

  const codexHome =
    env.CODEX_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".codex");
  try {
    const source = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    return topLevelTomlString(source, "approvals_reviewer");
  } catch {
    return null;
  }
}

function codexAutoApprovalEnabled(payload, env = process.env) {
  if (productName(payload, env) !== "Codex") return false;
  const permissionMode = field(payload, "permission_mode", "permissionMode");
  if (permissionMode === "bypassPermissions") return true;
  return codexApprovalsReviewer(payload, env) === "auto_review";
}

function notifyAutoApprovals(env = process.env) {
  return ENABLED_VALUES.has(
    String(env.CLI_REMINDER_NOTIFY_AUTO_APPROVALS || "").trim().toLowerCase(),
  );
}

function runQuietly(command, args, options = {}) {
  try {
    const completed = childProcess.spawnSync(command, args, {
      env: options.env || process.env,
      stdio: "ignore",
      timeout: options.timeout || 4_000,
      windowsHide: true,
    });
    return !completed.error && completed.status === 0;
  } catch {
    return false;
  }
}

function findExecutable(name, platform = process.platform, env = process.env) {
  const pathValue = env.PATH || env.Path || env.path || "";
  const delimiter = platform === "win32" ? ";" : ":";
  const extensions = platform === "win32"
    ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, platform === "win32" ? `${name}${extension}` : name);
      try {
        fs.accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
}

function notifyMacos(title, body, sound, runtime = {}) {
  const run = runtime.runQuietly || runQuietly;
  const exists = runtime.existsSync || fs.existsSync;
  const script =
    "function run(argv) { " +
    "const app = Application.currentApplication(); " +
    "app.includeStandardAdditions = true; " +
    "app.displayNotification(argv[1], { withTitle: argv[0] }); " +
    "}";
  const notified = run("osascript", ["-l", "JavaScript", "-e", script, title, body]);

  if (sound && path.basename(sound) === sound) {
    const soundPath = path.join(MACOS_SOUND_DIRECTORY, `${sound}.aiff`);
    if (exists(soundPath)) run("afplay", [soundPath]);
  }
  return notified;
}

function notifyLinux(title, body, sound, product, runtime = {}) {
  const find = runtime.findExecutable || findExecutable;
  const run = runtime.runQuietly || runQuietly;
  const exists = runtime.existsSync || fs.existsSync;
  const executable = find("notify-send", "linux", runtime.env || process.env);
  if (!executable) return false;

  let soundCommand = null;
  if (sound) {
    const canberra = find("canberra-gtk-play", "linux", runtime.env || process.env);
    const paplay = find("paplay", "linux", runtime.env || process.env);
    if (canberra) soundCommand = [canberra, ["-i", "message-new-instant"]];
    else if (paplay && exists(LINUX_FREEDESKTOP_SOUND)) {
      soundCommand = [paplay, [LINUX_FREEDESKTOP_SOUND]];
    }
  }

  const args = [`--app-name=${product}`];
  if (sound && !soundCommand) args.push("--hint=string:sound-name:message-new-instant");
  args.push(title, body);
  const notified = run(executable, args);
  if (soundCommand) run(soundCommand[0], soundCommand[1]);
  return notified;
}

function notifyWindows(title, body, sound, runtime = {}) {
  const find = runtime.findExecutable || findExecutable;
  const run = runtime.runQuietly || runQuietly;
  const env = { ...(runtime.env || process.env) };
  const executable =
    find("pwsh", "win32", env) ||
    find("powershell", "win32", env) ||
    find("powershell.exe", "win32", env);
  if (!executable) return false;

  env.CLI_REMINDER_NOTIFY_TITLE = title;
  env.CLI_REMINDER_NOTIFY_BODY = body;
  const soundCommand = sound ? "[System.Media.SystemSounds]::Exclamation.Play();" : "";
  const script =
    "$ErrorActionPreference='Stop';" +
    "Add-Type -AssemblyName System.Windows.Forms;" +
    "$icon=New-Object System.Windows.Forms.NotifyIcon;" +
    "$icon.Icon=[System.Drawing.SystemIcons]::Information;" +
    "$icon.BalloonTipTitle=$env:CLI_REMINDER_NOTIFY_TITLE;" +
    "$icon.BalloonTipText=$env:CLI_REMINDER_NOTIFY_BODY;" +
    "$icon.Visible=$true;" +
    soundCommand +
    "$icon.ShowBalloonTip(5000);" +
    "Start-Sleep -Milliseconds 5500;" +
    "$icon.Dispose()";
  return run(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env,
    timeout: 7_000,
  });
}

function sendNotification(title, body, product, options = {}) {
  const platform = options.platform || process.platform;
  const sound = configuredSound(options.env || process.env);
  if (platform === "darwin") return notifyMacos(title, body, sound, options.runtime);
  if (platform === "linux") return notifyLinux(title, body, sound, product, options.runtime);
  if (platform === "win32") return notifyWindows(title, body, sound, options.runtime);
  return false;
}

function parseArgs(argv) {
  const parsed = { product: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--self-test") parsed.selfTest = true;
    else if (argv[index] === "--product" && argv[index + 1]) {
      parsed.product = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function main(argv = process.argv.slice(2), input, env = process.env) {
  const args = parseArgs(argv);
  const effectiveEnv = args.product ? { ...env, CLI_REMINDER_PRODUCT: args.product } : env;
  const product = productName({}, effectiveEnv);

  if (args.selfTest) {
    sendNotification(
      `${product}：通知测试`,
      "如果你看到并听到这条消息，通知工具已可用。",
      product,
      { env: effectiveEnv },
    );
    return 0;
  }

  let payload;
  try {
    const raw = input === undefined ? fs.readFileSync(0, "utf8") : input;
    payload = JSON.parse(raw);
  } catch {
    return 0;
  }

  const notification = notificationFor(payload, effectiveEnv);
  if (shouldDispatch(notification, payload, effectiveEnv) && notification) {
    sendNotification(notification.title, notification.body, productName(payload, effectiveEnv), {
      env: effectiveEnv,
    });
  }
  return 0;
}

module.exports = {
  DEFAULT_SOUND_NAME,
  compactText,
  codexApprovalsReviewer,
  codexAutoApprovalEnabled,
  configuredSound,
  dedupeFile,
  findExecutable,
  hadRecentImmediatePermission,
  hookEventName,
  main,
  markImmediatePermission,
  notificationFor,
  notificationType,
  notifyLinux,
  notifyMacos,
  notifyAutoApprovals,
  notifyWindows,
  productName,
  projectName,
  sendNotification,
  shouldDispatch,
  topLevelTomlString,
};

if (require.main === module) {
  process.exitCode = main();
}
