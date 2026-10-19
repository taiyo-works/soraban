import { Badge, type Tone } from "@/components/ops/ui";
import {
  licenseRenewalStatus,
  subtractCalendarMonths,
  type LicenseRenewalStatus,
} from "@/server/ops/license";

/**
 * 技能証明の有効期限の注意（Sprint 11a E）。状態が none のとき・取消済みの操縦者には何も出さない。
 * 今日の日付（JST）は呼び出し側（サーバーの画面）で求めて渡す。
 *
 * 見た目は運航管理（Sprint 10）の札（Badge）に揃える。段階は札の文字で示し、色は補助にとどめる。
 *   一覧（compact）… 札だけ（「更新の申請期間」「更新の期限を過ぎています」「有効期限切れ」）
 *   詳細           … 札＋期限の日付を入れた一文
 */
type Stage = Exclude<LicenseRenewalStatus, "none">;

const STAGE_TONE: Readonly<Record<Stage, Tone>> = {
  renewal_window: "amber",
  past_deadline: "red",
  expired: "red",
};

const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  renewal_window: "更新の申請期間",
  past_deadline: "更新の期限を過ぎています",
  expired: "有効期限切れ",
};

const stageDetail = (stage: Stage, expiresOn: string): string => {
  const deadline = subtractCalendarMonths(expiresOn, 1) ?? "";
  if (stage === "renewal_window") {
    return `満了の 1 か月前（${deadline}）までに、更新講習と身体適性検査を含めて更新の手続きを終える必要があります。`;
  }
  if (stage === "past_deadline") {
    return `更新の申請期間（満了の 1 か月前、${deadline} まで）を過ぎています。`;
  }
  return `有効期限（${expiresOn}）が切れています。`;
};

export function LicenseRenewalNotice({
  expiresOn,
  today,
  voided,
  compact = false,
}: {
  readonly expiresOn: string | null;
  readonly today: string;
  readonly voided: boolean;
  /** 一覧の行では札だけを出す */
  readonly compact?: boolean;
}) {
  if (voided || !expiresOn) return null;
  const status = licenseRenewalStatus(expiresOn, today);
  if (status === "none") return null;
  if (compact) {
    return (
      <Badge tone={STAGE_TONE[status]} data-testid="license-renewal-status">
        {STAGE_LABEL[status]}
      </Badge>
    );
  }
  return (
    <span data-testid="license-renewal-status" className="flex flex-col items-start gap-1">
      <Badge tone={STAGE_TONE[status]}>{STAGE_LABEL[status]}</Badge>
      <span className="text-xs leading-relaxed text-ink-soft">{stageDetail(status, expiresOn)}</span>
    </span>
  );
}
