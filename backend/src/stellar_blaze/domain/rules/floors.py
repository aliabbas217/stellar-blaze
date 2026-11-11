"""Legal floors and how to compare them (ADR 0010 section 4.3).

A floor is a ruleset value that law or a guideline fixes: a zone edge, a withdrawal limit, a clothing adjustment. A
ruleset may be pinned at runtime only if none of its floors is less protective than the floor of the ruleset that is in
force today, so every floor field carries a ``Floor`` comparator that says which direction is safer. A floor without a
comparator cannot ship: a test walks every value section of the schema and fails on a numeric, boolean or window field
that has neither a ``Floor`` nor an entry in its section's ``NON_FLOOR_FIELDS``.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any, Literal, get_args, get_origin

from pydantic import BaseModel
from pydantic.fields import FieldInfo

if TYPE_CHECKING:
    from stellar_blaze.domain.rules.ruleset import Ruleset


@dataclass(frozen=True)
class Floor:
    """Marks a field as a legal floor and says which direction is safer.

    Use it as annotation metadata: ``Annotated[float, Floor(safer="higher")]``, or on the values of a table:
    ``dict[str, Annotated[float, Floor(safer="higher")]]``.

    Attributes:
        safer: ``"higher"``: a larger number is more protective (a zone edge, a clothing adjustment). ``"lower"``: a
            smaller number is more protective (a withdrawal trigger or cap). ``"true"``: ``True`` is more protective
            (a switch that turns a protection on). ``"wider"``: a window ``(start, end)`` that covers more is more
            protective (a ban window): the candidate window must contain the reference window.
    """

    safer: Literal["higher", "lower", "true", "wider"]


@dataclass(frozen=True)
class FloorViolation:
    """A floor of the candidate that is less protective than the reference's, at the field's dotted path."""

    path: str
    candidate: Any
    reference: Any


def _less_protective(safer: str, candidate: Any, reference: Any) -> bool:
    """True when ``candidate`` protects less than ``reference`` in the direction ``safer`` names."""
    match safer:
        case "higher":
            return bool(candidate < reference)
        case "lower":
            return bool(candidate > reference)
        case "true":
            return bool(reference) and not bool(candidate)
        case "wider":
            candidate_start, candidate_end = candidate
            reference_start, reference_end = reference
            return bool(candidate_start > reference_start or candidate_end < reference_end)
        case _:  # pragma: no cover - the Literal on Floor makes this unreachable for a type-checked caller
            msg = f"unknown floor direction: {safer!r}"
            raise ValueError(msg)


def _field_floor(info: FieldInfo) -> Floor | None:
    return next((m for m in info.metadata if isinstance(m, Floor)), None)


def _value_floor(info: FieldInfo) -> Floor | None:
    """The comparator on the values of a table (``dict[str, Annotated[float, Floor(...)]]``), if there is one."""
    for argument in get_args(info.annotation):
        if get_origin(argument) is Annotated:
            floor = next((m for m in get_args(argument)[1:] if isinstance(m, Floor)), None)
            if floor is not None:
                return floor
    return None


def _walk(candidate: BaseModel, reference: BaseModel, prefix: str, found: list[FloorViolation]) -> None:
    for name, info in type(reference).model_fields.items():
        path = f"{prefix}.{name}" if prefix else name
        candidate_value = getattr(candidate, name)
        reference_value = getattr(reference, name)

        floor = _field_floor(info)
        if floor is not None:
            if _less_protective(floor.safer, candidate_value, reference_value):
                found.append(FloorViolation(path, candidate_value, reference_value))
        elif isinstance(candidate_value, BaseModel) and isinstance(reference_value, BaseModel):
            _walk(candidate_value, reference_value, path, found)
        elif isinstance(reference_value, dict):
            table_floor = _value_floor(info)
            if table_floor is None:
                continue
            for key, reference_entry in reference_value.items():
                entry_path = f"{path}.{key}"
                if key not in candidate_value:
                    # A candidate may add entries but not drop one: a missing entry protects less than a present one.
                    found.append(FloorViolation(entry_path, None, reference_entry))
                elif _less_protective(table_floor.safer, candidate_value[key], reference_entry):
                    found.append(FloorViolation(entry_path, candidate_value[key], reference_entry))


def model_floor_violations(candidate: BaseModel, reference: BaseModel) -> list[FloorViolation]:
    """Every ``Floor`` field of ``candidate`` that is less protective than the same field of ``reference``.

    Walks the fields of ``reference``'s class, descending into nested models, in definition order. Fields without a
    comparator are ignored, and so are entries a candidate table has that the reference lacks.
    """
    found: list[FloorViolation] = []
    _walk(candidate, reference, "", found)
    return found


def floor_violations(candidate: "Ruleset", reference: "Ruleset") -> list[FloorViolation]:
    """Floors of ``candidate`` that are less protective than ``reference``'s, each with its dotted path and both values.

    ``TunableSpec`` and ``tunables`` are not floors (ADR 0010 section 4.2): each has its own reviewed range.
    """
    return model_floor_violations(candidate, reference)
