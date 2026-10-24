"use client";

import type { ReactNode } from "react";
import { NoticeBar, StatusPill } from "../primitives";
import { Segmented } from "../tabs";
import type { DayKind, JudgeForm, PcMenu, PcName, SpMenu } from "./config";
import { PcTrial, PhoneTrial } from "./trial-frames";

// The menu and home trial (UX stage 2): two ways to arrange the PC menu and two for the phone, side by side with the
// home page of a day with a flight and a day without one. Everything is a static stand-in: no sign-in, no database, no
// network. The frames count the taps, so a person can try the same scripts the automated test counts.

export type MenuTrialProps = {
  readonly pc: PcMenu;
  readonly sp: SpMenu;
  readonly day: DayKind;
  readonly pcname: PcName;
  readonly judge: JudgeForm;
  readonly onPc: (v: PcMenu) => void;
  readonly onSp: (v: SpMenu) => void;
  readonly onDay: (v: DayKind) => void;
  readonly onPcname: (v: PcName) => void;
  readonly onJudge: (v: JudgeForm) => void;
};

const PC_NOTE: Readonly<Record<PcMenu, string>> = {
  rail: "左のメニューは、仕事の流れの順に並びます。登録の機体・操縦者などが最初から見えます。地図の幅は、左のメニューの分だけ狭くなります。",
  tabs: "いまの横並びのメニューを、名前だけ直した形です。機体や操縦者は、登録を開いてから選びます。",
};
const SP_NOTE: Readonly<Record<SpMenu, string>> = {
  tabs5: "下に 5 つのタブ。計画の一覧は専用のタブにあります。",
  tabs4band: "下に 4 つのタブ。飛行がある日は、画面の上に次の飛行の帯が出て、どの画面からも現場モードに入れます。計画はホームに入ります。",
};

function Control({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-table font-medium text-fg">{label}</span>
      {children}
    </div>
  );
}

export function MenuTrial({ pc, sp, day, pcname, judge, onPc, onSp, onDay, onPcname, onJudge }: MenuTrialProps) {
  const judgeLabel = pcname === "map" ? "地図・判定" : "判定";
  return (
    <div className="flex flex-col gap-8" data-testid="menu-trial">
      <div className="flex flex-col gap-4">
        <NoticeBar meaning="neutral" icon="info" data-testid="trial-notice">
          押して試せる見本です。実際の画面（/ と /ops 以下）は変えていません。名前・数字・日付はすべて見本データで、記録は読み書きしません。
        </NoticeBar>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="trial-controls">
          <Control label="PC のメニュー">
            <Segmented
              label="PC のメニュー"
              value={pc}
              onChange={(v) => onPc(v as PcMenu)}
              options={[
                { id: "rail", label: "左メニュー" },
                { id: "tabs", label: "横タブ" },
              ]}
              data-testid="ctl-pc"
            />
          </Control>
          <Control label="PC の判定の名前">
            <Segmented
              label="PC の判定の名前"
              value={pcname}
              onChange={(v) => onPcname(v as PcName)}
              options={[
                { id: "judge", label: "判定" },
                { id: "map", label: "地図・判定" },
              ]}
              data-testid="ctl-pcname"
            />
          </Control>
          <Control label="PC の判定画面">
            <Segmented
              label="PC の判定画面"
              value={judge}
              onChange={(v) => onJudge(v as JudgeForm)}
              options={[
                { id: "workspace", label: "地図中心" },
                { id: "stack", label: "現状の縦並び" },
              ]}
              data-testid="ctl-judge"
            />
          </Control>
          <Control label="スマホのメニュー">
            <Segmented
              label="スマホのメニュー"
              value={sp}
              onChange={(v) => onSp(v as SpMenu)}
              options={[
                { id: "tabs5", label: "5 タブ" },
                { id: "tabs4band", label: "4 タブ＋帯" },
              ]}
              data-testid="ctl-sp"
            />
          </Control>
          <Control label="ホームの日">
            <Segmented
              label="ホームの日"
              value={day}
              onChange={(v) => onDay(v as DayKind)}
              options={[
                { id: "busy", label: "飛行がある日" },
                { id: "empty", label: "予定のない日" },
              ]}
              data-testid="ctl-day"
            />
          </Control>
        </div>
      </div>

      <section aria-labelledby="trial-pc-h" className="flex flex-col gap-3" data-testid="trial-pc">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id="trial-pc-h" className="text-h1 font-semibold text-fg">
              PC（事務所）
            </h3>
            <StatusPill meaning="neutral" icon="info">
              見本データ
            </StatusPill>
          </div>
          <p className="text-table text-fg-soft">{PC_NOTE[pc]}</p>
          <p className="text-aux text-fg-mute lg:hidden">PC 用の見本です。この幅では、枠の中を横にスクロールして見ます。</p>
        </div>
        <PcTrial key={`${pc}-${pcname}-${judge}`} menu={pc} judgeLabel={judgeLabel} judgeForm={judge} day={day} onDay={onDay} />
      </section>

      <section aria-labelledby="trial-sp-h" className="flex flex-col gap-3" data-testid="trial-sp">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id="trial-sp-h" className="text-h1 font-semibold text-fg">
              スマホ（現場）
            </h3>
            <StatusPill meaning="neutral" icon="info">
              見本データ
            </StatusPill>
          </div>
          <p className="text-table text-fg-soft">{SP_NOTE[sp]}</p>
        </div>
        <PhoneTrial key={sp} menu={sp} day={day} onDay={onDay} />
      </section>
    </div>
  );
}
