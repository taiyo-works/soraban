-- =============================================================
-- Soraban / Sprint 12a: 版の履歴に飛行計画・よく使う地点を加える、運航管理者の確認（plan_confirmations）
-- =============================================================
-- - record_versions.entity_type に flight_plan・saved_place を加える（検査制約の差し替え。値を増やすだけ）。
-- - 追加前のトリガー：飛行計画の版の data に、DB が求める値（planned_date）を入れる（アプリが送った値は上書きする）。
--   飛行計画の作成は組織単位で直列化しない（重なりの検査はない）。
-- - 追加後のトリガー：data から flight_plans・saved_places の行を作る・更新する。機体・操縦者・よく使う地点は同じ組織に限る
--   （SB404）。機体は訂正で変えられない（23514 aircraft_immutable）。
-- - verify_record_chain：flight_plan・saved_place の表の対応と、予定開始の時刻（日本時間の `YYYY-MM-DDTHH:MM`）の比較を加える。
-- - 関数は 0008 の定義を置き換える（member・aircraft・pilot・daily_inspection・flight_record の分岐は 0008 と同じ）。
-- - plan_confirmations（追記専用）：運航管理者の確認・差し戻し。self_confirmation・confirmer_name・created_at・content_hash は
--   追加前のトリガーが決める。計画の状態（確認待ち・確認済みなど）は保存せず、この表と計画の版から読み出しのたびに求める。
-- - content_hash の計算規則（soraban-record-v1）は変えない。要素 3（entity_type）の値が増えるだけ。
-- =============================================================

alter table record_versions drop constraint record_versions_entity_type_check;
alter table record_versions add constraint record_versions_entity_type_check
  check (entity_type in ('member', 'aircraft', 'pilot', 'daily_inspection', 'flight_record', 'flight_plan', 'saved_place'));

-- ---- 追加前のトリガー ---------------------------------------

create or replace function record_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_no integer;
  v_prev_hash text;
  v_prev_org uuid;
  v_prev_op text;
  v_expected text;
  v_takeoff timestamptz;
  v_landing timestamptz;
  v_at timestamptz;
  v_abnormal boolean;
  v_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('record_versions:' || new.entity_type || ':' || new.entity_id::text, 0));
  if new.entity_type = 'member' then
    -- 最後の運航管理者の判定を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('members_org:' || new.org_id::text, 0));
  elsif new.entity_type = 'flight_record' then
    -- 飛行記録の重なりの検査（追加後のトリガー）を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('flight_records_org:' || new.org_id::text, 0));
  end if;

  select version_no, content_hash, org_id, op
    into v_prev_no, v_prev_hash, v_prev_org, v_prev_op
    from record_versions
   where entity_type = new.entity_type and entity_id = new.entity_id
   order by version_no desc
   limit 1;

  if v_prev_no is null then
    if new.op <> 'create' then
      raise exception 'record not found' using errcode = 'SB404';
    end if;
    new.version_no := 1;
    new.prev_hash := '';
  else
    if new.op = 'create' then
      raise exception 'record already exists' using errcode = 'SB409', detail = 'already_exists';
    end if;
    if v_prev_org <> new.org_id then
      raise exception 'record not found' using errcode = 'SB404';
    end if;
    if v_prev_op = 'void' then
      raise exception 'record is voided' using errcode = 'SB409', detail = 'voided';
    end if;
    v_expected := nullif(current_setting('soraban.expected_version', true), '');
    if v_expected is not null and v_expected::integer <> v_prev_no then
      raise exception 'version conflict' using errcode = 'SB409', detail = 'version_conflict';
    end if;
    new.version_no := v_prev_no + 1;
    new.prev_hash := v_prev_hash;
  end if;

  -- DB が求める値を data に入れる（アプリが送った値は使わない）
  if new.entity_type = 'flight_record' then
    v_takeoff := ops_jst_minute_to_timestamptz(new.data->>'takeoff_at');
    v_landing := ops_jst_minute_to_timestamptz(new.data->>'landing_at');
    new.data := new.data || jsonb_build_object(
      'flight_minutes', ops_flight_minutes(v_takeoff, v_landing),
      'flight_date', to_char(ops_jst_date(v_takeoff), 'YYYY-MM-DD')
    );
  elsif new.entity_type = 'flight_plan' then
    -- 予定日（JST の日付）は予定開始から DB が決める
    v_start := ops_jst_minute_to_timestamptz(new.data->>'planned_start_at');
    new.data := new.data || jsonb_build_object('planned_date', to_char(ops_jst_date(v_start), 'YYYY-MM-DD'));
  elsif new.entity_type = 'daily_inspection' then
    v_at := ops_jst_minute_to_timestamptz(new.data->>'inspected_at');
    select coalesce(bool_or(value->>'result' = 'abnormal'), false)
      into v_abnormal
      from jsonb_each(case when jsonb_typeof(new.data->'items') = 'object' then new.data->'items' else '{}'::jsonb end);
    new.data := new.data || jsonb_build_object(
      'inspected_date', to_char(ops_jst_date(v_at), 'YYYY-MM-DD'),
      'has_abnormal', v_abnormal
    );
  end if;

  new.created_at := clock_timestamp();
  new.content_hash := record_version_hash(
    new.prev_hash, new.entity_type, new.entity_id, new.version_no, new.op, new.data,
    new.reason, new.actor_kind, new.actor_member_id, new.created_at
  );
  return new;
