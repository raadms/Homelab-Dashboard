"""Low-impact health checks: DNS, TCP, TLS certificate, one HTTP request.

Rules
- One GET per endpoint per run, no credentials, no redirects followed (the
  Location is recorded instead), body capped at 64 KiB.
- Sensitive management endpoints (Proxmox, iDRAC, PiKVM, UniFi, TrueNAS…) get
  TCP+TLS on every run and an HTTP request at most every SENSITIVE_HTTP_EVERY.
- 401/403 or a redirect to a login page count as "auth" (the app is up).
- A timeout or "no route" means *unreachable from this collector*, which is not
  the same as the application being down. "Connection refused" means the host
  answered but nothing listens on that port.
"""
import http.client
import os
import re
import socket
import ssl
import tempfile
import time
from datetime import datetime, timezone

SENSITIVE_HTTP_EVERY = 6 * 3600
UA = "homelab-dashboard-healthcheck/1.0 (read-only)"


def _now():
    return time.time()


def dns(host, timeout=3.0):
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", host or ""):
        return dict(ok=True, addresses=[host], skipped=True)
    socket.setdefaulttimeout(timeout)
    try:
        _, _, addrs = socket.gethostbyname_ex(host)
        return dict(ok=True, addresses=sorted(set(addrs)))
    except OSError as e:
        return dict(ok=False, error="NXDOMAIN" if getattr(e, "errno", None) in (socket.EAI_NONAME, -2) else str(e))


def tcp(ip, port, timeout=4.0):
    t0 = _now()
    try:
        s = socket.create_connection((ip, port), timeout)
        s.close()
        return dict(ok=True, ms=int((_now() - t0) * 1000))
    except socket.timeout:
        return dict(ok=False, result="timeout")
    except ConnectionRefusedError:
        return dict(ok=False, result="refused")
    except OSError as e:
        msg = str(e).lower()
        return dict(ok=False, result="no-route" if "unreachable" in msg or "no route" in msg else "error", error=str(e)[:120])


def _parse_cert_time(v):
    return datetime.strptime(v, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)


