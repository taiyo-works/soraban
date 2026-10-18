import { handleCheckPost } from "@/server/handlers";
import { runRegulationCheck } from "@/server/regulation-check";

export async function POST(req: Request) {
  return handleCheckPost(req, runRegulationCheck);
}
