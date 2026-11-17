"""Test helper for the privacy guards: has a fragment of a worker's reference reached a log, a row or a response?"""

import re

_HEX = "0-9a-fA-F"


def contains_standalone(text: str, fragment: str) -> bool:
    """Whether ``fragment`` occurs in ``text`` NOT inside a longer run of hexadecimal digits.

    A bare ``fragment in text`` is a false alarm waiting to happen when the fragment is made of digits (the fake worker
    reference ``staff-no-4471-AliKhan`` is guarded by its ``4471``): logs, hashes and request ids are random hex, and
    four digits appear inside one by chance (a CI run failed on ``...d4471908531...``, 2026-11-17; roughly one hash in
    a thousand). A real leak of the reference is flanked by characters that are not hex digits
    (``staff-no-4471-AliKhan``, ``"worker_ref": "4471"``), so it is still found. Guard the whole reference and its name
    with a plain ``in`` as well: they cannot occur inside a hash.
    """
    return re.search(rf"(?<![{_HEX}]){re.escape(fragment)}(?![{_HEX}])", text) is not None
