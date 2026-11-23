# Sprint 16-C C-5：`bg-sb-surface`（66 か所）の見直しの一覧

作成: generator（2026-11-23）。基準: 16-C の着手時（`101dfe1`）。数え方: `bg-sb-surface` を使う TSX の行 52 ＋ `var(--sb-surface)` を使う CSS の行 14（`soraban-theme.css` の定義 1 を含む）＝ 66。

## 判断の基準

16-A で `--sb-base` はページの地（薄いグレー `#F6F7F9`）、`--sb-surface` は白い面に意味が入れ替わった。以前の `surface` は「地より少し灰色の面」だったので、次の 3 通りに分けた。

- **替える（くぼみ `--sb-sunken`）**: 白いカード・白い地の中に置く、枠のない入れ子の箱・注記・引用の箱・表の見出し・ホバーの面。白のままだと箱が消える、またはホバーが白→白になる。
- **残す（白い面）**: 縁（border）で形を示す小さな札・タグ・チップ、通知の箱（縁が墨や状態色）、`/` の挿絵の帯。白いカードの上でも縁で見える。文字色は状態色で、白の上が最も比が高い。
- 同時に、カード自体（`.sb-block`・`.opx-card`・`.opx-row`・`.opx-form` の区画・`.sb-card`）を `surface`（白）にした（C-3）。以前は `base`（今はページと同じグレー）。

## TSX（52 行）

| ファイル:行（着手時） | 要素 | 判断 | 理由 |
|---|---|---|---|
| `components/prefill-table.tsx:14` | 区分の札（DRS） | 残す | 縁のある札 |
| 同 `:110` | 表の見出しの行 | 替える（sunken） | 見出しはくぼみ |
| 同 `:137` | 行の hover | 替える（sunken） | 白→白を避ける |
| 同 `:169`・`:171` | 取得状態の札 | 残す | 縁と状態色の札 |
| `components/ops/report-client.tsx:297`・`:317` | 通報項目の値の箱 | 替える（sunken） | 枠のない入れ子の箱 |
| 同 `:566` | 送信前の確認の箱 | 替える（sunken） | カードの中の入れ子 |
| 同 `:633` | ID の箱 | 替える（sunken） | 枠のない入れ子 |
| 同 `:1002` | 履歴の見出し帯 | 替える（sunken） | 帯はくぼみ |
| `components/ops/records-client.tsx:295` | 点検の項目の箱 | 替える（sunken） | 枠のない入れ子 |
| `components/ops/procedure-client.tsx:42`〜`:45` | 手続き記録の左線の箱（4 状態） | 替える（sunken） | 引用の箱 |
| 同 `:213` | 記録の注記 | 替える（sunken） | 同上 |
| `components/ops/permit-ui.tsx:251` | 根拠の計画の行 | 替える（sunken） | 枠のない入れ子 |
| `components/ops/ops-client.tsx:927` | サインアウトの警告 | 残す | 墨の縁の通知の箱 |
| `components/ops/plans-client.tsx:96` | 選択肢の hover | 替える（sunken） | 白→白を避ける（選択中は `sb-hover`） |
| 同 `:359` | 機体の文の箱 | 替える（sunken） | 入れ子の箱 |
| 同 `:451` | 場所の補助パネル | 替える（sunken） | 入れ子のパネル |
| 同 `:485` | 候補の行の hover | 替える（sunken） | 白→白を避ける |
| `components/ops/permits-client.tsx:78` | 選択肢の hover | 替える（sunken） | 同上 |
| 同 `:259` | 飛行範囲の入力の箱 | 替える（sunken） | 入れ子の箱 |
| `components/ops/change-notice.tsx:95` | 保存結果の通知 | 残す | 墨の縁の通知の箱 |
| `components/ops/plan-ui.tsx:481` | 期限超過の行 | 残す | 状態色の縁（1.5px）の箱 |
| `components/diagnosis-panel.tsx:76`・`:100`・`:108` | 診断の強調の面（3 種） | 替える（sunken） | 「強調＝一段濃い面」の意図。通常の面は `base` のまま。申請支援のフラグが有効なときだけ表示 |
| 同 `:485` | 種別の札 | 残す | 縁のある札 |
| `components/deadline-calendar.tsx:37`・`:44` | 期限の強調の面（2 種） | 替える（sunken） | 同上 |
| `components/manual-draft.tsx:225` | 状態の札 | 残す | 縁と状態色の札 |
| `components/regulation-card.tsx:37`〜`:40` | 判定の札（4 種） | 残す | 縁と状態色の札 |
| 同 `:159`・`:186` | 左線の注記の箱 | 替える（sunken） | 引用の箱 |
| `components/procedure-card.tsx:39`・`:40` | 区分の札 | 残す | 縁のある札 |
| 同 `:65`・`:72`・`:76`・`:80`・`:85` | 状態のピル | 残す | 縁のあるピル |
| 同 `:112` | 左線の注記の箱 | 替える（sunken） | 引用の箱 |
| `components/regulation-map.tsx:718` | 地図の上の通知の帯 | 替える（sunken） | 帯はくぼみ |
| `components/verdict-summary.tsx:289` | 条件付きの文の箱 | 替える（sunken） | 引用の箱 |
| `app/ops/plans/[id]/journal/page.tsx:23` | 飛行の行の hover | 替える（sunken） | 白→白を避ける |
| `app/ops/plans/page.tsx:135` | 次の予定の足（白いカードの下端） | 替える（sunken） | カードが白になったので足をくぼみに |
| `app/ops/members/page.tsx:55` | 利用者の説明の箱 | 替える（sunken） | 枠のない入れ子の箱 |

