"use client";

import { useEffect } from "react";
import { setOpsEntryAvailable } from "@/lib/ops-entry";

/** 運航管理の入口が出ていることを、判定結果のボタンに伝える（描かれた間だけ立てる）。 */
export function OpsEntryFlag() {
  useEffect(() => {
    setOpsEntryAvailable(true);
    return () => setOpsEntryAvailable(false);
  }, []);
  return null;
}
