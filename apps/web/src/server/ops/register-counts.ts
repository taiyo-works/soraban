// 登録の画面（/ops/more）に添える件数。取消していないものの数だけを 1 回の問い合わせで読む（閲覧は全役割。authz.ts の
// aircraft.read・pilot.read・permit.read・place.read）。個人の情報は読まない。
import { assertCan, type OpsContext } from "./service";

export type RegisterCounts = { readonly aircraft: number; readonly pilots: number; readonly permits: number; readonly places: number };

export const getRegisterCounts = async (ctx: OpsContext): Promise<RegisterCounts> => {
  assertCan(ctx, "aircraft.read");
  assertCan(ctx, "pilot.read");
  assertCan(ctx, "permit.read");
  assertCan(ctx, "place.read");
  const org = ctx.member.org_id;
  const r = await ctx.db.query<{ aircraft: string; pilots: string; permits: string; places: string }>(
    `select (select count(*) from aircraft where org_id = $1 and voided_at is null) as aircraft,
            (select count(*) from pilots where org_id = $1 and voided_at is null) as pilots,
            (select count(*) from permit_registrations where org_id = $1 and voided_at is null) as permits,
            (select count(*) from saved_places where org_id = $1 and voided_at is null) as places`,
    [org],
  );
  const row = r.rows[0]!;
  return { aircraft: Number(row.aircraft), pilots: Number(row.pilots), permits: Number(row.permits), places: Number(row.places) };
};
