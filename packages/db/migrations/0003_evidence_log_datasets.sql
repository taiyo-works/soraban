-- =============================================================
-- Soraban / Sprint 8: evidence_log に判定で使ったデータセットを持たせる
-- =============================================================
-- - datasets: 判定で使ったデータセット参照の配列（packages/regulations の DatasetRef）。
--   例: [{"id":"did-r2","name":"人口集中地区（令和2年国勢調査）","baseYear":2020,"verifiedAt":"2026-10-19"}]
-- - evidence_id の説明を実態に合わせる。証跡 ID のハッシュ入力には判定時刻を含むため、
--   同じ地点・同じエンジン版でも判定ごとに異なる。
-- - アプリ用ロール soraban_app が存在する場合に限り、最小権限を付与する
--   （参照と evidence_log への追加のみ。evidence_log の更新・削除はさせない）。
--   ロールの作成はマイグレーションの外で行う（packages/db/README.md「DB ロール」）。
-- =============================================================

alter table evidence_log
  add column datasets jsonb not null default '[]'::jsonb;

comment on column evidence_log.datasets is
  '判定で使ったデータセット参照（id・name・baseYear・verifiedAt）の配列。';

comment on table evidence_log is
  '監査トレイル: 地点判定 1 件 = 1 行。evidence_id は SHA-256（先頭16文字）で、判定時刻・エンジン版・データセットの確認日を入力に含むため判定ごとに異なる。';

comment on column evidence_log.evidence_id is
  'packages/regulations の証跡 ID（"ev_" + SHA-256 の先頭16文字）。判定時刻を入力に含むため、同じ地点でも判定ごとに異なる。';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant usage on schema public to soraban_app;
    grant select on regulations, regulation_zones to soraban_app;
    grant select, insert on evidence_log to soraban_app;
    revoke update, delete, truncate on evidence_log from soraban_app;
    if to_regclass('public.schema_migrations') is not null then
      grant select on schema_migrations to soraban_app;
    end if;
  end if;
end
$$;
