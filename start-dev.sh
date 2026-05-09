#!/bin/bash
cd "$(dirname "$0")"

# Source nvm if available so the script works in non-interactive shells
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  export NVM_DIR="$HOME/.nvm"
  . "$HOME/.nvm/nvm.sh" --no-use
  if [ -f .nvmrc ]; then
    nvm use --silent || nvm use default --silent
  else
    nvm use default --silent
  fi
fi

exec npx next dev -p "${PORT:-3000}"
