"""Structural checks on the ruleset schema: no floor ships without a comparator that fits it (ADR 0010 section 4.3).

These are test helpers, not tests: ``test_floors`` runs them over every real section and, as negative controls, over
deliberately broken ones, so a guard that stopped looking would fail loudly instead of passing over nothing.
"""

from collections.abc import Iterator
from datetime import date, time, timedelta
from types import UnionType
from typing import Annotated, Any, Union, get_args, get_origin

from pydantic import BaseModel
from pydantic.fields import FieldInfo

from stellar_blaze.domain.rules.floors import Floor
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetSection

# What a legal floor can be made of. ``bool`` is an ``int``, so it is told apart before the ordered types are asked;
# ``datetime`` is a ``date``.
ORDERED = (int, float, date, time, timedelta)
COMPARABLE = (bool, *ORDERED)


def leaves(annotation: Any) -> Iterator[Any]:
    """The types a field is made of, looking through ``Annotated``, unions and containers (tuple, list, dict, ...)."""
    origin = get_origin(annotation)
    if origin is Annotated:
        yield from leaves(get_args(annotation)[0])
    elif origin is None:
        yield annotation
    else:
        for argument in get_args(annotation):
            if argument is not type(None) and argument is not Ellipsis:
                yield from leaves(argument)


def is_comparable(leaf: Any) -> bool:
    return isinstance(leaf, type) and issubclass(leaf, COMPARABLE)


def is_ordered(leaf: Any) -> bool:
    """A number, date, time or duration: something ``higher``, ``lower`` and window ends can compare (not a bool)."""
    return isinstance(leaf, type) and issubclass(leaf, ORDERED) and not issubclass(leaf, bool)


def needs_comparator(annotation: Any) -> bool:
    """True for a number, boolean, date, time or duration, or a window or container of them."""
    return any(is_comparable(leaf) for leaf in leaves(annotation))


def models_in(annotation: Any) -> list[type[BaseModel]]:
    return [leaf for leaf in leaves(annotation) if isinstance(leaf, type) and issubclass(leaf, BaseModel)]


def direct_model(annotation: Any) -> type[BaseModel] | None:
    """The model a field is exactly (looking through ``Annotated`` only: an Optional or a container is not direct)."""
    while get_origin(annotation) is Annotated:
        annotation = get_args(annotation)[0]
    return annotation if isinstance(annotation, type) and issubclass(annotation, BaseModel) else None


def holds_ordered_values(model_type: type[BaseModel]) -> bool:
    return any(
        needs_comparator(info.annotation) or any(holds_ordered_values(m) for m in models_in(info.annotation))
        for info in model_type.model_fields.values()
    )


def floor_sites(info: FieldInfo) -> list[tuple[Floor, Any]]:
    """Every ``Floor`` on a field, with the type it applies to: the field itself, or the values of a table."""
    sites: list[tuple[Floor, Any]] = [(m, info.annotation) for m in info.metadata if isinstance(m, Floor)]
    for argument in get_args(info.annotation):
        if get_origin(argument) is Annotated:
            inner = get_args(argument)
            sites.extend((m, inner[0]) for m in inner[1:] if isinstance(m, Floor))
    return sites


def has_comparator(info: FieldInfo) -> bool:
    return bool(floor_sites(info))


def non_floor_fields(model_type: type[BaseModel]) -> frozenset[str]:
    declared: frozenset[str] = getattr(model_type, "NON_FLOOR_FIELDS", frozenset())
    unknown = sorted(declared - set(model_type.model_fields))
    assert not unknown, f"{model_type.__name__}.NON_FLOOR_FIELDS names fields that do not exist: {unknown}"
    return declared


