import socket

import pytest
from pytest_socket import SocketConnectBlockedError


@pytest.mark.unit
def test_unit_tier_cannot_reach_a_non_loopback_host() -> None:
    # The integration tier is allowed to reach Docker (tests/integration/conftest.py); that must not leak into here.
    # 192.0.2.1 is TEST-NET-1 (RFC 5737): never routable, and blocked before any packet is sent.
    with pytest.warns(UserWarning, match=r"socket\.connect\(\)"), pytest.raises(SocketConnectBlockedError):
        socket.create_connection(("192.0.2.1", 9), timeout=0.2)
