// 提供元の表記（Sprint 18-3 §5.1）。**画面・PDF・マニフェスト・題名に出す提供元の値は、このファイルだけに書く**（直書きしない。単体テストが apps/web/src を検索する）。
//
// 値は docs/provider-info.md の表の「確認済みの 6 項目」だけ（ユーザーの入力、2026-10-31）。創作しない。
// **載せない（未確認。確認が取れるまで空欄・「準備中」・仮の値も出さない）**:
//   受付の曜日・祝日の扱い（9:00〜17:00 のみ提供）、ロゴ（使用ルールが未確認のため画面に使わない）、
//   適格請求書発行事業者番号、法人番号・設立年月日、コーポレートカラーの公式の色コード。
// このため、キーにも未確認の項目を持たない（provider-info.test.ts が docs/provider-info.md の表と突き合わせる）。

export const PROVIDER = {
  /** 正式名称 */
  name: "フューチャーテック株式会社",
  /** 郵便番号（「〒」は表示のときに付ける） */
  postalCode: "689-3553",
  /** 所在地 */
  address: "鳥取県西伯郡日吉津村大字日吉津 45番地3",
  /** 電話番号 */
  phone: "0859-27-1227",
  /** 代表者 */
  representative: "代表取締役 長谷岡 千春",
  /** 問い合わせメール */
  email: "info@futuretec-jp.com",
  /** 受付時間（曜日・祝日は載せない。未確認） */
  hours: "9:00〜17:00",
} as const;

export type ProviderKey = keyof typeof PROVIDER;

/** 表示の行。ラベルは docs/provider-info.md の項目名に合わせる。順序は 名称・代表者・所在地・電話・メール・受付時間。 */
export const PROVIDER_ROWS: readonly { readonly key: ProviderKey | "location"; readonly label: string; readonly value: string; readonly testId: string }[] = [
  { key: "name", label: "提供元", value: PROVIDER.name, testId: "provider-name" },
  { key: "representative", label: "代表者", value: PROVIDER.representative, testId: "provider-representative" },
  { key: "location", label: "所在地", value: `〒${PROVIDER.postalCode} ${PROVIDER.address}`, testId: "provider-address" },
  { key: "phone", label: "電話", value: PROVIDER.phone, testId: "provider-phone" },
  { key: "email", label: "メール", value: PROVIDER.email, testId: "provider-email" },
  { key: "hours", label: "受付時間", value: PROVIDER.hours, testId: "provider-hours" },
];
