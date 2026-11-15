# Stellar Blaze API image. Build context is backend/:  docker build -t stellar-blaze-api:dev backend
#
# Two stages: `build` resolves and installs the locked runtime dependencies (no dev or train groups) with uv; `runtime`
# is the same Python base plus the finished virtualenv and the files the app reads, run as an unprivileged user. Neither
# uv nor a compiler ships.

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

# The virtualenv lands in /app/.venv and the runtime stage copies it to the same path, so its shebangs stay valid.
WORKDIR /app

# Dependencies first: this layer is rebuilt only when pyproject.toml or uv.lock change.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-default-groups --no-install-project --no-editable

COPY src/ src/

# The project itself, as a regular (non-editable) install, so the venv does not depend on /app/src.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-default-groups --no-editable


FROM ${PYTHON_IMAGE} AS runtime

# The numba cache directory is the one place the app user may write. NUMBA_CPU_NAME=generic keeps numba's on-disk cache
# valid on any CPU: numba keys cached code on the CPU name and feature set, and with `generic` both are fixed
# (numba/core/config.py: CPU_FEATURES defaults to "" when CPU_NAME is "generic"), so a cache warmed on the build host
# is not discarded on the Container Apps host (preflight F17, ADR 0001).
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/app/.numba-cache \
    NUMBA_CPU_NAME=generic

# WORKDIR /app makes the Settings defaults (SB_RULESETS_DIR=rulesets, SB_MODELS_DIR=models, SB_REPLAY_DIR=replay, the
# runtime-config seed config/runtime/default.toml) and alembic.ini resolve.
WORKDIR /app

# The layers that never change with the code come first, so a code change does not re-run apt or the user setup.
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

# Only what the app reads at run time, not all of /app: the virtualenv (which holds the installed project), the Alembic
# migrations, ADR 0009's rulesets and model artifacts, the replay snapshots (SB_FORECAST_SOURCE=replay reads
# replay/<SB_REPLAY_SNAPSHOT_ID>/), ADR 0010's runtime-config seed (config/runtime/default.toml) and the synthetic demo
# site (fixtures/demo_site.toml, loaded with `sb-jobs site load`).
# Sources, pyproject.toml and uv.lock stay in the build stage.
COPY --from=build /app/.venv /app/.venv
COPY alembic/ alembic/
COPY alembic.ini ./
COPY rulesets/ rulesets/
COPY models/ models/
COPY replay/ replay/
COPY config/ config/
# The demo site fixture: `sb-jobs site load fixtures/demo_site.toml` runs in this image (the migrate job loads the demo site).
COPY fixtures/ fixtures/
# The MIT notice for the code ported from meteoHazard (domain/physics/twl.py) has to ship with that code.
COPY THIRD_PARTY_NOTICES.md ./

USER 10001:10001

# Warm the numba cache as the app user, in this stage, so that /app/.numba-cache holds the kernels the app will load (a
# cache written by another user or in the build stage is not the one the app reads). Without it the first PHS call in
# every new worker compiles for 2 to 4 s (stack doc 6.3, ADR 0001). The step raises, and so fails the build, when PHS
# gives no usable result.
RUN python -c "from stellar_blaze.adapters.compute.phs_process import warm; warm()"

EXPOSE 8000

# --proxy-headers with --forwarded-allow-ips "*": the platform ingress terminates TLS and sets X-Forwarded-For/Proto, and
# the port is published nowhere else, so the ingress is the only peer. Revisit if the container is ever reachable directly
# (then a client could forge X-Forwarded-For and the logged client address would be untrustworthy).
CMD ["uvicorn", "stellar_blaze.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
