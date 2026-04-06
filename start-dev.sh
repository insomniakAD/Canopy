#!/bin/bash
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")"
exec npx next dev -p "${PORT:-3000}"
