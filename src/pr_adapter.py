# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 listky and dsh-ali-open-code-review Contributors

"""Bind the unmodified upstream PR helper to this plugin's native OCR binary.

The upstream script calls the literal executable name ``ocr``. A direct argv
binding also works on Windows, where npm's ocr.cmd is not a native executable.
All GitHub, Git, snapshot, policy, reporting, and cleanup logic stays upstream.
"""

import os
import runpy
import subprocess
import sys


def main():
    script, executable, *arguments = sys.argv[1:]
    original_popen = subprocess.Popen

    class BoundOcrPopen(original_popen):
        def __init__(self, args, *positional, **options):
            if isinstance(args, (list, tuple)) and args and args[0] == "ocr":
                args = [executable, *args[1:]]
                # DSH owns the whole process range. Keep OCR inside its group
                # even when the POSIX provider uses its process-group fallback.
                if os.name == "posix":
                    options["start_new_session"] = False
            super().__init__(args, *positional, **options)

    subprocess.Popen = BoundOcrPopen
    sys.argv = [script, *arguments]
    try:
        runpy.run_path(script, run_name="__main__")
    finally:
        subprocess.Popen = original_popen


if __name__ == "__main__":
    main()
