/*
 * トップの見出しの右に置く、一般化したクアッドコプターの線画（真上から見た平面図）。
 *
 * 外部の画像・製品図を参照せず、このファイル内の幾何図形（circle・line・rect・g）だけで描いたオリジナルの図。
 * 市販機の写真や他社の図をなぞっていない。形は docs/sprints/sprint-11b.md の A3 の仕様から起こした。
 *
 * 図の構成（viewBox 0 0 240 240、中心 (120, 120)、上下・左右に対称）：
 * - 中心線：図の中心を通る水平・垂直の一点鎖線（line 4 本）。製図の中心線として、胴体の内側では切り、他の線より薄くする。
 * - 胴体：中心に角を少し丸めた正方形（rect、一辺 40、角の丸み 6）。中は描き込まない。
 * - 腕：胴体の角から対角の 4 方向へ伸びる、長さの等しいまっすぐな腕。幅のある部材として平行な 2 本の線で描く
 *   （line 8 本。胴体の角の丸みから、(66,66)・(174,66)・(66,174)・(174,174) にあるモーターの縁まで）。
 * - モーター：各腕の先の小円（circle 半径 8）と、その中心の軸（circle 半径 2）。
 * - ロータの回転域：各モーターを中心とする点線の円（circle 半径 40、4 個）。羽根の形は描かない。
 *
 * 置かないもの：カメラ・ジンバル・ヒンジ・面取り・着陸脚・LED・ロゴ・文字。
 * 線は currentColor の単色で、色は親要素のテキスト色（トークン）で決める。塗りはしない。
 * 線の太さは vector-effect="non-scaling-stroke" で表示サイズに関わらず 1px にする。
 * 状態・効果・アニメーションを持たないサーバーコンポーネント。
 */

const C = 120; // 中心
const R = 54; // 中心から各モーターまでの、軸方向のずれ（4 本とも同じ）
const BODY = 20; // 胴体の一辺の半分
const BODY_RX = 6; // 胴体の角の丸み
const MOTOR_R = 8; // モーターの半径
const ROTOR_R = 40; // ロータの回転域の半径
const ARM_W = 2.5; // 腕の中心線から、腕の 2 本の線までの距離
const CENTERLINE_GAP = BODY + 4; // 中心線を切る範囲（胴体の内側）
const CENTERLINE_END = 104; // 中心線の端（中心からの距離。回転域の円の少し外まで）

const S2 = Math.SQRT2;
const B = ARM_W / S2;
// 腕の線の始点：腕の線が胴体の角の丸み（中心 BODY-BODY_RX、半径 BODY_RX の円弧）と交わる位置（腕の方向の距離）。
const ARM_START = (BODY - BODY_RX + Math.sqrt(BODY_RX * BODY_RX / 2 - B * B)) * S2;
// 腕の線の終点：腕の線がモーターの円と交わる位置。
const ARM_END = R * S2 - Math.sqrt(MOTOR_R * MOTOR_R - ARM_W * ARM_W);

const MOTORS: ReadonlyArray<readonly [number, number]> = [
  [C - R, C - R],
  [C + R, C - R],
  [C - R, C + R],
  [C + R, C + R],
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function HeroLineArt({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 240 240"
      width={240}
      height={240}
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
    >
      {/* 中心線（一点鎖線。胴体の内側では切る） */}
      <g strokeDasharray="8 3 1 3" strokeLinecap="butt" strokeOpacity={0.7}>
        <line x1={C - CENTERLINE_END} y1={C} x2={C - CENTERLINE_GAP} y2={C} vectorEffect="non-scaling-stroke" />
        <line x1={C + CENTERLINE_END} y1={C} x2={C + CENTERLINE_GAP} y2={C} vectorEffect="non-scaling-stroke" />
        <line x1={C} y1={C - CENTERLINE_END} x2={C} y2={C - CENTERLINE_GAP} vectorEffect="non-scaling-stroke" />
        <line x1={C} y1={C + CENTERLINE_END} x2={C} y2={C + CENTERLINE_GAP} vectorEffect="non-scaling-stroke" />
      </g>

      {/* ロータの回転域（点線） */}
      <g strokeDasharray="1 4">
        {MOTORS.map(([x, y]) => (
          <circle key={`rotor-${x}-${y}`} cx={x} cy={y} r={ROTOR_R} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* 腕（平行な 2 本の線。胴体の角の丸みから各モーターの縁まで） */}
      <g>
        {MOTORS.flatMap(([x, y]) => {
          const ux = Math.sign(x - C) / S2;
          const uy = Math.sign(y - C) / S2;
          return [-1, 1].map((side) => {
            const px = -uy * ARM_W * side;
            const py = ux * ARM_W * side;
            return (
              <line
                key={`arm-${x}-${y}-${side}`}
                x1={r2(C + ux * ARM_START + px)}
                y1={r2(C + uy * ARM_START + py)}
                x2={r2(C + ux * ARM_END + px)}
                y2={r2(C + uy * ARM_END + py)}
                vectorEffect="non-scaling-stroke"
              />
            );
          });
        })}
      </g>

      {/* モーターと軸 */}
      <g>
        {MOTORS.flatMap(([x, y]) => [
          <circle key={`motor-${x}-${y}`} cx={x} cy={y} r={MOTOR_R} vectorEffect="non-scaling-stroke" />,
          <circle key={`shaft-${x}-${y}`} cx={x} cy={y} r={2} vectorEffect="non-scaling-stroke" />,
        ])}
      </g>

      {/* 胴体 */}
      <rect
        x={C - BODY}
        y={C - BODY}
        width={BODY * 2}
        height={BODY * 2}
        rx={BODY_RX}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
