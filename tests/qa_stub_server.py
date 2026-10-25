#!/usr/bin/env python3
"""Tiny stand-in for the LocalHub server, so the web UI can be exercised offline.

It mimics AssetServer's routing and answers the /api/* endpoints with plausible
payloads. It is a TEST HARNESS ONLY - it never runs on the phone.
"""
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parents[1] / "app/src/main/assets"
PORT = 8099

ROUTES = {
    "/": "dashboard/index.html",
    "/index.html": "dashboard/index.html",
    "/login.html": "dashboard/login.html",
    "/files": "dashboard/files.html",
    "/player": "dashboard/player.html",
    "/core": "dashboard/core.html",
    "/selfheal.html": "dashboard/selfheal.html",
    "/style.css": "dashboard/style.css",
    "/app.js": "dashboard/app.js",
    "/visuals.js": "dashboard/visuals.js",
    "/core.js": "dashboard/core.js",
    "/animations.css": "animations.css",
    "/animations.js": "animations.js",
    "/manifest.webmanifest": "dashboard/manifest.webmanifest",
}

MIME = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json",
}

SYSTEM = {
    "device": {"model": "Nothing Phone", "manufacturer": "Nothing", "brand": "Nothing",
               "version": "5.10.209", "sdk": 34},
    "network": {"ipAddress": "192.168.0.101", "ssid": "HomeNet", "bssid": "aa:bb:cc:dd:ee:ff",
                "linkSpeedMbps": 866, "type": "WIFI", "isConnected": True},
    "storage": {"totalBytes": 128_000_000_000, "availableBytes": 47_000_000_000,
                "usedBytes": 81_000_000_000, "path": "/storage/emulated/0", "usagePercent": 63.3},
    "cpu": {"cores": 8, "model": "mt6886", "architecture": "arm64-v8a",
            "minFreqKhz": 500_000, "maxFreqKhz": 3_000_000, "usagePercent": 22.5, "available": True},
    "memory": {"totalBytes": 8_000_000_000, "availableBytes": 3_200_000_000,
               "usedBytes": 4_800_000_000, "lowMemory": False, "usagePercent": 60.0},
    "battery": {"level": 87, "scale": 100, "temperatureCelsius": 34.8, "voltage": 3900,
                "isCharging": False, "plugged": "UNPLUGGED", "health": "GOOD", "technology": "Li-ion"},
}

STATUS = {
    "running": True, "version": "1.0.22", "name": "LocalHub", "hostname": "localhub.local",
    "port": PORT, "host": "192.168.0.101", "url": "http://192.168.0.101:8080",
    "uptimeMs": 3_942_000, "restartCount": 0, "protocol": "http",
}

CLIENTS = {"clients": [
    {"id": "c1", "ip": "192.168.0.105", "userAgent": "Mozilla/5.0 (Windows NT 10.0) Chrome/122",
     "connectedAt": 1_700_000_000_000, "lastActivity": 1_700_000_120_000, "protocol": "HTTP"},
    {"id": "c2", "ip": "192.168.0.142", "userAgent": "Mozilla/5.0 (Macintosh) Safari/605.1.15",
     "connectedAt": 1_700_000_050_000, "lastActivity": 1_700_000_180_000, "protocol": "WebSocket"},
]}

MODULES = [
    {"id": "core.server", "name": "Server", "description": "HTTP/WebSocket server",
     "version": "1.0", "enabled": True, "category": "core", "capabilities": [], "limitations": [],
     "accessibility": "admin"},
    {"id": "core.files", "name": "File manager", "description": "Browse, upload, download",
     "version": "1.0", "enabled": True, "category": "files", "capabilities": [], "limitations": [],
     "accessibility": "all"},
    {"id": "core.media", "name": "Media player", "description": "Stream with range support",
     "version": "1.0", "enabled": True, "category": "media", "capabilities": [], "limitations": [],
     "accessibility": "all"},
]

