FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install -e .

COPY . .

EXPOSE 8000

# Container-level liveness. Hits /health/lite to avoid hammering the DB on
# every probe — /health is heavier (DB + Redis) and is intended for the
# external uptime check + Caddy's upstream health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health/lite || exit 1

# --proxy-headers + --forwarded-allow-ips="*" makes uvicorn trust
# X-Forwarded-{Proto,For,Host} from Caddy so url_for(), request.url, and
# request.client.host reflect the public values instead of the internal hop.
# The trust list is "*" because Caddy sits on the same Docker network — only
# Caddy can reach the container in prod (no public port published).
CMD ["uvicorn", "husn.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
