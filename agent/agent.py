"""homelab-dashboard-agent — read-only container lister for one Docker host.

Answers exactly one question: "which containers run here?" It talks to the
Docker socket with a single GET /containers/json and returns a filtered list.
There is no code path that starts, stops, execs, inspects, or reads logs or
environment variables.

Authentication: every request carries an HMAC-SHA256 signature of
"<unix time>\\n<path>" made with the shared key. The key itself never crosses
the network; signatures older than 60 s are rejected.

Env: AGENT_KEY (required, 32+ chars), AGENT_PORT (default 9180),
     DOCKER_SOCK (default /var/run/docker.sock)
"""
import hashlib
import hmac
import http.client
import json
import os
import re
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
KEY = os.environ.get("AGENT_KEY", "")
PORT = int(os.environ.get("AGENT_PORT", "9180"))
SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")
MAX_SKEW = 60
# Labels worth showing on a dashboard. Everything else (which can hold secrets,
# e.g. basic-auth hashes in Traefik middlewares) is dropped.
KEEP_LABEL = re.compile(r"^(com\.docker\.compose\.(project|service)|traefik\.enable|traefik\.http\.routers\.[^.]+\.(rule|service)|"
                        r"traefik\.http\.services\.[^.]+\.loadbalancer\.server\.port|org\.opencontainers\.image\.(title|version))$")


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=10)
        self.path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(10)
        s.connect(self.path)
        self.sock = s


def list_containers():
    c = UnixHTTP(SOCK)
    c.request("GET", "/containers/json?all=1")  # the only Docker API call this program makes
    r = c.getresponse()
    data = json.loads(r.read())
    c.close()
    out = []
    for x in data:
        out.append(dict(
            Names=x.get("Names") or [], Image=x.get("Image"), State=x.get("State"), Status=x.get("Status"), Created=x.get("Created"),
            Ports=[{k: p.get(k) for k in ("IP", "PrivatePort", "PublicPort", "Type")} for p in x.get("Ports") or []],
            Labels={k: v for k, v in (x.get("Labels") or {}).items() if KEEP_LABEL.match(k)},
            Networks=sorted(((x.get("NetworkSettings") or {}).get("Networks") or {}).keys()),
        ))
    return out


def valid(sig_header, path):
    m = re.match(r"^HMAC (\d{9,11}):([0-9a-f]{64})$", sig_header or "")
    if not m:
        return False
    ts, sig = int(m.group(1)), m.group(2)
    if abs(time.time() - ts) > MAX_SKEW:
        return False
    want = hmac.new(KEY.encode(), f"{ts}\n{path}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)


class H(BaseHTTPRequestHandler):
    server_version = "homelab-agent"
    sys_version = ""

    def log_message(self, fmt, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            return self.send(200, dict(ok=True))
        if self.path != "/v1/containers":
            return self.send(404, dict(error="not found"))
        if not valid(self.headers.get("Authorization"), self.path):
            time.sleep(0.3)
            return self.send(401, dict(error="bad or expired signature (check the key and that both clocks are correct)"))
        try:
            return self.send(200, dict(agent=VERSION, at=int(time.time()), hostname=os.environ.get("AGENT_HOSTNAME") or socket.gethostname(), containers=list_containers()))
        except (OSError, ValueError) as e:
            return self.send(502, dict(error=f"docker socket: {type(e).__name__}"))

    def do_POST(self):
        self.send(405, dict(error="read-only"))
    do_PUT = do_DELETE = do_PATCH = do_POST


def main():
    if len(KEY) < 32:
        sys.exit("AGENT_KEY must be set to at least 32 characters (generate one in the dashboard: Admin → Connections → Docker agents).")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print(f"homelab-dashboard-agent {VERSION} listening on :{PORT} (read-only)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
