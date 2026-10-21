"""The read-only agent: runs the real agent.py against a fake Docker socket."""
import hashlib
import hmac
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import UnixStreamServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import live  # noqa: E402

KEY = "a" * 64
CONTAINERS = [{"Names": ["/sonarr"], "Image": "lscr.io/linuxserver/sonarr", "State": "running", "Status": "Up 2 days", "Created": 1760000000,
               "Ports": [{"IP": "0.0.0.0", "PrivatePort": 8989, "PublicPort": 8989, "Type": "tcp"}],
               "Labels": {"com.docker.compose.project": "arr-stack", "traefik.http.routers.sonarr.rule": "Host(`sonarr-arr.safrani.co`)",
                          "traefik.http.services.sonarr.loadbalancer.server.port": "8989",
                          "traefik.http.middlewares.auth.basicauth.users": "admin:$2y$05$SECRETHASH", "my.secret.token": "SECRET"},
               "NetworkSettings": {"Networks": {"proxy": {}}}, "Env": ["DB_PASSWORD=SECRET"]}]
SEEN = []


class FakeDocker(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def address_string(self): return "unix"
    def do_GET(self):
        SEEN.append(self.path)
        b = json.dumps(CONTAINERS).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)


class Agent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.sock = os.path.join(cls.tmp, "docker.sock")
        srv = UnixStreamServer(cls.sock, FakeDocker)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        cls.port = 19180
        cls.p = subprocess.Popen([sys.executable, os.path.join(ROOT, "agent", "agent.py")],
                                 env=dict(os.environ, AGENT_KEY=KEY, AGENT_PORT=str(cls.port), DOCKER_SOCK=cls.sock), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), 0.2).close(); break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate(); cls.p.wait(5)

    def get(self, path, auth=None, method="GET"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, headers={"Authorization": auth} if auth else {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def sig(self, path, ts=None, key=KEY):
        ts = ts or int(time.time())
        return f"HMAC {ts}:" + hmac.new(key.encode(), f"{ts}\n{path}".encode(), hashlib.sha256).hexdigest()

    def test_auth(self):
        self.assertEqual(self.get("/v1/containers")[0], 401)
        self.assertEqual(self.get("/v1/containers", self.sig("/v1/containers", key="b" * 64))[0], 401)
        self.assertEqual(self.get("/v1/containers", self.sig("/v1/containers", ts=int(time.time()) - 300))[0], 401, "replayed/old signature")
        self.assertEqual(self.get("/v1/containers", self.sig("/v1/containers"))[0], 200)

    def test_read_only_surface(self):
        self.assertEqual(self.get("/containers/sonarr/json", self.sig("/containers/sonarr/json"))[0], 404)
        self.assertEqual(self.get("/v1/containers", self.sig("/v1/containers"), method="POST")[0], 405)
        self.assertEqual(set(SEEN), {"/containers/json?all=1"}, "the agent must never call any other Docker API")

    def test_no_secrets(self):
        code, d = self.get("/v1/containers", self.sig("/v1/containers"))
        blob = json.dumps(d)
        self.assertNotIn("SECRET", blob)
        self.assertNotIn("Env", d["containers"][0])
        self.assertIn("traefik.http.routers.sonarr.rule", d["containers"][0]["Labels"])

    def test_dashboard_connector(self):
        st, hosts = live.agents([dict(host=f"127.0.0.1:{self.port}", key=KEY)])
        self.assertEqual(st["status"], "ok")
        c = hosts["127.0.0.1"]["containers"][0]
        self.assertEqual((c["name"], c["compose_project"], c["ports"][0]["host_port"]), ("sonarr", "arr-stack", 8989))
        self.assertEqual(c["traefik_routes"][0]["hosts"], ["sonarr-arr.safrani.co"])
        st, _ = live.agents([dict(host=f"127.0.0.1:{self.port}", key="c" * 64)])
        self.assertEqual(st["status"], "error")
        self.assertIn("key does not match", st["error"])

    def test_refuses_short_key(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "agent", "agent.py")], env=dict(os.environ, AGENT_KEY="short"), capture_output=True, text=True, timeout=10)
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
