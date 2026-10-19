import { connection } from "next/server";
import { handleHealthDbGet } from "@/server/health";

// DB 接続確認（Sprint 8）。手動の確認用で、定期監視からは呼ばない
// （scale-to-zero 中の Neon の計算資源を起こし、従量課金が増えるため）。
// 未設定・不達でも 200 を返す。接続文字列・ホスト名・ロール名・エラーの生メッセージは返さない。
export async function GET() {
  await connection();
  return handleHealthDbGet();
}
