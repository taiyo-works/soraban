// 「近づく期限」（ホーム。Sprint 12g-1b 設計 §5）。純粋関数。DB・時計・ネットワークに触れない。
//   技能証明の有効期限（pilots.license_expires_on）と、許可・承認の有効な最終日（permit_registrations.valid_to と失効日）から、
//   期限が窓の日数以内のものを、期限が近い順（過ぎたものが先頭）に返す。機体の期限は記録する場所が無いため扱わない（12f 以降）。
//
// 12f（期限一覧）が全件・機体の期限を足すときに再利用できるよう、窓の日数と件数は引数にする。
//
// 守ること：
//   - 技能証明書の番号は出力に含めない（名前と期限だけ）。
//   - 取消済みの操縦者・許可・承認、失効・取消済みの許可・承認は出さない。期限が未入力（null）の技能証明は出さない。
//   - 状態の語は既存の licenseRenewalStatus（更新の受付期間・期限を過ぎた・期限切れ）に合わせる。
import { daysBetween } from "./today-logic";
import { licenseRenewalStatus, type LicenseRenewalStatus } from "./license";
import { effectiveLastDate, type PermitRegistration } from "./permit-logic";

/** 窓の日数（ホーム）。12c の「技能証明を更新する」（次にやること）の 60 日と揃える。 */
export const DEADLINE_WINDOW_DAYS = 60;
/** ホームに出す件数の上限。 */
export const DEADLINE_LIMIT = 5;
/** 期限を過ぎた許可・承認を出す日数（これより前に切れたものは、登録の画面で見る。古い登録が先頭を占めないように）。 */
export const PERMIT_OVERDUE_SHOW_DAYS = 30;

export type DeadlinePilotInput = {
  readonly id: string;
  readonly name: string;
  /** 有効期限（YYYY-MM-DD）。未入力は null。 */
  readonly licenseExpiresOn: string | null;
  readonly voided: boolean;
};

export type DeadlinePermitInput = Pick<PermitRegistration, "id" | "permitNumber" | "validTo" | "revokedOn" | "status" | "voided" | "coverage">;

export type DeadlineKind = "license" | "permit";

export type DeadlineDto = {
  readonly kind: DeadlineKind;
  readonly id: string;
  /** 種別の語（「技能証明」「許可・承認」）。 */
  readonly what: string;
  /** 対象（操縦者の氏名、許可・承認の番号）。 */
  readonly subject: string;
  /** 期限の日付（YYYY-MM-DD）。許可・承認は有効な最終日。 */
  readonly date: string;
  /** 今日から期限までの日数。期限日の当日は 0、過ぎていれば負。 */
  readonly daysLeft: number;
  readonly overdue: boolean;
  /** 「あと N 日」「今日まで」「N 日過ぎ」。 */
  readonly leftLabel: string;
  /** 技能証明の状態の語（既存の licenseRenewalStatus）。許可・承認は null。 */
  readonly licenseStatus: Exclude<LicenseRenewalStatus, "none"> | null;
  readonly href: string;
};

export const LICENSE_STATUS_LABEL: Readonly<Record<Exclude<LicenseRenewalStatus, "none">, string>> = {
  renewal_window: "更新の申請期間",
  past_deadline: "更新の申請期限を過ぎています",
  expired: "有効期限切れ",
};

export const leftLabelOf = (daysLeft: number): string =>
  daysLeft > 0 ? `あと ${daysLeft} 日` : daysLeft === 0 ? "今日まで" : `${-daysLeft} 日過ぎ`;

export const deadlines = (i: {
  readonly today: string;
  readonly pilots: readonly DeadlinePilotInput[];
  readonly permits: readonly DeadlinePermitInput[];
  readonly windowDays?: number;
  readonly limit?: number;
}): DeadlineDto[] => {
  const windowDays = i.windowDays ?? DEADLINE_WINDOW_DAYS;
  const limit = i.limit ?? DEADLINE_LIMIT;
  const out: DeadlineDto[] = [];

  for (const p of i.pilots) {
    if (p.voided || !p.licenseExpiresOn) continue;
    const daysLeft = daysBetween(i.today, p.licenseExpiresOn);
    if (daysLeft > windowDays) continue;
    const status = licenseRenewalStatus(p.licenseExpiresOn, i.today);
    out.push({
      kind: "license",
      id: p.id,
      what: "技能証明",
      subject: p.name,
      date: p.licenseExpiresOn,
      daysLeft,
      overdue: daysLeft < 0,
      leftLabel: leftLabelOf(daysLeft),
      licenseStatus: status === "none" ? null : status,
      href: `/ops/pilots/${p.id}`,
    });
  }

  for (const r of i.permits) {
    if (r.voided || r.status === "revoked") continue;
    const date = effectiveLastDate(r);
    const daysLeft = daysBetween(i.today, date);
    if (daysLeft > windowDays || daysLeft < -PERMIT_OVERDUE_SHOW_DAYS) continue;
    out.push({
      kind: "permit",
      id: r.id,
      what: "許可・承認",
      subject: r.permitNumber,
      date,
      daysLeft,
      overdue: daysLeft < 0,
      leftLabel: leftLabelOf(daysLeft),
      licenseStatus: null,
      href: `/ops/permits/${r.id}`,
    });
  }

  // 期限の近い順（過ぎたものが先頭）。同じ日は種別、対象の名前、ID の順で決める
  out.sort((a, b) => a.daysLeft - b.daysLeft || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) || (a.id < b.id ? -1 : 1));
  return out.slice(0, limit);
};
