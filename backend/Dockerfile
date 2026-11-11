# Stellar Blaze API image. Build context is backend/:  docker build -t stellar-blaze-api:dev backend
#
# Two stages: `build` resolves and installs the locked runtime dependencies (no dev or train groups) with uv; `runtime`
# is the same Python base plus the finished /app, run as an unprivileged user. Neither uv nor a compiler ships.

# python:3.13.15-slim-trixie, pinned by the multi-arch index digest (resolved 2026-11-11 with
# `docker buildx imagetools inspect python:3.13.15-slim-trixie`). Both stages use it, so tag and digest are bumped here,
# together and deliberately, never by a floating tag.
ARG PYTHON_IMAGE=python:3.13.15-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b

# uv 0.13.7, the version CI and the lockfile use. Tag plus index digest (resolved 2026-11-11 with
# `docker buildx imagetools inspect ghcr.io/astral-sh/uv:0.13.7`).
FROM ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 AS uv

FROM ${PYTHON_IMAGE} AS build

COPY --from=uv /uv /uvx /bin/

# Bytecode is compiled once here, not on every cold start. Copy mode because the uv cache mount is another filesystem.
# Never download an interpreter: the base image's Python is the one that runs the app.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# WORKDIR /app makes the Settings defaults (SB_RULESETS_DIR=rulesets, SB_MODELS_DIR=models) and alembic.ini resolve.
WORKDIR /app

# Dependencies first: this layer is rebuilt only when pyproject.toml or uv.lock change.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-default-groups --no-install-project --no-editable

# ADR 0009: rulesets and model artifacts ship inside the image.
COPY src/ src/
COPY alembic/ alembic/
COPY alembic.ini ./
COPY rulesets/ rulesets/
COPY models/ models/

# The project itself, as a regular (non-editable) install, so the venv does not depend on /app/src.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-default-groups --no-editable


FROM ${PYTHON_IMAGE} AS runtime

# The numba cache directory is the one place the app user may write. NUMBA_CPU_NAME=generic keeps numba's on-disk cache
# valid on any CPU: numba keys cached code on the CPU name and feature set, and with `generic` both are fixed
# (numba/core/config.py: CPU_FEATURES defaults to "" when CPU_NAME is "generic"), so a cache warmed on the build host
# is not discarded on the Container Apps host (preflight F17, ADR 0001).
# The numba warm-up (Task 14) must run in this stage as uid 10001, or the cache it writes is not the one the app reads.
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/app/.numba-cache \
    NUMBA_CPU_NAME=generic

WORKDIR /app
COPY --from=build /app /app

# libgomp1: LightGBM's wheel links the OpenMP runtime, which python:slim does not ship. `import lightgbm` failed in this
# image with "libgomp.so.1: cannot open shared object file" before the package was added; the B3 model artifacts need it.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Code and rulesets stay root-owned and read-only to the app user. A named user (not just a uid) because some libraries
# look the current uid up in /etc/passwd.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin app \
    && mkdir /app/.numba-cache \
    && chown 10001:10001 /app/.numba-cache

USER 10001:10001
EXPOSE 8000

# --proxy-headers with --forwarded-allow-ips "*": the platform ingress terminates TLS and sets X-Forwarded-For/Proto, and
# the port is published nowhere else, so the ingress is the only peer. Revisit if the container is ever reachable directly
# (then a client could forge X-Forwarded-For and the logged client address would be untrustworthy).
CMD ["uvicorn", "stellar_blaze.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
