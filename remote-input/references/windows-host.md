# Windows host setup

For the human setting up the Windows machine. The agent never runs these steps itself.

## Security model

**Treat the token as full control of your Windows account.** The API has only two endpoints, but keyboard input reaches every app: a controller can press `win+r`, type `cmd` and run any command you could run yourself. Anything the logged-in user can do, a token holder can do. The safeguards below limit who gets that access and for how long; they do not limit what it can do once connected.

Because of that, access is locked down on purpose:

- **Manual start only.** No service, no autostart. The server exits by itself after `--minutes` (default 30).
- **Kill switch.** Moving the real mouse into any screen corner stops it immediately (pyautogui failsafe).
- **One client IP.** Enforced twice: by a Windows Firewall rule (Private profile only) and by a check inside the script.
- **Bearer token.** Random, generated fresh on every start, printed only in the console.
- **Two endpoints only.** No API for commands, files or clipboard. (As said above, keyboard input can still reach a terminal, so this narrows the attack surface of the server itself, not what a connected client can do.)

Known limits: traffic is plain HTTP, so anyone who can sniff your LAN can read the token while a session runs. Use it only on a network you trust. IP allow-listing does not stop someone on the same network who spoofs or takes over the allowed IP. Only the primary monitor is captured, and `type` sends ASCII only.

## Setup (Windows host)

1. **Python 3.9+** with the `py` launcher, then:
   ```powershell
   py -3 -m pip install --user pyautogui pillow
   ```
2. **Network profile must be Private.** Check with `Get-NetConnectionProfile`. Only change it (`Set-NetConnectionProfile -InterfaceAlias "<alias>" -NetworkCategory Private`, admin) for a network you trust.
3. **Set the controller's IP** once (open a new window afterwards):
   ```powershell
   setx REMOTE_INPUT_ALLOW 192.168.1.50
   ```
4. **Firewall rule** in an admin PowerShell. Use the real interpreter path, because the `python` on PATH can be a Windows Store stub:
   ```powershell
   $py = py -3 -c "import sys; print(sys.executable)"
   New-NetFirewallRule -DisplayName "Remote Input (controller only)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -RemoteAddress 192.168.1.50 -Profile Private -Program $py
   ```
   If Windows shows an "allow Python?" prompt anyway, click Cancel, so it does not add a broad rule. An existing Block rule for `python.exe` on the Private profile overrides this rule; check with `Get-NetFirewallRule | Where-Object DisplayName -like "*python*"`.
5. Optional: put a shortcut to `start.bat` on the Desktop or Start menu. Point the shortcut at `cmd.exe /c "<path>\start.bat"` if you want Windows to offer Pin to Start.

If the controller's IP changes, update both `REMOTE_INPUT_ALLOW` and the firewall rule. A DHCP reservation in the router avoids this.

## Tips for the Windows host

- Use a separate Windows account for these sessions, with no saved passwords or personal logins.
- During a session, set sleep and screen lock to Never and keep the screen unlocked. A locked screen gives black screenshots, and UAC prompts cannot be seen or clicked remotely.
- Do not use the machine yourself while the controller is acting; input from both sides lands in whichever window is in front.