LOGS = {"logs": [
    {"id": 3, "timestamp": 1_700_000_180_000, "level": "INFO", "tag": "HTTP", "message": "GET /files from 192.168.0.105"},
    {"id": 2, "timestamp": 1_700_000_120_000, "level": "WARNING", "tag": "Upload", "message": "Upload rejected: file too large"},
    {"id": 1, "timestamp": 1_700_000_000_000, "level": "INFO", "tag": "Service", "message": "Server started on port 8080"},
]}

FILES = {
    "path": "/storage/emulated/0", "name": "0", "parent": "",
    "folders": [{"name": "Download", "path": "/storage/emulated/0/Download", "size": 0,
                 "modified": 1_700_000_000_000, "isDir": True}],
    "files": [
        {"name": "Interstellar.2014.1080p.mkv", "path": "/storage/emulated/0/Interstellar.2014.1080p.mkv",
         "size": 19_770_000_000, "modified": 1_700_000_000_000, "isDir": False,
         "mime": "video/x-matroska", "category": "video"},
        {"name": "backup.zip", "path": "/storage/emulated/0/backup.zip", "size": 512_000_000,
         "modified": 1_699_000_000_000, "isDir": False, "mime": "application/zip", "category": "archive"},
    ],
    "truncated": False, "shown": 3, "total": 3, "limit": 500,
}

# 1x1 transparent PNG so <img src="/api/qr"> resolves like a real QR would.
# Smallest playable MP4 (1 frame, black). Enough for the <video> element to
# report metadata so the player's controls become visible.
TINY_MP4 = bytes.fromhex(
    "00000018667479706d703432000000006d70343269736f6d0000001c66726565000000106d646174"
)

PNG_1PX = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
           b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
           b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")


def api_response(path: str, query: dict) -> bytes:
    if path == "auth/session":
        return json.dumps({"authenticated": True, "role": "admin", "user": "admin"}).encode()
    if path == "status":
        return json.dumps(STATUS).encode()
    if path == "system":
        return json.dumps(SYSTEM).encode()
    if path in ("device", "network", "storage", "cpu", "memory", "battery"):
        return json.dumps(SYSTEM[path]).encode()
    if path == "clients":
        return json.dumps(CLIENTS).encode()
    if path == "modules":
        return json.dumps(MODULES).encode()
    if path == "logs":
        return json.dumps(LOGS).encode()
    if path == "files" or path == "fs/list":
        return json.dumps(FILES).encode()
    if path == "dashboard":
        return json.dumps({"status": STATUS, "system": SYSTEM}).encode()
    if path == "qr":
        return PNG_1PX
    if path == "fs/content":
        return TINY_MP4
    return json.dumps({"ok": True}).encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, body: bytes, mime: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = dict(kv.split("=", 1) for kv in parsed.query.split("&") if "=" in kv)

        if path.startswith("/api/"):
            body = api_response(path[len("/api/"):], query)
            return self._send(body, "application/json")

        target = None
        if path in ROUTES:
            target = ROUTES[path]
        elif path.startswith("/ai/") or path in ("/ai",):
            target = "ai/index.html" if path in ("/ai", "/ai/", "/ai/index.html") else "ai/" + path[4:]
        elif path.startswith("/console/") or path in ("/console",):
            target = "console/index.html" if path in ("/console", "/console/") else "console/" + path[9:]
        elif path.startswith("/dashboard/"):
            target = "dashboard/" + path[len("/dashboard/"):]
        elif re.match(r"^/[A-Za-z0-9._-]+\.(css|js|png|json|webmanifest)$", path):
            target = "dashboard/" + path[1:]

        if not target:
            return self._send(b"not found", "text/plain", 404)
        file = ROOT / target
        if not file.exists():
            return self._send(("missing " + target).encode(), "text/plain", 404)
        self._send(file.read_bytes(), MIME.get(file.suffix, "application/octet-stream"))

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        parsed = urlparse(self.path)
        self._send(json.dumps({"ok": True}).encode(), "application/json")


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
