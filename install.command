#!/bin/bash
# Double-click installer for macOS: Finder opens this in Terminal and runs install.sh.
cd "$(dirname "$0")" || exit 1
bash ./install.sh "$@"
rc=$?
printf '\nPress any key to close this window.\n'
read -n 1 -s -r
printf '\n'
exit "$rc"
