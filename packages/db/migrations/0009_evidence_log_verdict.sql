-- =============================================================
-- Soraban / Sprint 11d: evidence_log に判定（4 段）の列を足す
-- =============================================================
-- 判定を 4 段（飛行不可／要手続き／手続き済み（条件付き）／手続き不要）＋判定不能に組み直した
-- （docs/spec.md §13.9、ENGINE_VERSION soraban-0.4.0-verdict-2026-10）。判定を別の列で持つ。
--
-- - 追記のみ。既存の行は書き換えない（新しい列は null のまま。後追いの補完もしない）。
-- - 適用済みのマイグレーション（0001〜0008）は変えない。
-- - アプリ用ロール soraban_app の権限（参照と追加のみ。更新・削除は不可）は 0003 のまま。
--   表単位の insert 権限のため、新しい列にも追加できる。
-- =============================================================

alter table evidence_log
  add column verdict text null;

alter table evidence_log
  add constraint evidence_log_verdict_check
  check (verdict is null or verdict in ('no_fly', 'needs_procedure', 'procedure_done', 'no_procedure'));

alter table evidence_log
  add column verdict_unknown_count integer null;

alter table evidence_log
  add constraint evidence_log_verdict_unknown_count_check
  check (verdict_unknown_count is null or verdict_unknown_count >= 0);

alter table evidence_log
  add column per_regulation_verdict jsonb null;

alter table evidence_log
  add column applied_permits text[] null;

comment on column evidence_log.verdict is
  '判定（4 段）：no_fly（飛行不可）／needs_procedure（要手続き。判定不能を含む）／procedure_done（手続き済み（条件付き））／no_procedure（手続き不要）。engine_version が soraban-0.4.0 以降の行で埋まる。0.3.0 までの行は null。';

comment on column evidence_log.verdict_unknown_count is
  '判定不能（データ未整備）の規制の件数。0.3.0 までの行は null。';

comment on column evidence_log.per_regulation_verdict is
  '規制ごとの判定（regulations.id → no_fly／needs_procedure／procedure_done／no_procedure／unknown）。0.3.0 までの行は null。';

comment on column evidence_log.applied_permits is
  '判定に当てた許可・同意の値（入力した pilotPermits。旧値 mlit は mlit:did に読み替え、並べ替え済み。許可がなければ空配列）。0.3.0 までの行は null。';

comment on column evidence_log.overall is
  '元の判定の集約（red／yellow／green／unknown）。意味は engine_version で読み分ける：0.3.0 までは許可を当てた後、0.4.0 からは許可を当てる前の元の判定。4 段の判定は verdict 列。';

comment on column evidence_log.per_regulation_status is
  '規制ごとの status（regulations.id → red／yellow／green／unknown）。0.3.0 までは許可を当てた後、0.4.0 からは許可を当てる前の元の判定。';
