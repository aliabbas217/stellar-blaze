"""Write the OpenAPI spec that ``backend/openapi/v1.json`` snapshots (ADR 0009 section 5).

``python -m stellar_blaze.api.export_openapi`` prints the spec; with a path argument it writes the file instead. Both
forms emit UTF-8 with LF line endings and a trailing newline. Prefer the path form on Windows: PowerShell's ``>`` would
re-encode the output (UTF-16 or a BOM).
"""

import json
import sys
from pathlib import Path
from typing import Any

from pydantic import SecretStr

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings


def render_openapi(spec: dict[str, Any]) -> str:
    """The canonical serialization of a spec, shared by the exporter and the drift test."""
    return json.dumps(spec, indent=2, sort_keys=True) + "\n"


def build_spec() -> dict[str, Any]:
    # The spec does not depend on settings; the database URL is a dummy and is never connected to.
    settings = Settings(
        env="test",
        log_format="json",
        database_url=SecretStr("postgresql+asyncpg://openapi:openapi@localhost:5432/openapi"),
        _env_file=None,
    )
    return create_app(settings).openapi()


def main(argv: list[str]) -> int:
    payload = render_openapi(build_spec()).encode("utf-8")
    if len(argv) > 1:
        Path(argv[1]).write_bytes(payload)
    else:
        # The binary buffer: text-mode stdout turns "\n" into "\r\n" on Windows.
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
