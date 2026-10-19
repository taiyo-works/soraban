import { connection } from "next/server";
import { handleTestSignOut } from "@/server/ops/handlers";

export async function POST(req: Request) {
  await connection();
  return handleTestSignOut(req);
}
