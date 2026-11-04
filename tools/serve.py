#!/usr/bin/env python3
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEARCH = [ROOT / "source/web", ROOT / "tools"]
TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}


def locate(name):
    for folder in SEARCH:
        path = folder / name
        if path.is_file():
            return path
    return None


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.split("?", 1)[0].rsplit("/", 1)[-1] or "index.html"
        path = locate(name)
        if path is None:
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(path.suffix, "application/octet-stream"))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8201
    print(f"Sleuth preview: http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
