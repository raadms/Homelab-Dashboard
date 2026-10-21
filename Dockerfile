# Homelab dashboard — Python standard library only, no pip packages.
FROM python:3.13-alpine

LABEL org.opencontainers.image.title="homelab-dashboard" \
      org.opencontainers.image.description="Read-only homelab dashboard: Proxmox, Portainer, UniFi, DNS and proxy discovery with live health checks" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DASH_DATA=/data DASH_QUIET=1 DASH_PORT=8088 DASH_TOKEN_DIR=/data/tokens

RUN apk add --no-cache tzdata && addgroup -g 10001 dash && adduser -D -u 10001 -G dash -h /app dash
WORKDIR /app
COPY server/ server/
COPY web/ web/
COPY config/ config/
COPY collectors/dist/ collectors/dist/
RUN mkdir -p /data && chown dash:dash /data

USER dash
VOLUME ["/data"]
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8088/api/me', timeout=4).status == 200 else 1)"
CMD ["python3", "-m", "server.app"]
