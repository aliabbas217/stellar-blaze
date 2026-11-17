"""Read-only git queries for the 2026 gate (pre-registration section 9), behind a small protocol.

The gate asks four questions of the repository: what is HEAD, is the working tree clean, is one commit an ancestor of
another, and what were the bytes of a file at a commit. ``GitReader`` names them so tests can fake the answers;
``SubprocessGit`` answers them with the ``git`` executable, resolved once, without a shell, never writing to the
repository.
"""

import os
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Final, Protocol

__all__ = ["GitError", "GitReader", "SubprocessGit"]

_TIMEOUT_SECONDS: Final = 60
_NOT_A_VALID_OBJECT: Final = 128  # git's exit code for a fatal error, such as an unknown commit name


_REPOSITORY_SELECTING_VARIABLES: Final = frozenset(
    {
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
        "GIT_PREFIX",
    }
)
"""Variables that make git act on another repository than ``cwd`` (a git hook sets some of them)."""


def _child_environment(base: Mapping[str, str]) -> dict[str, str]:
    """``base`` without any repository-selecting variable, and with the C locale so git's messages are stable."""
    env = {name: value for name, value in base.items() if name.upper() not in _REPOSITORY_SELECTING_VARIABLES}
    env["LC_ALL"] = "C"
    return env


class GitError(RuntimeError):
    """``git`` is missing or a query failed in a way that is not a plain "no"."""


class GitReader(Protocol):
    """The four repository questions the gate asks."""

    def head(self) -> str:
        """The full commit id of HEAD."""
        ...

    def is_clean(self) -> bool:
        """True when there are no modified, staged or untracked files."""
        ...

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        """True when ``ancestor`` is reachable from ``descendant`` (a commit is its own ancestor)."""
        ...

    def show(self, commit: str, path: str) -> bytes:
        """The bytes of ``path`` as committed at ``commit``."""
        ...


def _refuse_option(argument: str) -> str:
    """A commit or path that starts with ``-`` would be read by git as an option."""
    if argument.startswith("-"):
        raise ValueError(f"{argument!r} starts with '-' and would be read as a git option")
    return argument


class SubprocessGit:
    """``GitReader`` over the ``git`` executable, run in ``repo_root`` with no shell."""

    def __init__(self, repo_root: Path) -> None:
        """Resolve ``git`` once.

        Raises:
            GitError: No ``git`` executable on ``PATH``.
        """
        executable = shutil.which("git")
        if executable is None:
            raise GitError("the git executable was not found on PATH; the 2026 gate needs it")
        self._git = executable
        self._root = repo_root

    def _run(self, *args: str, ok: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[bytes]:
        """Run ``git <args>`` in the repository root; an exit code outside ``ok`` raises ``GitError`` (git's message).

        The environment keeps the caller's (``GIT_CONFIG_*`` and the like) but drops every variable that selects the
        repository, so a ``GIT_DIR`` inherited from a hook cannot point the gate at another repository.
        """
        # The executable is the one shutil.which resolved, the arguments are a fixed list (no shell), and the commit
        # and path arguments come from the committed lock and are checked by _refuse_option where they are free text.
        result = subprocess.run(  # noqa: S603
            [self._git, *args],
            check=False,
            capture_output=True,
            cwd=self._root,
            env=_child_environment(os.environ),
            timeout=_TIMEOUT_SECONDS,
        )
        if result.returncode not in ok:
            message = result.stderr.decode("utf-8", errors="replace").strip()
            raise GitError(f"git {' '.join(args)} exited {result.returncode} in {self._root}: {message}")
        return result

    def head(self) -> str:
        """The full commit id of HEAD (``git rev-parse HEAD``)."""
        return self._run("rev-parse", "HEAD").stdout.decode("ascii").strip()

    def is_clean(self) -> bool:
        """True when ``git status --porcelain`` lists nothing; an untracked file counts as dirty."""
        # --untracked-files=all so that a user's status.showUntrackedFiles=no cannot hide a file.
        return not self._run("status", "--porcelain", "--untracked-files=all").stdout.strip()

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        """``git merge-base --is-ancestor``: exit 0 is True, 1 is False, an unknown commit (128) is False too.

        Raises:
            GitError: Any other failure.
            ValueError: An argument starts with ``-``.
        """
        result = self._run(
            "merge-base",
            "--is-ancestor",
            _refuse_option(ancestor),
            _refuse_option(descendant),
            ok=(0, 1, _NOT_A_VALID_OBJECT),
        )
        return result.returncode == 0

    def show(self, commit: str, path: str) -> bytes:
        """The bytes of ``path`` at ``commit`` (``git show <commit>:<path>``), exactly as stored.

        Raises:
            GitError: The commit or the path does not exist.
            ValueError: ``commit`` starts with ``-``.
        """
        # --no-textconv: a diff driver in .gitattributes must not rewrite the bytes the gate hashes.
        return self._run("show", "--no-textconv", f"{_refuse_option(commit)}:{path}").stdout
