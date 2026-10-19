// @soraban/db: Neon（PostgreSQL 18 + PostGIS）への接続層（Sprint 8）。
// - アプリ用：DATABASE_URL（プール経由）から pg.Pool を遅延生成する（未設定なら接続しない）。
// - マイグレーション：src/migrate.ts（`pnpm db:migrate`）。アプリからは import しない。
export {
  appDatabaseUrl,
  DB_POOL_DEFAULTS,
  describeConnection,
  HEALTH_CHECK_BUDGET_MS,
  isDbConfigured,
  isEvidenceLogEnabled,
  type DbEnv,
} from "./config";
export { closePool, createPool, describeDbError, getPool, type DbPool } from "./pool";
export { checkDbHealth, type DbHealth } from "./health";
export {
  evidenceLogParams,
  INSERT_EVIDENCE_LOG_SQL,
  insertEvidenceLog,
  type EvidenceLogInsert,
  type Queryable,
} from "./evidence";
export { LATEST_MIGRATION_VERSION, MIGRATION_VERSIONS } from "./migrations-manifest";
export * from "./types";
