"""Live API connectors, exercised against canned responses in the real API shapes."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import live  # noqa: E402

PVE = {
    "/cluster/resources": [dict(type="node", node="pve", status="online"),
                           dict(type="lxc", node="pve", vmid=111, name="plex", status="running"),
                           dict(type="qemu", node="pve", vmid=104, name="Arr-Stack", status="running")],
    "/cluster/status": [dict(type="cluster", name="safrani-cluster", quorate=1)],
    "/nodes/pve/lxc/111/config": dict(hostname="plex", net0="name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:01,ip=dhcp,tag=30", onboot=1),
    "/nodes/pve/lxc/111/interfaces": [dict(name="lo", inet="127.0.0.1/8"), dict(name="eth0", inet="10.10.30.40/24", hwaddr="bc:24:11:00:00:01")],
    "/nodes/pve/qemu/104/config": dict(name="Arr-Stack", agent="1", net0="virtio=BC:24:11:00:00:02,bridge=vmbr0,tag=30", cipassword="x"),
    "/nodes/pve/qemu/104/agent/network-get-interfaces": {"result": [{"name": "eth0", "hardware-address": "bc:24:11:00:00:02",
                                                                     "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "10.10.30.30"}]}]},
}
PORT = {
    "/endpoints": [dict(Id=2, Name="local", URL="unix:///var/run/docker.sock")],
    "/endpoints/2/docker/containers/json?all=1": [dict(Names=["/sonarr"], Image="lscr.io/linuxserver/sonarr", State="running", Status="Up 2 days",
        Created=1760000000, Ports=[dict(IP="0.0.0.0", PrivatePort=8989, PublicPort=8989, Type="tcp")],
        Labels={"com.docker.compose.project": "arr-stack", "traefik.http.routers.sonarr.rule": "Host(`sonarr-arr.safrani.co`)",
                "traefik.http.services.sonarr.loadbalancer.server.port": "8989"})],
}


class Live(unittest.TestCase):
    def setUp(self):
        self.orig = (live._get, live._read)
        live._read = lambda n: {"pve_token": "dashboard@pve!dash=00000000-0000-0000-0000-000000000000",
                                "portainer_tokens": "10.10.30.30=ptr_x"}.get(n)
        self.seen = []

        def get(url, headers, timeout=12):
            self.seen.append((url, headers))
            path = url.split("/api2/json", 1)[-1] if "/api2/json" in url else url.split("/api", 1)[-1]
            return {"data": PVE[path]} if "8006" in url else PORT[path]
        live._get = get

    def tearDown(self):
        live._get, live._read = self.orig

    def test_proxmox_and_portainer(self):
        st, runs = live.proxmox(["10.10.10.10"])
        self.assertEqual(st["status"], "ok")
        g = runs[0]["guests"]
        self.assertEqual([i["ip"] for i in g[111]["agent_ips"]], ["10.10.30.40"])
        self.assertEqual([i["ip"] for i in g[104]["agent_ips"]], ["10.10.30.30"])
        self.assertTrue(all("PVEAPIToken=" in h["Authorization"] for u, h in self.seen if "8006" in u))
        dst, hosts = live.portainer()
        self.assertEqual(dst["status"], "ok")
        c = hosts["10.10.30.30"]["containers"][0]
        self.assertEqual((c["name"], c["compose_project"], c["ports"][0]["host_port"]), ("sonarr", "arr-stack", 8989))
        self.assertEqual(c["traefik_routes"][0]["hosts"], ["sonarr-arr.safrani.co"])
        merged = live.merge_runs([], runs, hosts)
        self.assertEqual(merged[0]["guests"][104]["inside"]["containers"][0]["name"], "sonarr")
        # tokens only ever go to the host they belong to
        for url, h in self.seen:
            if "X-API-Key" in h:
                self.assertIn("10.10.30.30", url)

    def test_missing_and_bad_tokens(self):
        live._read = lambda n: None
        self.assertEqual(live.proxmox(["x"])[0]["status"], "not-configured")
        live._read = lambda n: "root@pam:password"
        self.assertEqual(live.proxmox(["x"])[0]["status"], "error")


if __name__ == "__main__":
    unittest.main()
