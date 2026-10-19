/*
 * トップの見出しの右に置く、一般化したクアッドコプターの線画（真上から見た平面図）。
 *
 * 外部の画像・製品図を参照せず、このファイル内の幾何図形（circle・line・rect・g）だけで描いたオリジナルの図。
 * 市販機の写真や他社の図をなぞっていない。形は docs/sprints/sprint-11b.md の A3 の仕様から起こした。
 *
 * 図の構成（viewBox 0 0 240 240、中心 (120, 120)、上下・左右に対称）：
 * - 胴体：中心に角を丸めた正方形（rect、一辺 44、角の丸み 10）。
 * - 基準線：胴体の中心に短い十字（line 2 本）。
 * - 腕：胴体から対角の 4 方向へ伸びる、長さの等しいまっすぐな線（line 4 本。胴体の角の手前から、(66,66)・(174,66)・(66,174)・(174,174) にあるモーターの縁まで）。
 * - モーター：各腕の先の小円（circle 半径 7、4 個）。
 * - ロータの回転域：各モーターを中心とする点線の円（circle 半径 36、4 個）。羽根の形は描かない。
 *
 * 置かないもの：カメラ・ジンバル・ヒンジ・面取り・着陸脚・LED・ロゴ・文字。
 * 線は currentColor の単色で、色は親要素のテキスト色（トークン）で決める。塗りはしない。
 * 線の太さは vector-effect="non-scaling-stroke" で表示サイズに関わらず 1px にする。
 * 状態・効果・アニメーションを持たないサーバーコンポーネント。
 */

const C = 120; // 中心
const R = 54; // 中心から各モーターまでの、軸方向のずれ（4 本とも同じ）
const MOTORS: ReadonlyArray<readonly [number, number]> = [
  [C - R, C - R],
  [C + R, C - R],
  [C - R, C + R],
  [C + R, C + R],
];

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
      {/* ロータの回転域（点線） */}
      <g strokeDasharray="2 4">
        {MOTORS.map(([x, y]) => (
          <circle key={`rotor-${x}-${y}`} cx={x} cy={y} r={36} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* 腕（胴体の角から各モーターの縁まで） */}
      <g>
        {MOTORS.map(([x, y]) => {
          const sx = Math.sign(x - C);
          const sy = Math.sign(y - C);
          return (
            <line
              key={`arm-${x}-${y}`}
              x1={C + sx * 18}
              y1={C + sy * 18}
              x2={x - sx * 5}
              y2={y - sy * 5}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {/* モーター */}
      <g>
        {MOTORS.map(([x, y]) => (
          <circle key={`motor-${x}-${y}`} cx={x} cy={y} r={7} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* 胴体と中心の基準線 */}
      <rect x={98} y={98} width={44} height={44} rx={10} vectorEffect="non-scaling-stroke" />
      <line x1={114} y1={120} x2={126} y2={120} vectorEffect="non-scaling-stroke" />
      <line x1={120} y1={114} x2={120} y2={126} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
