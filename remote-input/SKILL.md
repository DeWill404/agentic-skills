---
name: remote-input
description: See and control the user's Windows machine (screenshot, mouse, keyboard) over the LAN to use apps on it the way a human would, for example debugging a web app in Chrome. Use when the user asks to look at, click, scroll, type or test something on the Windows machine or "remote" screen, or runs /remote-input.
argument-hint: <task to do on the Windows laptop>
---

# Remote input: drive the Windows laptop

Task from the user: $ARGUMENTS

If the task above is empty, ask the user what to do on the Windows laptop before touching anything.

## What this is

The Windows laptop runs a small server (`server.py`) that the user starts by hand. It exposes two endpoints, and nothing else:

- `GET /screenshot`: PNG of the laptop's primary monitor, downscaled to 1568x882.
- `POST /act`: one mouse or keyboard action as JSON, sent through real OS input, so the browser sees ordinary trusted clicks and keys.

`server.py` and `start.bat` ship next to this file; copy them to the Windows machine. If the user has not set the host up yet, walk them through `references/windows-host.md` (Python deps, Private network profile, firewall rule, `REMOTE_INPUT_ALLOW`).

There is no command, file or browser-automation API. You only see pixels and send input, exactly like a person sitting at the machine. That still means you can reach every app on the desktop, including a terminal, so the scope rules below matter.

## 1. Connect

The server prints two lines on every start, and the token changes each time:

```
URL    http://<windows-ip>:8765
TOKEN  <random string>
```

If the user has not pasted them in this conversation, ask for them. Then save them once (Bash calls do not share shell variables). This works in bash and zsh on macOS and Linux, and in Git Bash on Windows:

```bash
printf 'U=%s\nT=%s\n' '<URL>' '<TOKEN>' > ~/.remote-input.env && chmod 600 ~/.remote-input.env
```

Check the connection with one screenshot (step 2). Status codes:

- `200`: connected.
- `401`: wrong or old token. Ask the user for the current TOKEN line.
- `403`: this machine's IP is not the one the server was started with (`--allow`, or `REMOTE_INPUT_ALLOW` in `start.bat`). Tell the user; the server accepts exactly one client IP.
- connection refused or timeout: the server is not running or has expired (it exits after 30 minutes by default, or when the user moves the real mouse into a screen corner). Ask the user to run `start.bat` on the Windows machine again and send the new URL and TOKEN.

## 2. See the screen

```bash
mkdir -p ss && . ~/.remote-input.env && curl -s -m 15 -o ss/remote.png -w '%{http_code}\n' -H "Authorization: Bearer $T" "$U/screenshot"
```

Then open `ss/remote.png` with the Read tool to look at it. All coordinates you send are pixels in this 1568x882 image; the server converts them to real screen pixels.

## 3. Act

```bash
. ~/.remote-input.env && curl -s -m 30 -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"action":"click","x":640,"y":360}' "$U/act"
```

A good call returns `{"ok": true}`. A bad one returns HTTP 400 with `{"error": "..."}`.

| action | fields |
|---|---|
| `move` | `x`, `y`, optional `duration` (seconds, default 0.3) |
| `click` | `x`, `y`, optional `button` (`left`/`right`/`middle`), `clicks` (2 = double-click), `duration` |
| `drag` | `x`, `y` (start), `x2`, `y2` (end), optional `button`, `duration` (at least 0.5) |
| `scroll` | `x`, `y` (mouse goes there first), `notches` (negative = down, positive = up) |
| `type` | `text` (ASCII only), optional `interval` (seconds between keys, default 0.03) |
| `key` | `keys`: a list pressed as one hotkey, for example `["enter"]`, `["ctrl","l"]`, `["ctrl","shift","i"]`, `["f12"]`, `["pagedown"]`, `["esc"]` |

Key names are pyautogui names: `ctrl`, `shift`, `alt`, `win`, `enter`, `tab`, `esc`, `backspace`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1`-`f12`.

Useful Chrome moves: `["ctrl","l"]` then `type` a URL then `["enter"]` to navigate; `["f5"]` to reload; `["ctrl","shift","r"]` for a hard reload; `["f12"]` to open DevTools and read the Console from a screenshot; `["ctrl","0"]` to reset zoom.

## 4. Work loop

1. Take a screenshot and read it before every action. Never act on a stale picture.
2. Send ONE action, then take a screenshot and confirm it did what you expected. The server handles one request at a time; never send requests in parallel.
3. Aim at the center of the target. If a click misses, re-read the screenshot and adjust; do not repeat the same coordinates blindly.
4. Click into a text field before `type`, and check the field shows focus.
5. For scrolling, start with `notches` of -3 and check how far the page moved on the first try before using bigger values.
6. When done, report what you did, what you saw, and the screenshot path of the final state.

## Rules

- Only touch the apps and windows the task names. If the task does not name one, ask. Opening an app the task needs (for example launching Chrome from the Start menu) is fine.
- The user may be using the machine at the same time. If the screenshot shows an unexpected window in front, or a page or form that is not part of the task, stop and ask instead of clicking, scrolling or typing there.
- Hard stop, unless the task explicitly asks for it by name: do not open or use a terminal (cmd, PowerShell, Windows Terminal), the Run dialog (`win+r`), Settings, Control Panel, Task Manager, the registry editor, or an installer. If you get stuck and think one of these would help, stop and ask the user instead.
- Never click Windows UAC, security, or "allow" prompts. They need the user.
- Never type passwords, tokens, payment details or personal data, and never submit forms, send messages, buy, delete or change account settings unless the user's task explicitly says to.
- A black or blank screenshot means the laptop is locked or asleep. Ask the user to unlock it; do not try to type a PIN.
- Non-ASCII text cannot be typed. Tell the user if the task needs it.
- If the user says stop, stop sending actions immediately.
- Do not print the token back to the user or commit `~/.remote-input.env`.