end;
$$;

-- ---- 追加後のトリガー（ヘッド表の作成・更新） ---------------

create or replace function record_versions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := new.data;
  v_was_manager boolean;
  v_head_aircraft uuid;
  v_conflict uuid;
  r record;
begin
  if new.entity_type = 'member' then
    select (role = 'manager' and status = 'active' and voided_at is null)
      into v_was_manager
      from members where id = new.entity_id;

    if new.op = 'create' then
      insert into members (id, org_id, email, display_name, role, status, auth_provider, auth_user_id,
                           current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'email', d->>'display_name', d->>'role', d->>'status',
              d->>'auth_provider', d->>'auth_user_id', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update members
         set email = d->>'email', display_name = d->>'display_name', role = d->>'role', status = d->>'status',
             auth_provider = d->>'auth_provider', auth_user_id = d->>'auth_user_id',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update members set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

    if coalesce(v_was_manager, false) and not exists (
      select 1 from members
       where org_id = new.org_id and role = 'manager' and status = 'active' and voided_at is null
    ) then
      raise exception 'last active manager' using errcode = 'SB409', detail = 'last_manager';
    end if;

  elsif new.entity_type = 'aircraft' then
    if new.op = 'create' then
      insert into aircraft (id, org_id, registration_mark, model_name, manufacturer, serial_number,
                            type_certified, type_cert_category, type_cert_model, type_cert_number,
                            airworthiness_class, airworthiness_cert_number, max_takeoff_weight_kg,
                            initial_flight_minutes, status, current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'registration_mark', d->>'model_name', d->>'manufacturer',
              d->>'serial_number', (d->>'type_certified')::boolean, d->>'type_cert_category',
              d->>'type_cert_model', d->>'type_cert_number', d->>'airworthiness_class',
              d->>'airworthiness_cert_number', (d->>'max_takeoff_weight_kg')::numeric,
              (d->>'initial_flight_minutes')::integer, d->>'status', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update aircraft
         set registration_mark = d->>'registration_mark', model_name = d->>'model_name',
             manufacturer = d->>'manufacturer', serial_number = d->>'serial_number',
             type_certified = (d->>'type_certified')::boolean, type_cert_category = d->>'type_cert_category',
             type_cert_model = d->>'type_cert_model', type_cert_number = d->>'type_cert_number',
             airworthiness_class = d->>'airworthiness_class', airworthiness_cert_number = d->>'airworthiness_cert_number',
             max_takeoff_weight_kg = (d->>'max_takeoff_weight_kg')::numeric,
             initial_flight_minutes = (d->>'initial_flight_minutes')::integer, status = d->>'status',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update aircraft set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'pilot' then
    if new.op = 'create' then
      insert into pilots (id, org_id, full_name, has_license, license_class, license_number, license_expires_on,
                          limitation_type, limitation_weight, limitation_daytime, limitation_vlos, member_id,
                          current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'full_name', (d->>'has_license')::boolean, d->>'license_class',
              d->>'license_number', (d->>'license_expires_on')::date,
              coalesce((d->>'limitation_type')::boolean, false), coalesce((d->>'limitation_weight')::boolean, false),
              coalesce((d->>'limitation_daytime')::boolean, false), coalesce((d->>'limitation_vlos')::boolean, false),
              (d->>'member_id')::uuid, new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update pilots
         set full_name = d->>'full_name', has_license = (d->>'has_license')::boolean,
             license_class = d->>'license_class', license_number = d->>'license_number',
             license_expires_on = (d->>'license_expires_on')::date,
             limitation_type = coalesce((d->>'limitation_type')::boolean, false),
             limitation_weight = coalesce((d->>'limitation_weight')::boolean, false),
             limitation_daytime = coalesce((d->>'limitation_daytime')::boolean, false),
             limitation_vlos = coalesce((d->>'limitation_vlos')::boolean, false),
             member_id = (d->>'member_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update pilots set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;
    -- 操縦者に結び付ける利用者は同じ組織の利用者に限る
    if (d->>'member_id') is not null and not exists (
      select 1 from members where id = (d->>'member_id')::uuid and org_id = new.org_id
    ) then
      raise exception 'member not found' using errcode = 'SB404';
    end if;

  elsif new.entity_type = 'daily_inspection' then
    if new.op in ('create', 'update') then
      -- 機体・実施者は同じ組織のものに限る。機体は訂正で変えられない
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
    end if;
    if new.op = 'create' then
      insert into daily_inspections (id, org_id, aircraft_id, pilot_id, inspected_at, inspected_date, timing, place_name,
                                     latitude, longitude, accuracy_m, items, has_abnormal, special_notes,
                                     inspector_name, inspector_version, client_request_id,
                                     current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              ops_jst_minute_to_timestamptz(d->>'inspected_at'), (d->>'inspected_date')::date, d->>'timing',
              d->>'place_name', (d->>'latitude')::numeric, (d->>'longitude')::numeric, (d->>'accuracy_m')::integer,
              d->'items', (d->>'has_abnormal')::boolean, d->>'special_notes',
              d->>'inspector_name', (d->>'inspector_version')::integer, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from daily_inspections where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update daily_inspections
         set pilot_id = (d->>'pilot_id')::uuid, inspected_at = ops_jst_minute_to_timestamptz(d->>'inspected_at'),
             inspected_date = (d->>'inspected_date')::date, timing = d->>'timing', place_name = d->>'place_name',
             latitude = (d->>'latitude')::numeric, longitude = (d->>'longitude')::numeric,
             accuracy_m = (d->>'accuracy_m')::integer, items = d->'items', has_abnormal = (d->>'has_abnormal')::boolean,
             special_notes = d->>'special_notes', inspector_name = d->>'inspector_name',
             inspector_version = (d->>'inspector_version')::integer, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update daily_inspections set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'flight_record' then
    if new.op in ('create', 'update') then
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
      -- 日常点検の紐付けは同じ組織・同じ機体の点検に限る
      if (d->>'daily_inspection_id') is not null and not exists (
        select 1 from daily_inspections
         where id = (d->>'daily_inspection_id')::uuid and org_id = new.org_id and aircraft_id = (d->>'aircraft_id')::uuid
      ) then
        raise exception 'inspection of another aircraft' using errcode = '23514', detail = 'inspection_mismatch';
      end if;
    end if;
    if new.op = 'create' then
      insert into flight_records (id, org_id, aircraft_id, pilot_id, daily_inspection_id, flight_plan_id, snapshot_id,
                                  purpose, waypoints, specific_flight_types,
                                  takeoff_place, takeoff_lat, takeoff_lng, takeoff_accuracy_m,
                                  landing_place, landing_lat, landing_lng, landing_accuracy_m,
                                  takeoff_at, landing_at, flight_minutes, flight_date,
                                  safety_issue, safety_issue_detail, defects,
                                  pilot_name, pilot_license_number, pilot_version, client_request_id,
                                  current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              (d->>'daily_inspection_id')::uuid, (d->>'flight_plan_id')::uuid, (d->>'snapshot_id')::uuid,
              d->>'purpose', d->>'waypoints', coalesce(d->'specific_flight_types', '[]'::jsonb),
              d->>'takeoff_place', (d->>'takeoff_lat')::numeric, (d->>'takeoff_lng')::numeric, (d->>'takeoff_accuracy_m')::integer,
              d->>'landing_place', (d->>'landing_lat')::numeric, (d->>'landing_lng')::numeric, (d->>'landing_accuracy_m')::integer,
              ops_jst_minute_to_timestamptz(d->>'takeoff_at'), ops_jst_minute_to_timestamptz(d->>'landing_at'),
              (d->>'flight_minutes')::integer, (d->>'flight_date')::date,
              (d->>'safety_issue')::boolean, d->>'safety_issue_detail', coalesce(d->'defects', '[]'::jsonb),
              d->>'pilot_name', d->>'pilot_license_number', (d->>'pilot_version')::integer, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from flight_records where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update flight_records
         set pilot_id = (d->>'pilot_id')::uuid, daily_inspection_id = (d->>'daily_inspection_id')::uuid,
             flight_plan_id = (d->>'flight_plan_id')::uuid, snapshot_id = (d->>'snapshot_id')::uuid,
             purpose = d->>'purpose', waypoints = d->>'waypoints',
             specific_flight_types = coalesce(d->'specific_flight_types', '[]'::jsonb),
             takeoff_place = d->>'takeoff_place', takeoff_lat = (d->>'takeoff_lat')::numeric,
             takeoff_lng = (d->>'takeoff_lng')::numeric, takeoff_accuracy_m = (d->>'takeoff_accuracy_m')::integer,
             landing_place = d->>'landing_place', landing_lat = (d->>'landing_lat')::numeric,
             landing_lng = (d->>'landing_lng')::numeric, landing_accuracy_m = (d->>'landing_accuracy_m')::integer,
             takeoff_at = ops_jst_minute_to_timestamptz(d->>'takeoff_at'),
             landing_at = ops_jst_minute_to_timestamptz(d->>'landing_at'),
             flight_minutes = (d->>'flight_minutes')::integer, flight_date = (d->>'flight_date')::date,
             safety_issue = (d->>'safety_issue')::boolean, safety_issue_detail = d->>'safety_issue_detail',
             defects = coalesce(d->'defects', '[]'::jsonb),
             pilot_name = d->>'pilot_name', pilot_license_number = d->>'pilot_license_number',
             pilot_version = (d->>'pilot_version')::integer, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update flight_records set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

    -- 重なりの拒否：同じ機体、または同じ操縦者で、取消していない飛行記録どうしの〔離陸, 離陸＋飛行時間）が重なる。
    -- 接するだけ（前の着陸の分 = 次の離陸の分）は重ならない。取消した記録とは比べない。
    if new.op in ('create', 'update') then
      select f.takeoff_at, f.flight_minutes, f.aircraft_id, f.pilot_id into r from flight_records f where f.id = new.entity_id;
      select o.id into v_conflict
        from flight_records o
       where o.org_id = new.org_id
         and o.id <> new.entity_id
         and o.voided_at is null
         and (o.aircraft_id = r.aircraft_id or o.pilot_id = r.pilot_id)
         and o.takeoff_at < r.takeoff_at + make_interval(mins => r.flight_minutes)
         and r.takeoff_at < o.takeoff_at + make_interval(mins => o.flight_minutes)
       limit 1;
      if v_conflict is not null then
        raise exception 'flight records overlap' using errcode = 'SB409', detail = 'overlap';
      end if;
    end if;

  elsif new.entity_type = 'flight_plan' then
    if new.op in ('create', 'update') then
      -- 機体・操縦者・よく使う地点は同じ組織のものに限る。機体は訂正で変えられない
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
      if (d->>'saved_place_id') is not null and not exists (
        select 1 from saved_places where id = (d->>'saved_place_id')::uuid and org_id = new.org_id
      ) then
        raise exception 'saved place not found' using errcode = 'SB404';
      end if;
    end if;
    if new.op = 'create' then
      insert into flight_plans (id, org_id, title, aircraft_id, pilot_id, planned_start_at, duration_minutes, planned_date,
                                purpose, place_name, latitude, longitude, radius_m, saved_place_id, max_altitude_m,
                                flags, pilot_permits, judgement_purpose, access_control, third_party_overflight,
                                bvlos_with_observer, drone_weight_g, permit_numbers, notes, status, current_snapshot_id,
                                client_request_id, current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'title', (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              ops_jst_minute_to_timestamptz(d->>'planned_start_at'), (d->>'duration_minutes')::integer,
              (d->>'planned_date')::date, d->>'purpose', d->>'place_name', (d->>'latitude')::numeric,
              (d->>'longitude')::numeric, (d->>'radius_m')::integer, (d->>'saved_place_id')::uuid,
              (d->>'max_altitude_m')::integer, coalesce(d->'flags', '[]'::jsonb), coalesce(d->'pilot_permits', '[]'::jsonb),
              d->>'judgement_purpose', (d->>'access_control')::boolean, (d->>'third_party_overflight')::boolean,
              (d->>'bvlos_with_observer')::boolean, (d->>'drone_weight_g')::integer, d->>'permit_numbers', d->>'notes',
              d->>'status', (d->>'current_snapshot_id')::uuid, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from flight_plans where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update flight_plans
         set title = d->>'title', pilot_id = (d->>'pilot_id')::uuid,
             planned_start_at = ops_jst_minute_to_timestamptz(d->>'planned_start_at'),
             duration_minutes = (d->>'duration_minutes')::integer, planned_date = (d->>'planned_date')::date,
             purpose = d->>'purpose', place_name = d->>'place_name', latitude = (d->>'latitude')::numeric,
             longitude = (d->>'longitude')::numeric, radius_m = (d->>'radius_m')::integer,
             saved_place_id = (d->>'saved_place_id')::uuid, max_altitude_m = (d->>'max_altitude_m')::integer,
             flags = coalesce(d->'flags', '[]'::jsonb), pilot_permits = coalesce(d->'pilot_permits', '[]'::jsonb),
             judgement_purpose = d->>'judgement_purpose', access_control = (d->>'access_control')::boolean,
             third_party_overflight = (d->>'third_party_overflight')::boolean,
             bvlos_with_observer = (d->>'bvlos_with_observer')::boolean, drone_weight_g = (d->>'drone_weight_g')::integer,
             permit_numbers = d->>'permit_numbers', notes = d->>'notes', status = d->>'status',
             current_snapshot_id = (d->>'current_snapshot_id')::uuid, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update flight_plans set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'saved_place' then
    if new.op = 'create' then
      insert into saved_places (id, org_id, name, address_text, latitude, longitude, note,
                                current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'name', d->>'address_text', (d->>'latitude')::numeric,
              (d->>'longitude')::numeric, d->>'note', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update saved_places
         set name = d->>'name', address_text = d->>'address_text', latitude = (d->>'latitude')::numeric,
             longitude = (d->>'longitude')::numeric, note = d->>'note',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update saved_places set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;
  end if;
  return null;
end;
$$;

-- ---- 検証 ----------------------------------------------------

-- 0008 の verify_record_chain に、flight_plan・saved_place の表の対応を加える。
-- 予定開始（planned_start_at）は、版の data と同じ日本時間の `YYYY-MM-DDTHH:MM` にして比べる。
create or replace function verify_record_chain(p_entity_type text, p_entity_id uuid)
returns table (version_no integer, problem text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expected_no integer := 1;
  v_prev_hash text := '';
  v_last record;
  v_head jsonb;
  v_table text;
  v_key text;
  v_found boolean := false;
begin
  for r in
    select * from record_versions v
     where v.entity_type = p_entity_type and v.entity_id = p_entity_id
     order by v.version_no
  loop
    if r.version_no <> v_expected_no then
      version_no := r.version_no; problem := 'missing_version'; return next;
    end if;
    if r.prev_hash <> v_prev_hash then
      version_no := r.version_no; problem := 'prev_hash_mismatch'; return next;
    end if;
    if r.content_hash <> record_version_hash(r.prev_hash, r.entity_type, r.entity_id, r.version_no, r.op, r.data,
                                             r.reason, r.actor_kind, r.actor_member_id, r.created_at) then
      version_no := r.version_no; problem := 'content_hash_mismatch'; return next;
    end if;
    v_expected_no := r.version_no + 1;
    v_prev_hash := r.content_hash;
    v_last := r;
    v_found := true;
  end loop;

  v_table := case p_entity_type
               when 'member' then 'members'
               when 'aircraft' then 'aircraft'
               when 'pilot' then 'pilots'
               when 'daily_inspection' then 'daily_inspections'
               when 'flight_record' then 'flight_records'
               when 'flight_plan' then 'flight_plans'
               when 'saved_place' then 'saved_places'
             end;
  if v_table is null then
    return;
  end if;
  if p_entity_type = 'flight_record' then
    select to_jsonb(t) || jsonb_build_object('takeoff_at', ops_timestamptz_to_jst_minute(t.takeoff_at),
                                             'landing_at', ops_timestamptz_to_jst_minute(t.landing_at))
      into v_head from flight_records t where t.id = p_entity_id;
  elsif p_entity_type = 'flight_plan' then
    select to_jsonb(t) || jsonb_build_object('planned_start_at', ops_timestamptz_to_jst_minute(t.planned_start_at))
      into v_head from flight_plans t where t.id = p_entity_id;
  elsif p_entity_type = 'daily_inspection' then
    select to_jsonb(t) || jsonb_build_object('inspected_at', ops_timestamptz_to_jst_minute(t.inspected_at))
      into v_head from daily_inspections t where t.id = p_entity_id;
  else
    execute format('select to_jsonb(t) from %I t where t.id = $1', v_table) into v_head using p_entity_id;
  end if;

  if not v_found then
    if v_head is not null then
      version_no := 0; problem := 'head_without_versions'; return next;
    end if;
    return;
  end if;
  if v_head is null then
    version_no := v_last.version_no; problem := 'head_missing'; return next;
    return;
  end if;
  if (v_head->>'current_version')::integer is distinct from v_last.version_no then
    version_no := v_last.version_no; problem := 'head_version_mismatch'; return next;
  end if;
  for v_key in select jsonb_object_keys(v_last.data) loop
    if v_head ? v_key and (v_head->v_key) is distinct from (v_last.data->v_key) then
      version_no := v_last.version_no; problem := 'head_data_mismatch'; return next;
      exit;
    end if;
  end loop;
  if (v_last.op = 'void') is distinct from (v_head->>'voided_at' is not null) then
    version_no := v_last.version_no; problem := 'head_void_mismatch'; return next;
  end if;
end;
$$;

revoke execute on function verify_record_chain(text, uuid) from public;

-- ---- 運航管理者の確認（追記専用） ----------------------------

create table plan_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  -- 確認した計画の版と、その版のスナップショット
  plan_version integer not null check (plan_version >= 1),
  snapshot_id uuid not null,
  decision text not null check (decision in ('approved', 'returned')),
  reason text check (reason is null or length(reason) <= 500),
  confirmer_member_id uuid not null references members(id),
  -- その時点の表示名の写し（追加前のトリガーが利用者の行から写す）
  confirmer_name text not null check (length(btrim(confirmer_name)) between 1 and 100),
  -- DB が決める：確認者が、その版を保存した利用者である、または計画の操縦者に結び付いた利用者である
  self_confirmation boolean not null,
  created_at timestamptz not null,
  content_hash text not null,
  check (decision = 'approved' or (reason is not null and length(btrim(reason)) > 0)),
  foreign key (plan_id, org_id) references flight_plans (id, org_id),
  foreign key (snapshot_id, plan_id, org_id) references judgement_snapshots (id, plan_id, org_id)
);

create index idx_plan_confirmations_plan on plan_confirmations (org_id, plan_id, created_at);

comment on table plan_confirmations is
  '運航管理者の確認・差し戻し（Sprint 12a）。追記専用。self_confirmation・confirmer_name・created_at・content_hash は追加前のトリガーが決める。';

create trigger plan_confirmations_no_update_delete
  before update or delete on plan_confirmations
  for each row execute function reject_append_only_change();

create trigger plan_confirmations_no_truncate
  before truncate on plan_confirmations
  for each statement execute function reject_append_only_change();

-- 確認の内容のハッシュ（soraban-confirmation-v1）。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function plan_confirmation_hash(
  p_id uuid,
  p_org_id uuid,
  p_plan_id uuid,
  p_plan_version integer,
  p_snapshot_id uuid,
  p_decision text,
  p_reason text,
  p_confirmer_member_id uuid,
  p_confirmer_name text,
  p_self_confirmation boolean,
  p_created_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-confirmation-v1',
        p_id::text,
        p_org_id::text,
        p_plan_id::text,
        p_plan_version,
        p_snapshot_id::text,
        p_decision,
        p_reason,
        p_confirmer_member_id::text,
        p_confirmer_name,
        p_self_confirmation,
        to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- 追加前のトリガー：計画の状態と版を検証し、self_confirmation 等を決める（アプリが送った値は使わない）。
--   SB404 計画・確認者が同じ組織にない
--   SB409 voided（取消した計画）／not_requested（draft で確認が依頼されていない）／version_conflict（最新でない版）／
--         snapshot_mismatch（その版の current_snapshot_id と違う）／not_manager（運航管理者でない確認者）
create or replace function plan_confirmations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p flight_plans%rowtype;
  m members%rowtype;
  v_snapshot text;
  v_saved_by uuid;
  v_pilot_member uuid;
begin
  -- 計画の版の追加と直列化する（最新の版の判定が、同時の訂正とずれないように）
  perform pg_advisory_xact_lock(hashtextextended('record_versions:flight_plan:' || new.plan_id::text, 0));

  select * into p from flight_plans where id = new.plan_id and org_id = new.org_id;
  if not found then
    raise exception 'plan not found' using errcode = 'SB404';
  end if;
  select * into m from members where id = new.confirmer_member_id and org_id = new.org_id;
  if not found then
    raise exception 'member not found' using errcode = 'SB404';
  end if;
  if p.voided_at is not null then
    raise exception 'plan is voided' using errcode = 'SB409', detail = 'voided';
  end if;
  if m.role <> 'manager' or m.status <> 'active' or m.voided_at is not null then
    raise exception 'confirmer is not a manager' using errcode = 'SB409', detail = 'not_manager';
  end if;
  if p.status <> 'active' then
    raise exception 'confirmation is not requested' using errcode = 'SB409', detail = 'not_requested';
  end if;
  if new.plan_version <> p.current_version then
    raise exception 'version conflict' using errcode = 'SB409', detail = 'version_conflict';
  end if;

  select v.data->>'current_snapshot_id', v.actor_member_id
    into v_snapshot, v_saved_by
    from record_versions v
   where v.entity_type = 'flight_plan' and v.entity_id = new.plan_id and v.version_no = new.plan_version;
  if v_snapshot is distinct from new.snapshot_id::text then
    raise exception 'snapshot mismatch' using errcode = 'SB409', detail = 'snapshot_mismatch';
  end if;

  select member_id into v_pilot_member from pilots where id = p.pilot_id;
  new.self_confirmation := (v_saved_by is not null and v_saved_by = new.confirmer_member_id)
                           or (v_pilot_member is not null and v_pilot_member = new.confirmer_member_id);
  new.confirmer_name := m.display_name;
  new.created_at := clock_timestamp();
  new.content_hash := plan_confirmation_hash(
    new.id, new.org_id, new.plan_id, new.plan_version, new.snapshot_id, new.decision, new.reason,
    new.confirmer_member_id, new.confirmer_name, new.self_confirmation, new.created_at
  );
  return new;
end;
$$;

create trigger plan_confirmations_before_insert
  before insert on plan_confirmations
  for each row execute function plan_confirmations_before_insert();

-- ---- アプリ用ロールの権限 -----------------------------------
-- plan_confirmations は参照と追加だけ。更新・削除・TRUNCATE は与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select, insert on plan_confirmations to soraban_app;
    revoke update, delete, truncate on plan_confirmations from soraban_app;
  end if;
end
$$;
