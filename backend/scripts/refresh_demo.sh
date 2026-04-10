#!/bin/bash
# refresh_demo.sh — refreshes the demo account data in production Supabase
#
# Usage (from the backend/ directory):
#   ./scripts/refresh_demo.sh
#
# What it does:
#   - Resets demo@tidal.app password to TidalDemo2026!
#   - Adds any missing accounts, schedules, transactions
#   - Extends rolling transactions to cover the current month
#   - Safe to run multiple times (idempotent)
#
# Requirements:
#   - .env file in backend/ with DATABASE_URL set to the Supabase direct URL
#     DATABASE_URL=postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres
#   - Python venv activated (source .venv/bin/activate)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set."
    echo "Either set it in backend/.env or export it before running this script."
    echo ""
    echo "Example:"
    echo "  export DATABASE_URL='postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres'"
    exit 1
fi

echo "Refreshing demo data..."
echo "Database: $(echo $DATABASE_URL | sed 's/:.*@/@/')"  # hide password in output
echo ""

cd "$BACKEND_DIR"
python scripts/seed_demo.py

echo ""
echo "Done. Demo account is ready at https://tidal-vert.vercel.app"
