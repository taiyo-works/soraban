import { describe, expect, it } from "vitest";
import { tidyFieldErrors, tidyFieldMessage } from "./field-message";

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
