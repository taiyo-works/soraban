import { describe, expect, it } from "vitest";
import { evaluateDid } from "@soraban/regulations";
import { tidyEngineText, tidyFieldErrors, tidyFieldMessage } from "./field-message";

describe("tidyFieldMessage（項目名の重なり）", () => {
  it("「緯度：緯度は…」の先頭の重なりを 1 つにする", () => {
    expect(tidyFieldMessage("緯度：緯度は −90〜90 の範囲で入力してください")).toBe("緯度は −90〜90 の範囲で入力してください");
    expect(tidyFieldMessage("経度：経度は −180〜180 の範囲で入力してください")).toBe("経度は −180〜180 の範囲で入力してください");
  });
  it("重なっていない文・項目名の違う文は変えない", () => {
    expect(tidyFieldMessage("緯度を入力してください")).toBe("緯度を入力してください");
    expect(tidyFieldMessage("範囲の半径（m）は 1〜10000 の整数で入力してください")).toBe("範囲の半径（m）は 1〜10000 の整数で入力してください");
    expect(tidyFieldMessage("緯度：経度は…")).toBe("緯度：経度は…");
  });
  it("項目の一覧にまとめて適用できる", () => {
    expect(tidyFieldErrors({ latitude: "緯度：緯度は…", radiusM: "半径は…" })).toEqual({ latitude: "緯度は…", radiusM: "半径は…" });
  });
});

describe("tidyEngineText（エンジンの文の「必ず」を画面の側で外す。16-L の L-3）", () => {
  it("DID データが読めないときのエンジンの文（変えない）には「必ず」があり、整えた文には無い", () => {
    const note = evaluateDid({ lat: 35.4, lng: 133.4 }, null).note ?? "";
    expect(note, "エンジンの文は変えていない").toContain("DIPS で必ず確認してください");
    const shown = tidyEngineText(note);
    expect(shown).not.toContain("必ず");
    expect(shown).toContain("地理院地図・DIPS で確認してください");
    expect(shown).toContain("確認できません（未確認）");
  });
  it("「必ずしも」は壊さず、単独の「必ず」だけ外す（N-4）", () => {
    expect(tidyEngineText("必ずしも該当するとは限りません。DIPS で必ず確認してください")).toBe("必ずしも該当するとは限りません。DIPS で確認してください");
  });
  it("「必ず」の無い文は変えない", () => {
    expect(tidyEngineText("DID に該当します。")).toBe("DID に該当します。");
  });
});
