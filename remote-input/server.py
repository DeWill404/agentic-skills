"""LAN remote input server: screenshot plus mouse/keyboard for ONE trusted client.

Run by hand only. Exits after --minutes. Slam the real mouse into a screen corner to kill it.
"""
import argparse
import ctypes
import hmac
import io
import json
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# Must run before pyautogui is imported, so screenshot pixels and input coordinates are both physical pixels on scaled displays.
ctypes.windll.shcore.SetProcessDpiAwareness(2)
import pyautogui  # noqa: E402

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05
MAX_EDGE = 1568  # ponytail: primary monitor only, add monitor selection if a second screen matters
TWEEN = pyautogui.easeInOutQuad
WHEEL_NOTCH = 120  # pyautogui on Windows passes the raw wheel delta, one notch is 120

W, H = pyautogui.size()
SCALE = min(1.0, MAX_EDGE / max(W, H))
TOKEN = secrets.token_urlsafe(24)
ALLOW = None


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent, this only picks the default-route interface
        return s.getsockname()[0]
    finally:
        s.close()


def pt(a, suffix=""):
    return round(a["x" + suffix] / SCALE), round(a["y" + suffix] / SCALE)


def act(a):
    kind = a["action"]
    dur = float(a.get("duration", 0.3))
    button = a.get("button", "left")
    if kind in ("move", "click", "drag", "scroll"):
        pyautogui.moveTo(*pt(a), duration=dur, tween=TWEEN)
    if kind == "move":
        pass
    elif kind == "click":
        pyautogui.click(clicks=int(a.get("clicks", 1)), button=button)
    elif kind == "drag":
        pyautogui.dragTo(*pt(a, "2"), duration=max(dur, 0.5), tween=TWEEN, button=button)
    elif kind == "scroll":
        pyautogui.scroll(int(a["notches"]) * WHEEL_NOTCH)  # positive scrolls up, negative scrolls down
    elif kind == "type":
        pyautogui.write(a["text"], interval=float(a.get("interval", 0.03)))  # ASCII only
    elif kind == "key":
        pyautogui.hotkey(*a["keys"])
    else:
        raise ValueError("unknown action: " + kind)


class Handler(BaseHTTPRequestHandler):
    def _allowed(self):
        if self.client_address[0] != ALLOW:
            self.send_error(403)
            return False
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            self.send_error(401)
            return False
        return True

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._allowed():
            return
        if self.path != "/screenshot":
            return self.send_error(404)
        img = pyautogui.screenshot()
        if SCALE < 1:
            img = img.resize((round(W * SCALE), round(H * SCALE)))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        self._send(200, buf.getvalue(), "image/png")

    def do_POST(self):
        if not self._allowed():
            return
        if self.path != "/act":
            return self.send_error(404)
        try:
            act(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)))))
        except pyautogui.FailSafeException:
            print("Failsafe triggered (mouse in a corner). Exiting.")
            os._exit(1)
        except Exception as e:
            return self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")
        self._send(200, b'{"ok": true}', "application/json")

    def log_message(self, fmt, *args):
        print(time.strftime("%H:%M:%S"), self.client_address[0], fmt % args)


def main():
    global ALLOW
    p = argparse.ArgumentParser()
    p.add_argument("--allow", required=True, help="the single client IP allowed to connect")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--minutes", type=float, default=30)
    p.add_argument("--host", help="IP to listen on, default is this machine's LAN IP")
    args = p.parse_args()
    ALLOW = args.allow
    host = args.host or lan_ip()

    t = threading.Timer(args.minutes * 60, lambda: (print("Time limit reached. Exiting."), os._exit(0)))
    t.daemon = True
    t.start()

    print(f"URL    http://{host}:{args.port}")
    print(f"TOKEN  {TOKEN}")
    print(f"Screen {W}x{H}, screenshot {round(W * SCALE)}x{round(H * SCALE)}, allowed client {ALLOW}")
    print(f"Exits in {args.minutes:g} min. Ctrl+C or mouse into a corner to stop now.")
    HTTPServer((host, args.port), Handler).serve_forever()  # single-threaded on purpose so actions never overlap


if __name__ == "__main__":
    main()
