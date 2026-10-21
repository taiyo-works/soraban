// 通報の期限の目安と罰則の注記（データ。Sprint 12b 設計 E）。data/report-policy.json を読む。
// 目安の時刻（飛行開始の何時間前か）は組織ごとの設定にせず、固定の値をデータで持つ（数値の更新はデータだけで行う）。
import policyJson from "../data/report-policy.json";

export type ReportPolicy = {
  readonly revision: number;
  readonly verifiedAt: string;
  /** 社内の目安：飛行開始の何時間前までに通報するか。法定の期限ではない。 */
  readonly guideLeadHours: number;
  readonly guideNote: string;
  readonly penalty: {
    readonly lawName: string;
    readonly article: string;
    readonly uncheckedNote: string;
    readonly note: string;
  };
  readonly outageNote: string;
  readonly smallDroneLawNote: string;
  readonly sources: readonly { readonly title: string; readonly url: string; readonly status: string; readonly note: string }[];
};

export const REPORT_POLICY: ReportPolicy = policyJson as unknown as ReportPolicy;
