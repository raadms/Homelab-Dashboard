"""Unit tests for parsers, merge rules and the digest baseline.

Fixtures below are SYNTHETIC samples in the exact formats the collectors
produce (ss, docker ps --format json, pct/qm config, Caddy JSON/Caddyfile).
They exist only to test parsing; they never enter the real inventory.
Run: python3 -m unittest discover -s tests -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import checks, discovery, merge, parsers  # noqa: E402
from server.store import Store  # noqa: E402

SS = """tcp   LISTEN 0      4096         0.0.0.0:8989      0.0.0.0:*    users:(("docker-proxy",pid=1,fd=4))
tcp   LISTEN 0      128          0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=2,fd=3))
tcp   LISTEN 0      4096       127.0.0.1:2019      0.0.0.0:*    users:(("caddy",pid=3,fd=7))
tcp   LISTEN 0      4096               *:443             *:*    users:(("caddy",pid=3,fd=8))
tcp   LISTEN 0      4096            [::]:8006         [::]:*    users:(("pveproxy",pid=4,fd=6))"""

DOCKER_PS = "\n".join(json.dumps(x) for x in [
    {"Names": "sonarr", "Image": "lscr.io/linuxserver/sonarr:latest", "State": "running", "Status": "Up 3 days",
     "Ports": "0.0.0.0:8989->8989/tcp, :::8989->8989/tcp", "Labels": "com.docker.compose.project=arr,com.docker.compose.service=sonarr"},
    {"Names": "postgres", "Image": "postgres:16", "State": "running", "Status": "Up", "Ports": "5432/tcp", "Labels": ""},
    {"Names": "radarr", "Image": "lscr.io/linuxserver/radarr", "State": "exited", "Status": "Exited (1) 2 hours ago",
     "Ports": "", "Labels": "com.docker.compose.project=arr,com.docker.compose.service=radarr"},
])

CADDYFILE = """### /etc/caddy/Caddyfile
(common) {
  encode gzip
}
plex.safrani.co {
  import common
  reverse_proxy 10.10.40.40:32400
}
arr.safrani.co {
  handle_path /sonarr/* {
    reverse_proxy 10.10.30.30:8989
  }
  handle /radarr/* {
    reverse_proxy http://10.10.30.30:7878
  }
  redir / /sonarr/
}
idrac.safrani.co {
  reverse_proxy https://10.10.1.33 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
"""

CADDY_JSON = {"apps": {"http": {"servers": {"srv0": {"listen": [":443"], "routes": [
    {"match": [{"host": ["plex.safrani.co"]}], "handle": [{"handler": "subroute", "routes": [
        {"handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "10.10.40.40:32400"}]}]}]}]},
    {"match": [{"host": ["arr.safrani.co"]}], "handle": [{"handler": "subroute", "routes": [
        {"match": [{"path": ["/sonarr/*"]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "10.10.30.30:8989"}]}]}]}]},
]}}}}}

PCT = """arch: amd64
hostname: arr
memory: 4096
net0: name=eth0,bridge=vmbr0,firewall=1,hwaddr=BC:24:11:AA:BB:CC,ip=10.10.30.30/24,tag=30,type=veth
onboot: 1
tags: media;arr"""

QM = """agent: 1
name: mediaserver
net0: virtio=BC:24:11:11:22:33,bridge=vmbr0,tag=40
onboot: 1"""


class Parsers(unittest.TestCase):
    def test_listeners(self):
        ls = parsers.listeners(SS)
        ports = {(l["port"], l["process"]) for l in ls}
        self.assertIn((8989, "docker-proxy"), ports)
        self.assertIn((8006, "pveproxy"), ports)
        self.assertNotIn((2019, "caddy"), ports, "loopback-only admin API must not be listed")

    def test_containers(self):
        cs = parsers.containers(DOCKER_PS, "docker")
        s = next(c for c in cs if c["name"] == "sonarr")
        self.assertEqual(s["compose_project"], "arr")
        self.assertEqual(s["ports"], [dict(host_ip="0.0.0.0", host_port=8989, container_port=8989, proto="tcp")])
        self.assertEqual(next(c for c in cs if c["name"] == "postgres")["ports"], [], "unpublished port is not a host port")

    def test_caddyfile(self):
        rs = parsers.caddyfile_routes(CADDYFILE)
        got = {(r["hosts"][0], r["paths"][0], tuple(r.get("upstreams") or []), r["action"]) for r in rs}
        self.assertIn(("plex.safrani.co", "/*", ("10.10.40.40:32400",), "reverse_proxy"), got)
        self.assertIn(("arr.safrani.co", "/sonarr/*", ("10.10.30.30:8989",), "reverse_proxy"), got)
        self.assertIn(("arr.safrani.co", "/radarr/*", ("10.10.30.30:7878",), "reverse_proxy"), got)
        self.assertTrue(any(r["action"] == "redirect" and r["hosts"][0] == "arr.safrani.co" for r in rs))
        idr = next(r for r in rs if r["hosts"][0] == "idrac.safrani.co")
        self.assertEqual(idr["upstreams"], ["10.10.1.33"])
        self.assertTrue(idr["upstream_tls"])

    def test_caddy_json(self):
        rs = parsers.caddy_json_routes(CADDY_JSON)
        self.assertEqual({(r["hosts"][0], r["paths"][0], r["upstreams"][0]) for r in rs},
                         {("plex.safrani.co", "/*", "10.10.40.40:32400"), ("arr.safrani.co", "/sonarr/*", "10.10.30.30:8989")})

    def test_nginx(self):
        rs = parsers.nginx_routes("server { listen 443 ssl; server_name media.safrani.co; location / { proxy_pass http://10.10.40.40:8096; } }")
        self.assertEqual(rs[0]["upstreams"], ["10.10.40.40:8096"])

    def test_guest_configs(self):
        n = parsers.guest_nics(parsers.kv_config(PCT))[0]
        self.assertEqual((n["mac"], n["ip"], n["vlan"]), ("bc:24:11:aa:bb:cc", "10.10.30.30", "30"))
        n = parsers.guest_nics(parsers.kv_config(QM))[0]
        self.assertEqual((n["mac"], n["ip"], n["vlan"]), ("bc:24:11:11:22:33", None, "40"))


class Classify(unittest.TestCase):
    def c(self, **kw):
        base = dict(dns=dict(ok=True, addresses=["1.2.3.4"]), tcp=dict(ok=True, ms=1))
        base.update(kw)
        return checks.classify(base)[0]

    def test_vocabulary(self):
        self.assertEqual(self.c(tcp=dict(ok=False, result="timeout")), "unreachable")
        self.assertEqual(self.c(tcp=dict(ok=False, result="refused")), "down")
        self.assertEqual(self.c(dns=dict(ok=False, error="NXDOMAIN")), "dns-fail")
        self.assertEqual(self.c(http=dict(ok=True, code=401)), "auth")
        self.assertEqual(self.c(http=dict(ok=True, code=302, location="/login?next=/")), "auth")
        self.assertEqual(self.c(http=dict(ok=True, code=302, location="/web/index.html")), "up")
        self.assertEqual(self.c(http=dict(ok=True, code=502)), "down")
        self.assertEqual(self.c(http=dict(ok=True, code=404)), "degraded")
        self.assertEqual(self.c(), "reachable", "sensitive endpoint without HTTP is reachable, not up")


class EndToEnd(unittest.TestCase):
    """Synthetic Proxmox + guest + Caddy runs through the real builder, offline."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        ext = os.path.join(self.tmp, "extracted")

        def run(name, files, meta):
            d = os.path.join(ext, name)
            os.makedirs(d)
            with open(os.path.join(d, "_meta.txt"), "w") as f:
                f.write("\n".join(f"{k}={v}" for k, v in meta.items()))
            with open(os.path.join(d, "manifest.tsv"), "w") as f:
                f.write("name\texit\tseconds\tcommand\n")
            for k, v in files.items():
                with open(os.path.join(d, k + ".txt"), "w") as f:
                    f.write(v)
        run("proxmox-pve-1", {
            "cluster_resources": json.dumps([
                dict(type="node", node="pve", status="online", maxcpu=16, cpu=0.1, mem=8e9, maxmem=64e9, disk=1e11, maxdisk=1e12, uptime=1000),
                dict(type="lxc", node="pve", vmid=130, name="arr", status="running", uptime=500),
                dict(type="qemu", node="pve", vmid=140, name="mediaserver", status="stopped")]),
            "cluster_status": json.dumps([dict(type="cluster", name="safrani-cluster", quorate=1), dict(type="node", name="pve", ip="10.10.10.10", online=1)]),
            "pct_130_config": PCT, "qm_140_config": QM,
            "pct_130_inside": "## ip\neth0@if5 UP 10.10.30.30/24\n## listening\n" + SS.splitlines()[0] + "\n## docker ps\n" + DOCKER_PS,
            "listening": SS,
        }, dict(collector="proxmox", hostname="pve", collected_at_utc="20261019T100000Z"))
        run("guest-proxy-1", {"ip_addr": "eth0 UP 50.50.50.10/24", "caddy_caddyfile": CADDYFILE, "listening": SS},
            dict(collector="guest", hostname="proxy", collected_at_utc="20261019T100000Z"))
        self.cfg = {}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def build(self):
        orig = discovery.source_dns
        discovery.source_dns = lambda names: dict(status="ok", at="t", records={
            "arr.safrani.co": dict(name="arr.safrani.co", ok=True, addresses=["50.50.50.10"]),
            "plex.safrani.co": dict(name="plex.safrani.co", ok=True, addresses=["50.50.50.10"])})
        try:
            return discovery.build(self.cfg, self.tmp)
        finally:
            discovery.source_dns = orig

    def test_build(self):
        inv = self.build()
        n = next(n for n in inv["nodes"] if n["name"] == "pve")
        self.assertTrue(n["verified"])
        self.assertEqual(n["cluster"], "safrani-cluster")
        w = {w["vmid"]: w for w in inv["workloads"]}
        self.assertEqual(w[130]["ips"], ["10.10.30.30"])
        self.assertEqual(w[140]["status"], "stopped")
        sonarr = next(a for a in inv["apps"] if a["name"] == "Sonarr")
        urls = {e["url"]: e for e in sonarr["endpoints"]}
        self.assertIn("http://10.10.30.30:8989/", urls)
        self.assertIn("https://arr.safrani.co/sonarr/", urls, "path route must attach to the container app")
        self.assertEqual(urls["https://arr.safrani.co/sonarr/"]["upstream"], "10.10.30.30:8989")
        self.assertEqual(sonarr["location"]["compose_project"], "arr")
        self.assertTrue(any(i["type"] == "stopped-workload" for i in inv["issues"]))
        self.assertTrue(any(i["type"] == "container-state" and "radarr" in i["title"] for i in inv["issues"]))
        plex = next(r for r in inv["routes"] if r["hosts"] == ["plex.safrani.co"])
        self.assertTrue(plex["upstream_status"].startswith("unmatched"), "plex backend not collected: must not be claimed verified")

    def test_overrides_survive_and_diff(self):
        st = Store(os.path.join(self.tmp, "t.db"))
        inv1 = self.build()
        st.save_snapshot(inv1)
        sonarr = next(a for a in inv1["apps"] if a["name"] == "Sonarr")
        st.set_override(sonarr["id"], dict(name="TV", hidden=True, preferred_url="https://arr.safrani.co/sonarr/"))
        inv2 = self.build()
        inv2["workloads"] = [dict(w, status="running") if w["vmid"] == 140 else w for w in inv2["workloads"]]
        st.save_snapshot(inv2)
        m = merge.merged(st, inv2)
        a = next(x for x in m["apps"] if x["id"] == sonarr["id"])
        self.assertEqual((a["name"], a["hidden"], a["discovered_name"]), ("TV", True, "Sonarr"))
        self.assertEqual(next(e for e in a["endpoints"] if e["id"] == a["preferred_domain"])["url"], "https://arr.safrani.co/sonarr/")
        ch = merge.diff(inv1, inv2)
        self.assertTrue(any(c["type"] == "workload-started" for c in ch))
        with self.assertRaises(ValueError):
            st.set_override(sonarr["id"], dict(extra_endpoints=["file:///etc/passwd"]))

    def test_digest_baseline(self):
        st = Store(os.path.join(self.tmp, "t2.db"))
        st.save_snapshot(self.build())
        d = merge.build_digest(st, merge.merged(st, st.snapshot(0)[1]))
        self.assertIn("Baseline", d["baseline_note"])
        self.assertEqual(d["changes"], [])


if __name__ == "__main__":
    unittest.main()
