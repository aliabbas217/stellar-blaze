"""The heat-risk warning levels that the policy, the notification port and the API share."""

from enum import StrEnum


class AlertLevel(StrEnum):
    """The four warning levels of plan section 8.4, declared in ascending severity.

    The values are the lowercase codes of the wire contracts (the API's ``Level`` and the Web Push payload). Members
    compare as strings, not by severity, so rank them by their position in this declaration. The probability
    thresholds that map a forecast onto a level belong to the risk policy (B3), not to this vocabulary.
    """

    GREEN = "green"
    AMBER = "amber"
    ORANGE = "orange"
    RED = "red"
