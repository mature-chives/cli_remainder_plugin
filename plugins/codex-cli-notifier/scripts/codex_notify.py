#!/usr/bin/env python3
"""Backward-compatible launcher for the shared Node.js notifier."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    node = shutil.which("node")
    if node is None:
        return 0

    script = Path(__file__).with_name("cli_notify.js")
    try:
        completed = subprocess.run([node, str(script), *sys.argv[1:]], check=False)
    except OSError:
        return 0
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
