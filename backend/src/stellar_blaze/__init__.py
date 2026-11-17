"""Stellar Blaze: heat-stress early-warning backend."""

from importlib.metadata import version

# Single source of truth is [project].version in pyproject.toml; read it back from the installed metadata.
__version__: str = version("stellar-blaze")
