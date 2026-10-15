import * as repo from "@lockwatch/db";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const ok = /^[0-9a-f]{24}$/.test(code) && (await repo.verifySub(await db(), code));
  return Response.redirect(new URL(`/alerts?email=${ok ? "verified" : "expired"}`, req.url), 302);
}
