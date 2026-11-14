"""The provenance label of an exported number: which protocol section it follows, which code computed it, on which data.

Every number the evaluation and the demo publish carries one ``Provenance`` block, so a reader can find the rule it
follows (``protocol_path`` and ``protocol_anchor``), re-run the function that computed it (``script``, ``function`` and
``git_sha``), check it was computed from the data it names (``data_sha256``) and see how real its inputs are
(``label``). It is plain data (pydantic and the standard library only) so any layer, and the B3 demo, can import it.
"""

import copy
from collections.abc import Mapping
from enum import StrEnum

from pydantic import AwareDatetime, BaseModel, ConfigDict, JsonValue

from stellar_blaze.domain.config.models import Sha256

PROVENANCE_KEY = "provenance"


class ProvenanceLabel(StrEnum):
    """How real the inputs behind a number are. The values are the strings the reports and the UI print."""

    REAL = "REAL"
    REAL_WEATHER_ASSUMED_CREW = "REAL weather + assumed crew"
    SIMULATED = "SIMULATED"


class Provenance(BaseModel):
    """Where one exported number came from.

    Attributes:
        protocol_path: Repository-relative path of the document whose rule the number follows.
        protocol_anchor: Heading slug inside it, for example ``#7-metrics``.
        script: Dotted module path of the code that computed it.
        function: Name of the function in ``script``.
        git_sha: Commit the code was at.
        data_sha256: SHA-256 of the input data (a snapshot file or a manifest), lowercase hex.
        model_id: The corrector artifact scored, or ``None`` when no model is involved (a baseline, a snapshot).
        label: How real the inputs are.
        generated_at: When it was computed; timezone-aware.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    protocol_path: str
    protocol_anchor: str
    script: str
    function: str
    git_sha: str
    data_sha256: Sha256
    model_id: str | None
    label: ProvenanceLabel
    generated_at: AwareDatetime


def attach_provenance(payload: Mapping[str, JsonValue], provenance: Provenance) -> dict[str, JsonValue]:
    """A copy of ``payload`` with the provenance under the key ``provenance``, as JSON-native values.

    The payload is never changed, and the copy shares no nested object with it.

    Raises:
        ValueError: ``payload`` already has a ``provenance`` key; two blocks would make one of them a lie.
    """
    if PROVENANCE_KEY in payload:
        raise ValueError(f"the payload already has a {PROVENANCE_KEY!r} key")
    result = copy.deepcopy(dict(payload))
    result[PROVENANCE_KEY] = provenance.model_dump(mode="json")
    return result
