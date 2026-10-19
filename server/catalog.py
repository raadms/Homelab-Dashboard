"""Known application signatures.

Used only to *label* evidence that was actually collected (an image name, a
process name, a listening port, a DNS name). A signature never creates an
application on its own, and a default port never becomes a "verified" URL.
"""
import re

# key: (display name, category, icon slug, purpose, default scheme, default port, default path)
APPS = {
    "proxmox":      ("Proxmox VE", "Infrastructure", "proxmox", "Hypervisor and cluster management", "https", 8006, "/"),
    "pbs":          ("Proxmox Backup Server", "Infrastructure", "proxmox", "VM/LXC backups", "https", 8007, "/"),
    "homeassistant":("Home Assistant", "Home", "home-assistant", "Home automation", "https", 8123, "/"),
    "unifi":        ("UniFi Network", "Network", "ubiquiti-unifi", "Network controller (Cloud Gateway Fiber)", "https", 443, "/network/"),
    "unifi-protect":("UniFi Protect", "Security", "ubiquiti-unifi", "Cameras / NVR", "https", 443, "/protect/"),
    "caddy":        ("Caddy", "Network", "caddy", "Reverse proxy and TLS", "https", 443, "/"),
    "traefik":      ("Traefik", "Network", "traefik", "Reverse proxy", "http", 8080, "/dashboard/"),
    "nginx":        ("Nginx", "Network", "nginx", "Web server / reverse proxy", "http", 80, "/"),
    "npm":          ("Nginx Proxy Manager", "Network", "nginx-proxy-manager", "Reverse proxy admin", "http", 81, "/"),
    "truenas":      ("TrueNAS", "Storage", "truenas", "NAS storage", "https", 443, "/"),
    "frigate":      ("Frigate", "Security", "frigate", "NVR with object detection", "http", 5000, "/"),
    "plex":         ("Plex", "Media", "plex", "Media server", "http", 32400, "/web"),
    "jellyfin":     ("Jellyfin", "Media", "jellyfin", "Media server", "http", 8096, "/"),
    "emby":         ("Emby", "Media", "emby", "Media server", "http", 8096, "/"),
    "sonarr":       ("Sonarr", "Media", "sonarr", "TV series automation", "http", 8989, "/"),
    "radarr":       ("Radarr", "Media", "radarr", "Movie automation", "http", 7878, "/"),
    "lidarr":       ("Lidarr", "Media", "lidarr", "Music automation", "http", 8686, "/"),
    "readarr":      ("Readarr", "Media", "readarr", "Book automation", "http", 8787, "/"),
    "bazarr":       ("Bazarr", "Media", "bazarr", "Subtitles", "http", 6767, "/"),
    "prowlarr":     ("Prowlarr", "Media", "prowlarr", "Indexer manager", "http", 9696, "/"),
    "jackett":      ("Jackett", "Media", "jackett", "Indexer proxy", "http", 9117, "/"),
    "overseerr":    ("Overseerr", "Media", "overseerr", "Media requests", "http", 5055, "/"),
    "jellyseerr":   ("Jellyseerr", "Media", "jellyseerr", "Media requests", "http", 5055, "/"),
    "tautulli":     ("Tautulli", "Media", "tautulli", "Plex statistics", "http", 8181, "/"),
    "qbittorrent":  ("qBittorrent", "Downloads", "qbittorrent", "Torrent client", "http", 8080, "/"),
    "transmission": ("Transmission", "Downloads", "transmission", "Torrent client", "http", 9091, "/"),
    "sabnzbd":      ("SABnzbd", "Downloads", "sabnzbd", "Usenet client", "http", 8080, "/"),
    "nzbget":       ("NZBGet", "Downloads", "nzbget", "Usenet client", "http", 6789, "/"),
    "gluetun":      ("Gluetun", "Network", "gluetun", "VPN client for containers", None, None, None),
    "flaresolverr": ("FlareSolverr", "Media", "flaresolverr", "Cloudflare challenge solver", "http", 8191, "/"),
    "portainer":    ("Portainer", "Infrastructure", "portainer", "Container management", "https", 9443, "/"),
    "dockge":       ("Dockge", "Infrastructure", "dockge", "Compose management", "http", 5001, "/"),
    "grafana":      ("Grafana", "Monitoring", "grafana", "Dashboards", "http", 3000, "/"),
    "prometheus":   ("Prometheus", "Monitoring", "prometheus", "Metrics", "http", 9090, "/"),
    "uptime-kuma":  ("Uptime Kuma", "Monitoring", "uptime-kuma", "Uptime monitoring", "http", 3001, "/"),
    "netdata":      ("Netdata", "Monitoring", "netdata", "Host monitoring", "http", 19999, "/"),
    "pihole":       ("Pi-hole", "Network", "pi-hole", "DNS filtering", "http", 80, "/admin/"),
    "adguard":      ("AdGuard Home", "Network", "adguard-home", "DNS filtering", "http", 3000, "/"),
    "vaultwarden":  ("Vaultwarden", "Security", "vaultwarden", "Password manager", "http", 80, "/"),
    "nextcloud":    ("Nextcloud", "Productivity", "nextcloud", "Files and collaboration", "https", 443, "/"),
    "immich":       ("Immich", "Media", "immich", "Photo library", "http", 2283, "/"),
    "paperless":    ("Paperless-ngx", "Productivity", "paperless-ngx", "Document archive", "http", 8000, "/"),
    "mosquitto":    ("Mosquitto", "Home", "mosquitto", "MQTT broker", None, 1883, None),
    "zigbee2mqtt":  ("Zigbee2MQTT", "Home", "zigbee2mqtt", "Zigbee bridge", "http", 8080, "/"),
    "scrypted":     ("Scrypted", "Security", "scrypted", "Camera bridge", "https", 10443, "/"),
    "pikvm":        ("PiKVM", "Infrastructure", "pikvm", "KVM over IP", "https", 443, "/"),
    "idrac":        ("Dell iDRAC", "Infrastructure", "dell", "Server out-of-band management", "https", 443, "/"),
    "cockpit":      ("Cockpit", "Infrastructure", "cockpit", "Server web console", "https", 9090, "/"),
    "webmin":       ("Webmin", "Infrastructure", "webmin", "Server web console", "https", 10000, "/"),
    "wled":         ("WLED", "Home", "wled", "LED controller", "http", 80, "/"),
    "slzb":         ("SLZB-06", "Home", "zigbee2mqtt", "Zigbee coordinator/router", "http", 80, "/"),
    "hikvision":    ("Hikvision camera", "Security", "hikvision", "IP camera / NVR", "http", 80, "/"),
    "otbr":         ("OpenThread Border Router", "Home", "openthread", "Thread border router", "http", 8081, "/"),
    "music-assistant":("Music Assistant", "Media", "music-assistant", "Music server", "http", 8095, "/"),
    "code-server":  ("code-server", "Development", "code", "VS Code in the browser", "http", 8443, "/"),
    "ollama":       ("Ollama", "AI", "ollama", "Local LLM runtime", "http", 11434, "/"),
    "open-webui":   ("Open WebUI", "AI", "open-webui", "LLM chat UI", "http", 8080, "/"),
}

