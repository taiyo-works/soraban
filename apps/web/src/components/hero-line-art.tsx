/*
 * トップの見出しの右に置く、ドローンの線画（apps/web/public/hero-drone.png）。
 *
 * 出所：
 * - ユーザー（フューチャーテック株式会社）が Adobe Firefly（商用利用可の条件）で生成した画像。生成日 2026-10-20。
 * - 加工：白地をアルファに変換した（線の濃さを不透明度に移した）だけ。縮小もしておらず（1904×1232 のまま）、
 *   図の形は変えていない。白地の元画像はリポジトリに入れていない。
 * - 図の中にロゴ・文字・型番・数字・透かしを含まない。
 * - 外形が特定の機種（DJI の業務用機、Matrice 30／4 系）に似ていることを、ユーザーが説明を受けて承知のうえで採用した
 *   （docs/sprints/sprint-11b.md の「改訂の記録」を参照）。
 *
 * 表示：
 * - next/image で表示する。width・height に画像の実寸を書き、CSS の w-full・h-auto と合わせて読み込み前に大きさを確定させる
 *   （レイアウトのずれを出さない）。
 * - 装飾なので alt は空。読み込みは既定の lazy のままとし、先読みや高い取得優先度は付けない（LCP の要素にしない。
 *   lg 未満で親が display: none の間は読み込まれない）。
 * - unoptimized：この環境では画像最適化に使うライブラリを依存に入れていないため、PNG（約 220KB）をそのまま配信する。
 * - 色：元の線は黒。不透明度は親要素で決め、ダークモードでは反転（dark:invert）して明るい線にする。
 * 状態・効果・アニメーションを持たないサーバーコンポーネント。
 */
import Image from "next/image";

const WIDTH = 1904;
const HEIGHT = 1232;

export function HeroLineArt({ className }: { readonly className?: string }) {
  return (
    <Image
      src="/hero-drone.png"
      width={WIDTH}
      height={HEIGHT}
      alt=""
      sizes="(min-width: 1024px) 14.5rem, 0px"
      unoptimized
      draggable={false}
      data-testid="hero-line-art-image"
      className={className}
    />
  );
}
