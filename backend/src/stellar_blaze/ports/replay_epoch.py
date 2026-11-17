"""The port of the replay clock's time base: when the current demo epoch started (ADR 0034 amendment of 2026-11-15).

In replay mode the domain "now" is ``replay anchor + (wall now - start of the current epoch)``; the epoch start lives in
the ``site_epoch`` row, so every process that reads it (the API, the alerts worker, a restarted one) agrees on replay
time. It is its own small port, not a method of ``ports.sites``, so the scoring import closure of the offline runners
stays untouched.
"""

from datetime import datetime
from typing import Protocol

__all__ = ["ReplayEpochSource"]


class ReplayEpochSource(Protocol):
    """Where the replay clock reads the start of the current demo epoch."""

    async def current_epoch_start(self) -> datetime | None:
        """The start of the current demo epoch: the latest ``started_at`` over the SYNTHETIC sites' epochs,
        timezone-aware UTC; ``None`` when no synthetic site has an epoch (nothing to anchor the replay clock to).

        Raises:
            Exception: Whatever the store raises when it cannot be reached; the clock treats any failure as "unknown",
                never as a time.
        """
        ...