# Ports that are management/admin surfaces: only TCP/TLS checks, never repeated HTTP GETs.
SENSITIVE_KEYS = {"proxmox", "pbs", "idrac", "pikvm", "unifi", "truenas", "portainer", "cockpit", "webmin", "vaultwarden"}

# Ports that are not HTTP at all (never record them as web URLs).
NON_HTTP_PORTS = {22, 23, 25, 53, 67, 68, 111, 123, 137, 138, 139, 445, 853, 1883, 2049, 3306, 5353,
                  5432, 6379, 8883, 27017, 3128, 5900, 5901, 51820, 41641, 21064, 21065, 21066, 21067,
                  21068, 21069, 21070, 21071, 21072, 8554, 8555, 1900, 3260, 9100}

IMAGE_PATTERNS = [(re.compile(p, re.I), k) for p, k in [
    (r"home-?assistant", "homeassistant"), (r"\bcaddy", "caddy"), (r"traefik", "traefik"),
    (r"nginx-proxy-manager|jc21/", "npm"), (r"nginx", "nginx"), (r"frigate", "frigate"),
    (r"plex", "plex"), (r"jellyseerr", "jellyseerr"), (r"jellyfin", "jellyfin"), (r"emby", "emby"),
    (r"sonarr", "sonarr"), (r"radarr", "radarr"), (r"lidarr", "lidarr"), (r"readarr", "readarr"),
    (r"bazarr", "bazarr"), (r"prowlarr", "prowlarr"), (r"jackett", "jackett"), (r"overseerr", "overseerr"),
    (r"tautulli", "tautulli"), (r"qbittorrent", "qbittorrent"), (r"transmission", "transmission"),
    (r"sabnzbd", "sabnzbd"), (r"nzbget", "nzbget"), (r"gluetun", "gluetun"), (r"flaresolverr", "flaresolverr"),
    (r"portainer", "portainer"), (r"dockge", "dockge"), (r"grafana", "grafana"), (r"prometheus", "prometheus"),
    (r"uptime-kuma", "uptime-kuma"), (r"netdata", "netdata"), (r"pihole", "pihole"), (r"adguard", "adguard"),
    (r"vaultwarden", "vaultwarden"), (r"nextcloud", "nextcloud"), (r"immich-server", "immich"),
    (r"paperless", "paperless"), (r"mosquitto", "mosquitto"), (r"zigbee2mqtt", "zigbee2mqtt"),
    (r"scrypted", "scrypted"), (r"music-assistant", "music-assistant"), (r"code-server", "code-server"),
    (r"ollama", "ollama"), (r"open-webui", "open-webui"),
]]