（残す 21 行・替える 31 行。複数の行をまとめた欄を数えると 52 行。）

## CSS（14 行）

| ファイル:行（着手時） | 規則 | 判断 | 理由 |
|---|---|---|---|
| `soraban-ui.css:206`（`.sb-block`、白の帯の中） | カード | 白のまま・規則を統合 | カードは常に白（C-3）。`.sb-band-white` の例外を廃止 |
| 同 `:211`（`.sb-block-soft`） | 注記の面 | 替える（sunken） | 「ごく薄いグレーの面」の意図。帯の例外 `.sb-band-off .sb-block-soft` を廃止 |
| 同 `:446`（`.sb-tag`） | タグ | 残す | 縁のあるタグ |
| 同 `:672`（`.sb-check-row`） | チェック行 | 替える（sunken） | 白いカードの中の行。選択中は `sb-hover` |
| 同 `:709`（`.sb-art-m`・`.sb-art-p`） | `/` の挿絵の帯 | 残す | 挿絵は墨と白だけ（A-5） |
| 同 `:922`（`.sb-note-card`） | 注記のカード | 替える（sunken） | 入れ子の箱 |
| 同 `:1036`（`.sb-layer-sources`） | 出典の詳細 | 替える（sunken） | 入れ子の箱 |
| 同 `:1121`（`.ds.ds-sb --bg-app`） | `/` の下メニューの面 | 残す | 浮く面（白＋罫） |
| `ops/ops-v2.css:275`（`.opx-badge`） | 札 | 残す | 縁のある札 |
| 同 `:600`（`.opx-check-row`） | チェック行 | 替える（sunken） | 同上 |
| `ops/ops-v2-screens.css:174`（`.opx-edge-row`） | 記録の 1 件 | 替える（sunken） | コメントが「くぼみの面」と書いていた |
| 同 `:236`（`.opx-band`） | 現場の状態の帯 | 残す | `--sb-edge` の縁のある帯 |
| `ops/design/catalog.css:90` | 見本の「面」の見本 | 残す | 見本そのもの |
| `soraban-theme.css:5` | 定義（`--color-sb-surface`） | 変更なし | 定義であって使用ではない |

## 撮影

評価者が `/ops/plans`・`/ops/plans/<id>/report`・`/ops/design` の 390 幅で、入れ子の箱が白い面の上で見えることを撮影で確かめる。
