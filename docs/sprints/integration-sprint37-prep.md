# 統合の準備：`feat/sprint-37-usability` と `claude/charming-goldberg-imupw0`（2026-11-26）

オーケストレーターが、作業用のコピー（worktree）で試しに統合して確かめた記録。両方のブランチは変えていない。

## 1. ブランチの位置

| ブランチ | `main` との差 | 内容 |
|---|---|---|
| `feat/sprint-37-usability`（最終 2026-11-16） | 7 コミット先行・0 遅れ | drone-ops 統合の計画（Sprint 37〜48 の契約案）、ユーザビリティの基準の文書、用語集の検査、入力欄の文字サイズの判定、操作数を数える補助。**画面の変更なし**（`apps/web/src/lib` の検査用の関数・単体テストと `e2e/` の補助だけ） |
| `claude/charming-goldberg-imupw0` | 331 コミット先行・0 遅れ | Sprint 16 の作り直し（16-A〜16-N3）。G-2 待ち |

どちらも今の `main` から分かれていて、`main` は動いていない。

## 2. 試しの統合の結果（`charming-goldberg` 1920f84 に `sprint-37` 82fb29c を統合）

- 衝突は 2 ファイルだけ。
  - `e2e/field-checks.ts`：先頭の import。こちらは `test` を足し、sprint-37 は `control-font-size` の import と再輸出を足した。**両方を残す**（`import { expect, test, type Locator, type Page }` ＋ sprint-37 の 2 行）。ファイルの後ろの追加（こちらの本文の検査と、sprint-37 の入力欄の検査）は自動で統合された。
  - `docs/sprints/README.md`：Sprint 16 の行。**こちらの 2 行（作り直しの 16 と「16（旧）」）を残し**、sprint-37 側の旧い 16 の行は捨てる（同じ内容は「16（旧）」の行にある）。
- 統合した木で：`pnpm install --offline --frozen-lockfile`、typecheck、lint、`pnpm test` はすべて通過（単体 3,142 件。こちらの 3,098 件＋ sprint-37 の 44 件）。E2E は流していない（sprint-37 は E2E の spec を足していない。`e2e/` の補助だけ）。
- `wording-policy.ts` は自動で統合された（こちらは 16-N2 で許可リストの 1 行を外し、sprint-37 は用語集を後ろに足した。重なりなし）。

## 3. 統合の後に直す必要がある食い違い（文書）

sprint-37 の文書は Sprint 16 の作り直し（2026-11-22）の前に書かれている。統合したら planner に次を直させる。

1. `docs/design/usability-standard.md`（配色の行と、主役は 1 つの行）と `sprint-37.md`：「橙は文字・細い線に使わない（面にだけ使う）」「主ボタン・橙の面は 1 つ」→ 今の方針は「主色は空色 `#1F5FE0` の 1 色、橙はロゴだけ」（不変条件 6、`design-direction-2026-11.md`）。
2. `drone-ops-integration-roadmap.md`：「16-2・16-3 は未着手」「新しい画面を白基調のトークンで作る」→ 16-2・16-3 は作り直しの 16-K・16-N に引き継いで完了。38 以降の画面は新しいトークン（`sb-*`）で作る。
3. 用語集の「送信待ち → 未送信」（`GLOSSARY` の `unsent`）：今は観察だけ（検査は落ちない）。16-N3 の現場の 1 行の帯と、ログアウトの確認の文が「送信待ち」を使っている。38 で置き換えるときは、`field-band-compact`・`signout-*` の E2E と `data-testid` を保ち、文言だけを変える。

**直した記録（2026-11-27、planner。文書だけ。コード・テストは変えていない）**

- 1 は直した: `docs/design/usability-standard.md` の配色の行を「主色は空色 `#1F5FE0` の 1 色だけ、橙はロゴ（提供元の表記）だけ」に、点検表の 8 を「主ボタン（主色の面）は 1 つ」に改めた。`sprint-37.md` §0 の下限の列挙も同じに改めた。`grep 橙` で Sprint 38〜48 の文書と `drone-ops-integration-roadmap.md` を探し、同じ記述は無かった。
- 2 は直した: `drone-ops-integration-roadmap.md` §8.3 の「新しい画面を白基調のトークンで作る」を、旧 16-2・16-3 は作り直しの 16-K・16-N に引き継いで 16-A〜16-N3 が完了（2026-11-26。残りはゲート G-2）、38 以降の画面は新しいトークン（`--sb-*`）で作る、に改めた（`sprint-16.md` §4・`README.md` の索引で確かめた）。「16-2・16-3 は未着手」の字句は本文に無く、§8.3 の 1 行が該当だった。Sprint 38〜47 の冒頭の「依存: PR #49 のマージ（16-1 を含む）」は事実として残した（直していない）。
- 3 は直した: `sprint-38.md` の K1-5 に、置き換えるときは `field-band-compact`（`-connection`・`-unsent`）と `signout-*` の `data-testid` を保ち、既存の E2E は検査の意図を変えず期待する文言だけを直す、という条件を足した（元の契約には無かった）。`wording-policy.ts` の `GLOSSARY`・許可リストは変えていない。

## 4. 統合の順の案（決めるのはユーザー）

- **推奨**: `sprint-37` を先に `main` へ（画面の変更がなく小さい）。その後、こちらのブランチに `main` を取り込み（§2 の解き方）、G-2 の後にこちらを `main` へ。
- 逆の順でも衝突は同じ 2 ファイルで、解き方も同じ。
- どちらも PR はユーザーが求めたときだけ作る。こちらのブランチは、G-2 が済むまで `main` に入れないことを推奨（Sprint 16 の完了の条件）。
