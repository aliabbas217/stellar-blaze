import pytest


@pytest.mark.integration
def test_integration_tier_carries_enable_socket(request: pytest.FixtureRequest) -> None:
    # Without the marker pytest-socket blocks docker-py's unix socket on Linux CI (preflight F3), a failure that never
    # shows on a Windows named pipe. This proves the collection hook in conftest.py marked the tier.
    assert request.node.get_closest_marker("enable_socket") is not None