PROCESS_PATTERNS = [(re.compile(p, re.I), k) for p, k in [
    (r"^pveproxy", "proxmox"), (r"^proxmox-backup", "pbs"), (r"^caddy$", "caddy"), (r"^traefik", "traefik"),
    (r"^nginx", "nginx"), (r"^hass$|home-assistant", "homeassistant"), (r"^Sonarr", "sonarr"),
    (r"^Radarr", "radarr"), (r"^Prowlarr", "prowlarr"), (r"^Lidarr", "lidarr"), (r"^Plex Media", "plex"),
    (r"^jellyfin", "jellyfin"), (r"^qbittorrent", "qbittorrent"), (r"^kvmd", "pikvm"), (r"^middlewared", "truenas"),
    (r"^cockpit", "cockpit"), (r"^netdata", "netdata"), (r"^mosquitto", "mosquitto"), (r"^otbr", "otbr"),
    (r"^grafana", "grafana"), (r"^prometheus", "prometheus"), (r"^smbd", None), (r"^sshd", None),
]]

HOSTNAME_PATTERNS = [(re.compile(p, re.I), k) for p, k in [
    (r"^ha\b|homeassistant|home-assistant", "homeassistant"), (r"frigate", "frigate"), (r"^plex", "plex"),
    (r"^sonarr", "sonarr"), (r"^radarr", "radarr"), (r"^prowlarr", "prowlarr"), (r"^jellyfin", "jellyfin"),
    (r"^unifi", "unifi"), (r"^pve|proxmox", "proxmox"), (r"truenas|^nas\b", "truenas"), (r"pikvm", "pikvm"),
    (r"idrac", "idrac"), (r"^proxy|caddy", "caddy"), (r"wled", "wled"), (r"slzb", "slzb"),
    (r"thread-route|otbr", "otbr"), (r"^scrypted", "scrypted"), (r"^uptime|^status$", "uptime-kuma"),
    (r"^grafana", "grafana"), (r"^portainer", "portainer"), (r"^overseerr", "overseerr"), (r"^jellyseerr", "jellyseerr"),
    (r"^qbit|^torrent", "qbittorrent"), (r"^pbs|^backup", "pbs"), (r"^adguard", "adguard"), (r"^pihole", "pihole"),
    (r"^vault", "vaultwarden"), (r"^immich|^photos", "immich"), (r"^nextcloud|^cloud$", "nextcloud"), (r"^arr\b", None),
]]


def match(patterns, text):
    for rx, key in patterns:
        if text and rx.search(text):
            return key
    return None


def info(key):
    a = APPS.get(key)
    if not a:
        return None
    return dict(key=key, name=a[0], category=a[1], icon=a[2], purpose=a[3],
                scheme=a[4], port=a[5], path=a[6], sensitive=key in SENSITIVE_KEYS)