def comparator_gaps(model_type: type[BaseModel], prefix: str = "") -> list[str]:
    """Fields (dotted paths) that hold ordered values but have neither a ``Floor`` nor a ``NON_FLOOR_FIELDS`` entry.

    Descends into nested models. A model inside a container or an Optional is reported when it holds ordered values,
    because ``floor_violations`` does not walk into those, so a floor there would never be compared.
    """
    declared = non_floor_fields(model_type)
    gaps: list[str] = []
    for name, info in model_type.model_fields.items():
        path = f"{prefix}{name}"
        sites = floor_sites(info)
        if name in declared:
            assert not sites, f"{path} is listed in NON_FLOOR_FIELDS and also carries a Floor"
        elif sites:
            continue
        elif needs_comparator(info.annotation):
            gaps.append(path)
        elif nested := direct_model(info.annotation):
            gaps.extend(comparator_gaps(nested, f"{path}."))
        elif any(holds_ordered_values(m) for m in models_in(info.annotation)):
            gaps.append(f"{path} (a model inside a container or an Optional is not walked by floor_violations)")
    return gaps


def fits(safer: str, annotation: Any) -> bool:
    """Whether a ``Floor(safer=...)`` makes sense on a value of this type."""
    if safer in ("true", "false"):
        return annotation is bool
    if safer in ("wider", "narrower"):
        arguments = get_args(annotation)
        # A window of one ordered type; zero-padded text ("06-15") is allowed because it compares correctly as text.
        return (
            get_origin(annotation) is tuple
            and len(arguments) == 2
            and arguments[0] is arguments[1]
            and (is_ordered(arguments[0]) or arguments[0] is str)
        )
    return is_ordered(annotation)  # "higher" and "lower"


def floor_misfits(model_type: type[BaseModel], prefix: str = "") -> list[str]:
    """Floor fields (dotted paths) whose ``safer`` direction does not fit their type, descending into nested models.

    ``true`` and ``false`` need a bool, ``wider`` and ``narrower`` a pair of one ordered type or of text (a window),
    ``higher`` and ``lower`` an ordered number, date, time or duration. An Optional never fits: ``None`` cannot be
    compared.
    """
    misfits: list[str] = []
    for name, info in model_type.model_fields.items():
        path = f"{prefix}{name}"
        misfits.extend(path for floor, annotation in floor_sites(info) if not fits(floor.safer, annotation))
        if nested := direct_model(info.annotation):
            misfits.extend(floor_misfits(nested, f"{path}."))
    return misfits


def optional_section(annotation: Any) -> type[RulesetSection] | None:
    """The section class of ``X`` or ``X | None`` (exactly one section and optionally ``None``), else ``None``.

    This deliberately re-implements ``ruleset.section_type`` instead of importing it: the structural guard checks the
    schema with its own logic, so a bug in the production helper cannot make the guard agree with it by construction.
    """
    if isinstance(annotation, type) and issubclass(annotation, RulesetSection):
        return annotation
    if get_origin(annotation) in (Union, UnionType):
        arguments = [a for a in get_args(annotation) if a is not type(None)]
        if len(arguments) == 1:
            return optional_section(arguments[0])
    return None


def section_fields(ruleset_type: type[Ruleset] = Ruleset) -> dict[str, type[RulesetSection]]:
    """The value sections of a ruleset type; every other field must be named in ``NON_SECTION_FIELDS``.

    A section may be ``X | None`` (the B3 sections are, so the released ae-heat-0.1 still loads). A field that is
    neither (a table or tuple of sections, a bare model, a union with something else) is a failure: the source check,
    the golden file and the floor walk all look at sections only, so such a field would escape all three.
    """
    declared = ruleset_type.NON_SECTION_FIELDS
    assert declared <= set(ruleset_type.model_fields), f"NON_SECTION_FIELDS names fields that do not exist: {declared}"
    sections: dict[str, type[RulesetSection]] = {}
    for name, info in ruleset_type.model_fields.items():
        if name in declared:
            continue
        annotation = info.annotation
        problem = f"Ruleset.{name} is neither a RulesetSection nor listed in NON_SECTION_FIELDS: {annotation!r}"
        section = optional_section(annotation)
        assert section is not None, problem
        sections[name] = section
    return sections
