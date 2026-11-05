#!/usr/bin/env bash
# Install EZAgent (and optionally two public plugins) into the DeepSeek Harness desktop profile.
# Quit DeepSeek Harness completely before running this script.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROFILE_DIR="$HOME/.dsh/profiles/desktop"
PUBLIC_PLUGINS=(
  "dsh-mnemon@0.5.39"
  "@huanlin/dsh-plugin-better-sidebar-plugin-office@0.2.0"
)
LOCAL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --local-only) LOCAL_ONLY=1 ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

fail() {
  printf '\n%s%s%s\n' "$RED" "$1" "$RESET"
  exit 1
}

# 1. Locate the tarball next to this script (or in its dist folder).
tgz=""
for dir in "$SCRIPT_DIR" "$SCRIPT_DIR/dist"; do
  for f in "$dir"/EZAgent-*.tgz; do
    [ -e "$f" ] || continue
    if [ -z "$tgz" ] || [ "$f" -nt "$tgz" ]; then tgz="$f"; fi
  done
done
[ -n "$tgz" ] || fail "EZAgent-*.tgz not found. Put install.sh, install.command and the tgz in the same folder."

# 2. The desktop profile must exist (opened once by the app).
[ -f "$PROFILE_DIR/package.json" ] || fail "No DSH desktop profile at $PROFILE_DIR. Open DeepSeek Harness once, quit it, then run this again."

# 3. DeepSeek Harness must be closed.
if command -v pgrep >/dev/null 2>&1; then
  if pgrep -f 'DeepSeek Harness\.app' >/dev/null 2>&1 || pgrep -x 'DeepSeek Harness' >/dev/null 2>&1; then
    fail "DeepSeek Harness is running. Quit it completely (including the menu bar icon), then run this again."
  fi
fi

# 4. Without the dsh command, point at the plugin page.
if ! command -v dsh >/dev/null 2>&1; then
  printf '%sNo dsh command found. Install from the plugin page instead:%s\n' "$YELLOW" "$RESET"
  printf '  1. Open DeepSeek Harness, then Plugins -> Add plugin\n'
  printf '  2. Paste: %s\n' "$tgz"
  step=3
  if [ "$LOCAL_ONLY" -eq 0 ]; then
    for p in "${PUBLIC_PLUGINS[@]}"; do
      printf '  %s. Add: %s\n' "$step" "$p"
      step=$((step + 1))
    done
  fi
  printf '  %s. Restart DeepSeek Harness\n' "$step"
  exit 2
fi

# 5. The compatibility check uses the dsh command's own version, not the app's.
runtime="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json"
if [ -f "$runtime" ]; then
  app_version=$(sed -n 's/.*"desktopVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$runtime" | head -n 1)
  cli_version=$(dsh --version 2>/dev/null | head -n 1)
  if [ -n "$app_version" ] && [ -n "$cli_version" ] && [ "$app_version" != "$cli_version" ]; then
    printf '%sNote: dsh is %s but the desktop runtime is %s. If the install is rejected as incompatible, use the plugin page or run: npm i -g @deepseek-ai/dsh@latest%s\n' \
      "$YELLOW" "$cli_version" "$app_version" "$RESET"
  fi
fi

# 6. Install EZAgent.
printf 'Installing EZAgent from %s\n' "$tgz"
if ! dsh plugin --profile desktop add "$tgz"; then
  fail "EZAgent installation failed. Logs: $PROFILE_DIR/.plugin-manager/logs"
fi

# 7. Install the public plugins; a failure here does not undo EZAgent.
if [ "$LOCAL_ONLY" -eq 0 ]; then
  printf 'Installing public plugins: %s\n' "${PUBLIC_PLUGINS[*]}"
  if ! dsh plugin --profile desktop add "${PUBLIC_PLUGINS[@]}"; then
    printf '%sPublic plugins could not be installed (offline or incompatible). EZAgent is installed; retry later from the plugin page.%s\n' "$YELLOW" "$RESET"
  fi
fi

# 8. Verify that EZAgent landed and is enabled as a bundle.
[ -f "$PROFILE_DIR/node_modules/EZAgent/package.json" ] || fail "EZAgent was not found in the profile after installation."
if ! sed -n '/"bundles"[[:space:]]*:[[:space:]]*\[/,/\]/p' "$PROFILE_DIR/package.json" | grep -q '"EZAgent"'; then
  fail "EZAgent is installed but not enabled in dsh.profile.bundles. Enable it on the plugin page."
fi

printf '\n%sDone. Start DeepSeek Harness to load it.%s\n' "$GREEN" "$RESET"
exit 0
