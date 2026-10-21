"""Deep scan: the dashboard runs the read-only collector on each Proxmox node
over SSH and imports the result. This is the only way to see *inside* VMs and
LXCs (containers, Docker/Traefik/Caddy config) without Portainer, because no
read-only Proxmox API permission allows looking inside a guest.

Security model
- The dashboard owns an ed25519 key in <data>/ssh/. The private key never
  leaves the container; the UI only shows the public key.
- On the node the key is installed with a *forced command*:
      command="/usr/local/sbin/homelab-collect --stdout",restrict ssh-ed25519 …
  so whatever the client asks for, sshd runs only the read-only collector.
  `restrict` disables shell/PTY, port, agent and X11 forwarding.
- Host keys are pinned on first use in <data>/ssh/known_hosts.
"""
import os
import shutil
import subprocess
import time

KEEP_PER_HOST = 3


def ssh_dir(data):
    d = os.path.join(data, "ssh")
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def ensure_key(data):
    d = ssh_dir(data)
    key = os.path.join(d, "id_ed25519")
    if not os.path.exists(key):
        if not shutil.which("ssh-keygen"):
            raise RuntimeError("ssh-keygen is not installed in this image")
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "homelab-dashboard", "-f", key], check=True)
    with open(key + ".pub") as f:
        return f.read().strip()


def install_line(pub):
    return f'command="/usr/local/sbin/homelab-collect --stdout",restrict {pub}'


def install_command(pub, script_url):
    """One paste on a Proxmox node shell (as root). In a cluster the
    authorized_keys file is shared, but the script must exist on every node."""
    line = install_line(pub)
    return ("curl -fsSL " + script_url + " -o /usr/local/sbin/homelab-collect && chmod 755 /usr/local/sbin/homelab-collect && "
            "mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys && "
            "grep -qF '" + pub.split()[1] + "' /root/.ssh/authorized_keys || echo '" + line + "' >> /root/.ssh/authorized_keys && "
            "echo 'homelab-dashboard deep scan installed'")


def scan_host(data, host, user="root", port=22, timeout=300):
    """Run the forced-command collector on one host. Returns dict(status, detail|error, file)."""
    d = ssh_dir(data)
    key = os.path.join(d, "id_ed25519")
    if not os.path.exists(key):
        return dict(status="error", error="no SSH key yet")
    cmd = ["ssh", "-i", key, "-p", str(port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
           "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={os.path.join(d, 'known_hosts')}",
           "-o", "IdentitiesOnly=yes", "-o", "ServerAliveInterval=15", f"{user}@{host}", "scan"]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return dict(status="error", error=f"{host}: scan took longer than {timeout} s")
    except FileNotFoundError:
        return dict(status="error", error="ssh client is not installed in this image")
    err = p.stderr.decode("utf-8", "replace").strip().splitlines()
    if p.returncode != 0 or p.stdout[:2] != b"\x1f\x8b":
        last = next((l for l in reversed(err) if l and not l.startswith("[collector]")), "") or f"exit code {p.returncode}"
        if "Permission denied" in last:
            last += " — the dashboard key is not installed on this node yet"
        elif "timed out" in last or "No route" in last:
            last += " — the firewall blocks SSH (TCP 22) from the dashboard to this node"
        elif "not found" in last or p.returncode == 127:
            last = "/usr/local/sbin/homelab-collect is missing on this node — run the install command there"
        return dict(status="error", error=f"{host}: {last[:240]}")
    inc = os.path.join(data, "incoming")
    os.makedirs(inc, exist_ok=True)
    name = f"deepscan-{host.replace(':', '_')}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.tar.gz"
    with open(os.path.join(inc, name), "wb") as f:
        f.write(p.stdout)
    prune(inc, host)
    return dict(status="ok", detail=f"{host}: scanned in {int(time.time() - t0)} s", file=name)


def prune(inc, host):
    mine = sorted(f for f in os.listdir(inc) if f.startswith(f"deepscan-{host.replace(':', '_')}-"))
    for f in mine[:-KEEP_PER_HOST]:
        try:
            os.remove(os.path.join(inc, f))
        except OSError:
            pass
