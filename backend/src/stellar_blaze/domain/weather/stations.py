"""The eight UAE airport stations that supply the truth observations and the forecast points.

Coordinates are the NOAA GHCNh station-list values (OMRK: ISD history) that
``docs/research/scripts/fetch_forecast_stations.py`` used to pull the archived forecasts; elevations are the station
elevations of the data-availability study (section 3.2); clusters are the validation folds of ADR 0005.
"""

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class Station:
    """One observing station.

    Attributes:
        icao: ICAO identifier, which is also the IEM METAR station id.
        name: Short display name.
        lat: Latitude in decimal degrees north.
        lon: Longitude in decimal degrees east.
        elevation_m: Station elevation above mean sea level, in meters.
        ghcnh_id: GHCNh station identifier.
        cluster: Validation cluster. Stations of one cluster share a forecast cell or an error series, so they are
            always held out together (ADR 0005).
    """

    icao: str
    name: str
    lat: float
    lon: float
    elevation_m: float
    ghcnh_id: str
    cluster: str


STATIONS: Final[tuple[Station, ...]] = (
    Station("OMAA", "Abu Dhabi Intl", 24.4330, 54.6511, 26.8, "AEI0000OMAA", "abu_dhabi"),
    Station("OMAD", "Al Bateen", 24.4283, 54.4581, 4.9, "AEI0000OMAD", "abu_dhabi"),
    Station("OMAL", "Al Ain Intl", 24.2617, 55.6092, 264.9, "AEI0000OMAL", "al_ain"),
    Station("OMDB", "Dubai Intl", 25.2550, 55.3643, 10.4, "AEI0000OMDB", "dubai_sharjah"),
    Station("OMSJ", "Sharjah Intl", 25.3286, 55.5172, 33.8, "AEI0000OMSJ", "dubai_sharjah"),
    Station("OMDW", "Al Maktoum Intl", 24.8861, 55.1722, 18.9, "AEI0000OMDW", "al_maktoum"),
    Station("OMFJ", "Fujairah Intl", 25.1122, 56.3240, 46.3, "AEI0000OMFJ", "fujairah"),
    Station("OMRK", "Ras Al Khaimah", 25.6130, 55.9390, 31.1, "AEU041184-1", "ras_al_khaimah"),
)

_BY_ICAO: Final[dict[str, Station]] = {s.icao: s for s in STATIONS}


def station(icao: str) -> Station:
    """Return the station with this ICAO identifier.

    Raises:
        KeyError: The identifier is not one of ``STATIONS``; the message lists the known identifiers.
    """
    try:
        return _BY_ICAO[icao]
    except KeyError:
        known = ", ".join(s.icao for s in STATIONS)
        raise KeyError(f"unknown station {icao!r}; known stations: {known}") from None
