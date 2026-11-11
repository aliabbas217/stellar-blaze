"""Command-line entry point for scheduled jobs, installed as ``sb-jobs``. Commands arrive with the ingest task."""

import typer

app = typer.Typer(no_args_is_help=True)
