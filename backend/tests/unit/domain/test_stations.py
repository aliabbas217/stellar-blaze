import pytest

from stellar_blaze.domain.weather.stations import STATIONS, Station, station

pytestmark = pytest.mark.unit


def test_eight_stations_six_clusters() -> None:
    assert len(STATIONS) == 8
    assert len({s.cluster for s in STATIONS}) == 6
    assert station("OMSJ").cluster == station("OMDB").cluster
    assert station("OMRK").ghcnh_id == "AEU041184-1"


def test_clusters_match_the_validation_folds_of_adr_0005() -> None:
    clusters: dict[str, set[str]] = {}
    for s in STATIONS:
        clusters.setdefault(s.cluster, set()).add(s.icao)
    assert sorted(map(sorted, clusters.values())) == [
        ["OMAA", "OMAD"],
        ["OMAL"],
        ["OMDB", "OMSJ"],
        ["OMDW"],
        ["OMFJ"],
        ["OMRK"],
    ]


def test_identifiers_are_unique() -> None:
    assert len({s.icao for s in STATIONS}) == len(STATIONS)
    assert len({s.ghcnh_id for s in STATIONS}) == len(STATIONS)


def test_station_returns_the_matching_record() -> None:
    assert station("OMAL") == Station(
        icao="OMAL",
        name="Al Ain Intl",
        lat=24.2617,
        lon=55.6092,
        elevation_m=264.9,
        ghcnh_id="AEI0000OMAL",
        cluster="al_ain",
    )


@pytest.mark.parametrize("s", STATIONS, ids=lambda s: s.icao)
def test_every_station_is_inside_the_uae(s: Station) -> None:
    assert 22.0 < s.lat < 26.5
    assert 51.0 < s.lon < 57.0
    assert 0.0 <= s.elevation_m < 500.0
    assert s.ghcnh_id


def test_station_unknown_id_raises_key_error_listing_the_known_ids() -> None:
    with pytest.raises(KeyError) as excinfo:
        station("EGLL")
    message = str(excinfo.value)
    assert "EGLL" in message
    assert all(s.icao in message for s in STATIONS)


def test_station_lookup_is_case_sensitive() -> None:
    with pytest.raises(KeyError):
        station("omdb")
