#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Tsuruoka graduation columns — idempotent SQL migration.
# Direct SQL is used here because drizzle-kit push prompts interactively for
# an unrelated oauth_tokens constraint (stdin is closed in CI → EOF → fails).
# IF NOT EXISTS makes this safe to run on every deploy.
psql "$DATABASE_URL" -c "
  ALTER TABLE students ADD COLUMN IF NOT EXISTS tsuruoka_graduado boolean DEFAULT false;
  ALTER TABLE students ADD COLUMN IF NOT EXISTS tsuruoka_fecha_graduacion date;
"
