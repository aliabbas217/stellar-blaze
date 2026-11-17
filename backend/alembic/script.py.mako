"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: str | Sequence[str] | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    """Upgrade schema."""
    # Fail fast instead of queueing behind a long transaction (and blocking everything behind us). Keep these two lines
    # first in every migration; Squawk's require-lock-timeout and require-statement-timeout rules check for them.
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    ${upgrades if upgrades else ""}


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    ${downgrades if downgrades else ""}
