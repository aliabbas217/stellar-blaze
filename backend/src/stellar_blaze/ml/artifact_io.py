"""Writing a typed artefact (``domain.scoreboard`` model) as B2's canonical JSON with its provenance block.

The artefact models carry their own ``provenance`` field (the stand-in class of ``domain/scoreboard.py``, whose JSON
schema is NOT identical to B2's ``domain/provenance.py``: ``data_sha256`` is a plain string there, a pattern here, and
the descriptions differ). The file is written through B2's ``write_json`` so every export has one canonical form: the
model without its ``provenance`` key as the payload, and B2's ``Provenance`` attached under that key. The result
validates back against the model (a test pins it).
"""

from pathlib import Path

from pydantic import BaseModel, JsonValue

from stellar_blaze.domain.provenance import Provenance as WireProvenance
from stellar_blaze.domain.scoreboard import Provenance
from stellar_blaze.ml.exporters import render_json, write_json

__all__ = ["render_artifact", "wire_provenance", "write_artifact"]


def wire_provenance(provenance: Provenance) -> WireProvenance:
    """The B2 ``Provenance`` with the same field values (raises if ``data_sha256`` is not a SHA-256)."""
    return WireProvenance.model_validate(provenance.model_dump(mode="json"))


def render_artifact(artifact: BaseModel) -> bytes:
    """The canonical bytes ``write_artifact`` writes (pure: nothing is touched), for all-or-nothing writers.

    Raises:
        TypeError: ``artifact`` has no ``provenance`` field of the scoreboard ``Provenance`` type.
        ValueError: A float is not finite, or ``data_sha256`` is not a SHA-256.
    """
    provenance = getattr(artifact, "provenance", None)
    if not isinstance(provenance, Provenance):
        raise TypeError(f"{type(artifact).__name__} has no scoreboard Provenance field")
    payload: dict[str, JsonValue] = artifact.model_dump(mode="json", exclude={"provenance"})
    return render_json(payload, wire_provenance(provenance))


def write_artifact(path: Path, artifact: BaseModel, *, exclusive: bool = False) -> str:
    """Write ``artifact`` (a model with a ``provenance`` field) as canonical JSON; return the SHA-256 of the bytes.

    Raises:
        TypeError: ``artifact`` has no ``provenance`` field of the scoreboard ``Provenance`` type.
        FileExistsError: ``exclusive`` and ``path`` exists (the file is left as it is).
        ValueError: A float is not finite, or ``data_sha256`` is not a SHA-256.
    """
    provenance = getattr(artifact, "provenance", None)
    if not isinstance(provenance, Provenance):
        raise TypeError(f"{type(artifact).__name__} has no scoreboard Provenance field")
    payload: dict[str, JsonValue] = artifact.model_dump(mode="json", exclude={"provenance"})
    return write_json(path, payload, wire_provenance(provenance), exclusive=exclusive)
