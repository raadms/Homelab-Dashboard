# homelab-dashboard-agent: read-only container lister. Standard library only.
FROM python:3.13-alpine
LABEL org.opencontainers.image.title="homelab-dashboard-agent" \
      org.opencontainers.image.description="Read-only Docker container lister for homelab-dashboard (no inspect, no env, signed requests)"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY agent.py /agent.py
EXPOSE 9180
HEALTHCHECK --interval=30s --timeout=4s CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:9180/health',timeout=3)"
CMD ["python3", "/agent.py"]