def tls(ip, port, sni, timeout=5.0):
    out = dict(ok=False)
    ctx = ssl.create_default_context()
    if not sni:
        ctx.check_hostname = False  # IP access: the chain is still verified
    try:
        with socket.create_connection((ip, port), timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=sni) as ss:
                cert = ss.getpeercert()
                out.update(ok=True, verified=True, version=ss.version())
    except ssl.SSLCertVerificationError as e:
        out.update(verified=False, verify_error=(e.verify_message or str(e))[:160])
        cert = _unverified_cert(ip, port, sni, timeout)
        out["ok"] = cert is not None
    except (ssl.SSLError, OSError, ValueError) as e:
        out.update(error=str(e)[:160])
        return out
    if cert:
        try:
            exp = _parse_cert_time(cert["notAfter"])
            out["expires"] = exp.strftime("%Y-%m-%dT%H:%M:%SZ")
            out["days_left"] = int((exp - datetime.now(timezone.utc)).total_seconds() // 86400)
        except (KeyError, ValueError):
            pass
        out["subject"] = dict(x[0] for x in cert.get("subject", ()))
        out["issuer"] = dict(x[0] for x in cert.get("issuer", ())).get("organizationName") or dict(x[0] for x in cert.get("issuer", ())).get("commonName")
        out["san"] = [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"][:20]
    return out


def _unverified_cert(ip, port, sni, timeout):
    """Read a certificate we could not verify (self-signed, IP access) so its
    expiry can still be shown. Uses CPython's decoder via a temp file."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((ip, port), timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=sni) as ss:
                der = ss.getpeercert(binary_form=True)
        pem = ssl.DER_cert_to_PEM_cert(der)
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
            f.write(pem)
            path = f.name
        try:
            return ssl._ssl._test_decode_cert(path)  # noqa: SLF001
        finally:
            os.unlink(path)
    except Exception:  # noqa: BLE001
        return None


LOGIN_RX = re.compile(r"login|signin|sign-in|auth|sso|oauth|authelia|authentik", re.I)


def http_get(scheme, ip, port, host_header, path, timeout=8.0):
    t0 = _now()
    try:
        if scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # TLS validity is reported separately by tls()
            # Connect to the resolved IP but send the hostname as SNI and Host,
            # so name-based virtual hosts behind a proxy answer correctly.
            sni = host_header.split(":")[0]
            conn = http.client.HTTPConnection(ip, port, timeout=timeout)
            sock = socket.create_connection((ip, port), timeout)
            conn.sock = ctx.wrap_socket(sock, server_hostname=None if re.match(r"^\d+\.\d+\.\d+\.\d+$", sni) else sni)
        else:
            conn = http.client.HTTPConnection(ip, port, timeout=timeout)
        conn.request("GET", path or "/", headers={"Host": host_header, "User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.5"})
        r = conn.getresponse()
        body = r.read(65536)
        conn.close()
        title = None
        m = re.search(rb"<title[^>]*>(.*?)</title>", body, re.I | re.S)
        if m:
            title = m.group(1).decode("utf-8", "replace").strip()[:120]
        return dict(ok=True, code=r.status, location=r.getheader("Location"), server=(r.getheader("Server") or "")[:60],
                    ms=int((_now() - t0) * 1000), title=title, www_auth=bool(r.getheader("WWW-Authenticate")),
                    ctype=(r.getheader("Content-Type") or "")[:60])
    except socket.timeout:
        return dict(ok=False, result="timeout")
    except ConnectionRefusedError:
        return dict(ok=False, result="refused")
    except (ssl.SSLError, http.client.HTTPException, OSError) as e:
        return dict(ok=False, result="error", error=str(e)[:160])


def classify(res):
    """Turn raw check results into (status, summary, hypothesis)."""
    d, t, h, s = res.get("dns"), res.get("tcp"), res.get("http"), res.get("tls")
    if d and not d["ok"]:
        return "dns-fail", f"DNS lookup failed ({d.get('error')})", None
    if t and not t["ok"]:
        if t["result"] == "refused":
            return "down", "Host answered but nothing is listening on this port", "Service stopped or moved to another port (hypothesis)."
        return "unreachable", f"No answer from this collector ({t['result']})", "Likely a firewall between the collector and this network; not proof the app is down."
    if h is None:
        if s and s.get("days_left") is not None and s["days_left"] < 0:
            return "degraded", "TCP open; TLS certificate expired", None
        return "reachable", "TCP open (HTTP not requested for this sensitive endpoint)", None
    if not h["ok"]:
        if h.get("result") == "timeout":
            return "degraded", "TCP open but HTTP did not answer in time", "The app may be hung or very slow (hypothesis)."
        return "degraded", "TCP open but HTTP failed: " + (h.get("error") or h.get("result", "")), "Possibly not an HTTP service, or it needs HTTPS/another hostname."
    c = h["code"]
    if c in (401, 407) or (c == 403 and h.get("www_auth")):
        return "auth", f"HTTP {c}: login required (app is up)", None
    if c in (301, 302, 303, 307, 308):
        loc = h.get("location") or ""
        if LOGIN_RX.search(loc):
            return "auth", f"HTTP {c} → login page", None
        return "up", f"HTTP {c} → {loc[:80]}", None
    if 200 <= c < 300:
        return "up", f"HTTP {c}" + (f" — {h['title']}" if h.get("title") else ""), None
    if c == 403:
        return "auth", "HTTP 403: forbidden without a session (app is up)", None
    if c == 404:
        return "degraded", "HTTP 404 at this path", "Wrong path or the hostname is not routed (hypothesis)."
    if c in (502, 503, 504):
        return "down", f"HTTP {c} from the proxy", "The proxy is up but its backend is not answering (hypothesis)."
    if c == 421 or c == 400:
        return "degraded", f"HTTP {c}", "The app likely needs its hostname instead of the IP (hypothesis)."
    if c >= 500:
        return "degraded", f"HTTP {c}", None
    return "up", f"HTTP {c}", None


def check_endpoint(ep, last_http_at=0, location="collector", prev_http=None):
    """Run the checks for one endpoint dict (url, host, ip, port, scheme, path, sensitive)."""
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    res = dict(at=started, collector=location)
    host, scheme, port, path = ep.get("host"), ep.get("scheme"), ep.get("port"), ep.get("path") or "/"
    if not host or not port or scheme not in ("http", "https"):
        res.update(status="unsupported", summary="Not an HTTP(S) endpoint")
        return res
    res["dns"] = dns(host)
    if not res["dns"]["ok"]:
        res["status"], res["summary"], res["hypothesis"] = classify(res)
        return res
    ip = res["dns"]["addresses"][0]
    res["ip"] = ip
    res["tcp"] = tcp(ip, port)
    if res["tcp"]["ok"]:
        if scheme == "https":
            res["tls"] = tls(ip, port, host if not re.match(r"^\d", host) else None)
        sensitive = ep.get("sensitive")
        if not sensitive or (time.time() - (last_http_at or 0)) >= SENSITIVE_HTTP_EVERY:
            hh = host if port in (80, 443) else f"{host}:{port}"
            res["http"] = http_get(scheme, ip, port, hh, path)
            res["http_requested"] = True
            err = (res["http"].get("error") or "").upper()
            if scheme == "https" and not res["http"]["ok"] and ("WRONG_VERSION" in err or "RECORD_LAYER" in err or "HTTP_REQUEST" in err):
                # The port speaks plain HTTP. Say so instead of calling the app broken.
                plain = http_get("http", ip, port, hh, path)
                if plain["ok"]:
                    res["http"] = dict(plain, scheme_mismatch="http")
                    res.pop("tls", None)
        elif prev_http:
            res["http"] = dict(prev_http, cached=True)  # reuse the last answer; do not re-probe
    res["status"], res["summary"], res["hypothesis"] = classify(res)
    if (res.get("http") or {}).get("scheme_mismatch"):
        res["summary"] += " — over plain HTTP; this URL should be http://, not https://"
        res["scheme_mismatch"] = "http"
    return res
