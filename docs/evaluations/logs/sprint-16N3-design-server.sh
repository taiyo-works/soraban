#!/bin/bash
# 16-N3 designer：検証用の next start（ops の E2E と同じ環境変数）。使い方: sprint-16N3-design-server.sh <DB 名> <ポート>
DB=$1; PORT=${2:-3400}
cd /home/user/soraban
TZ=UTC OPS_TEST_NOW="2027-01-05T12:00:00+09:00" OPS_ENABLED=1 AUTH_PROVIDER=test AUTH_TEST_SECRET=e2e-only-not-a-secret \
DATABASE_URL="postgresql://soraban_app:soraban_app_ci_only@localhost:5432/$DB" EVIDENCE_LOG=off NEON_AUTH_BASE_URL= NEON_AUTH_COOKIE_SECRET= \
DIPS_REPORT_ADAPTER= VERCEL_ENV= NEXT_DIST_DIR= APPLICATION_SUPPORT_ENABLED= DESIGN_CATALOG=1 \
exec pnpm --filter @soraban/web exec next start -p "$PORT" -H 127.0.0.1 --keepAliveTimeout 120000
