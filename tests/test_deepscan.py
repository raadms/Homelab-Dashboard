"""Deep scan over SSH, with a fake `ssh` on PATH (no network)."""
import os
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import deepscan  # noqa: E402

FAKE = """#!/bin/sh
case "$FAKE_MODE" in
  ok) printf 'payload' | gzip -c ;;
  denied) echo "root@10.10.10.10: Permission denied (publickey)." >&2; exit 255 ;;
  timeout) echo "ssh: connect to host 10.10.10.10 port 22: Connection timed out" >&2; exit 255 ;;
esac
"""


class DeepScan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        bin_ = os.path.join(self.tmp, "bin"); os.makedirs(bin_)
        p = os.path.join(bin_, "ssh")
        with open(p, "w") as f:
            f.write(FAKE)
        os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
        self.path = os.environ["PATH"]
        os.environ["PATH"] = bin_ + os.pathsep + self.path
        self.data = os.path.join(self.tmp, "data")

    def tearDown(self):
        os.environ["PATH"] = self.path

    def test_key_and_install_line(self):
        pub = deepscan.ensure_key(self.data)
        self.assertTrue(pub.startswith("ssh-ed25519 "))
        line = deepscan.install_line(pub)
        self.assertTrue(line.startswith('command="/usr/local/sbin/homelab-collect --stdout",restrict ssh-ed25519 '))
        self.assertEqual(oct(os.stat(os.path.join(self.data, "ssh", "id_ed25519")).st_mode & 0o777), "0o600")
        cmd = deepscan.install_command(pub, "https://example.invalid/collect.sh")
        self.assertIn("grep -qF", cmd)  # idempotent: running it twice does not duplicate the key

    def test_scan_results(self):
        deepscan.ensure_key(self.data)
        os.environ["FAKE_MODE"] = "ok"
        r = deepscan.scan_host(self.data, "10.10.10.10")
        self.assertEqual(r["status"], "ok")
        self.assertTrue(os.path.exists(os.path.join(self.data, "incoming", r["file"])))
        os.environ["FAKE_MODE"] = "denied"
        self.assertIn("not installed on this node", deepscan.scan_host(self.data, "10.10.10.10")["error"])
        os.environ["FAKE_MODE"] = "timeout"
        self.assertIn("firewall", deepscan.scan_host(self.data, "10.10.10.10")["error"])

    def test_prune_keeps_latest(self):
        inc = os.path.join(self.data, "incoming"); os.makedirs(inc)
        for i in range(6):
            open(os.path.join(inc, f"deepscan-pve-2026100{i}T000000Z.tar.gz"), "w").close()
        deepscan.prune(inc, "pve")
        self.assertEqual(len(os.listdir(inc)), deepscan.KEEP_PER_HOST)


if __name__ == "__main__":
    unittest.main()
