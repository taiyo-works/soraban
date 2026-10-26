// 現在地の取得（Sprint 9 C・E）。
//
// - ボタンを押したときだけ getCurrentPosition を 1 回呼ぶ（高精度・タイムアウト 10 秒・キャッシュ不使用）。
//   watchPosition（追跡）は使わない。失敗しても自動で再試行しない。
// - 取得した位置と精度は呼び出し元の state（画面の表示）にだけ渡し、ここでは保存も送信もしない。

export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};

/** 精度がこの値（m）を超えたら低精度の注意を出す。 */
export const LOW_ACCURACY_THRESHOLD_M = 100;

export const LOW_ACCURACY_MESSAGE =
  "位置の精度が低い。地図で位置を確かめ、長押し（右クリック）で直してください";

export const CURRENT_LOCATION_PRIVACY_NOTE =
  "現在地はこの端末の中で地図の表示に使います。『この地点で判定』を押したときだけ、判定のために座標を送ります";

/**
 * 判定画面 `/` の現在地の説明（押したらすぐ判定する挙動）。計画の作成画面（/ops）は「この地点を使う」の流れなので、
 * そちらは上の CURRENT_LOCATION_PRIVACY_NOTE のまま使う（文が食い違わないように別の定数にしている）。
 */
export const CURRENT_LOCATION_JUDGE_NOTE =
  "現在地は、「現在地で判定」を押したときに 1 回だけ取得し、判定には緯度・経度（小数 6 桁）だけを送ります（精度は表示だけ）。精度が 100 m を超えるときは、確認してから判定します";

const FALLBACK_GUIDE = "住所検索・地図の長押し（右クリック）で指定してください";

// GeolocationPositionError のコード（1: PERMISSION_DENIED, 2: POSITION_UNAVAILABLE, 3: TIMEOUT）
export const GEO_PERMISSION_DENIED = 1;
export const GEO_POSITION_UNAVAILABLE = 2;
export const GEO_TIMEOUT = 3;

export const geolocationErrorMessage = (code: number): string => {
  switch (code) {
    case GEO_PERMISSION_DENIED:
      return "位置情報の利用が許可されていません。ブラウザの設定で許可するか、住所検索・地図の長押しで指定してください";
    case GEO_POSITION_UNAVAILABLE:
      return `現在地を取得できませんでした（端末が位置を特定できない状態です）。${FALLBACK_GUIDE}`;
    case GEO_TIMEOUT:
      return `現在地の取得が時間切れになりました（10 秒以内に位置が得られませんでした）。${FALLBACK_GUIDE}`;
    default:
      return `現在地を取得できませんでした。${FALLBACK_GUIDE}`;
  }
};

export const isLowAccuracy = (accuracyM: number): boolean => accuracyM > LOW_ACCURACY_THRESHOLD_M;

/** 「現在地（精度 約 N m）」の N（m 単位で丸める）。 */
export const formatAccuracy = (accuracyM: number): string =>
  `現在地（精度 約 ${Math.max(1, Math.round(accuracyM))} m）`;

export type GeolocationAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export const geolocationAvailability = (env: {
  readonly geolocation?: unknown;
  readonly isSecureContext?: boolean;
}): GeolocationAvailability => {
  if (!env.geolocation) {
    return { available: false, reason: "このブラウザでは位置情報を使えません。住所検索・地図の長押しで指定してください" };
  }
  if (env.isSecureContext === false) {
    return { available: false, reason: "HTTPS でない接続では位置情報を使えません。住所検索・地図の長押しで指定してください" };
  }
  return { available: true };
};

export type CurrentLocationCandidate = {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
};

export type CurrentLocationOutcome =
  | { readonly ok: true; readonly candidate: CurrentLocationCandidate }
  | { readonly ok: false; readonly code: number; readonly message: string };

/** 現在地を 1 回だけ取得する。再試行・追跡はしない。 */
export const requestCurrentLocation = (
  geolocation: Pick<Geolocation, "getCurrentPosition">,
): Promise<CurrentLocationOutcome> =>
  new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          candidate: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          },
        }),
      (err) => resolve({ ok: false, code: err.code, message: geolocationErrorMessage(err.code) }),
      GEOLOCATION_OPTIONS,
    );
  });

/** 「この地点で判定」で判定に渡す地点（小数 6 桁に丸めた緯度経度だけ。精度・取得時刻は渡さない）。 */
export const candidateToLocation = (c: CurrentLocationCandidate): { lat: number; lng: number } => ({
  lat: Number(c.lat.toFixed(6)),
  lng: Number(c.lng.toFixed(6)),
});
