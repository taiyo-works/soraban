import { Badge } from "@/components/ops/ui";
import {
  LICENSE_RENEWAL_LABEL,
  licenseRenewalStatus,
} from "@/server/ops/license";

/**
 * 技能証明の有効期限の注意（Sprint 11a E）。状態が none のとき・取消済みの操縦者には何も出さない。
 * 今日の日付（JST）は呼び出し側（サーバーの画面）で求めて渡す。
 */
export function LicenseRenewalNotice({
  expiresOn,
  today,
  voided,
}: {
  readonly expiresOn: string | null;
  readonly today: string;
  readonly voided: boolean;
}) {
  if (voided) return null;
  const status = licenseRenewalStatus(expiresOn, today);
  if (status === "none") return null;
  return (
    <Badge tone={status === "renewal_window" ? "amber" : "red"} data-testid="license-renewal-status">
      {LICENSE_RENEWAL_LABEL[status]}
    </Badge>
  );
}
