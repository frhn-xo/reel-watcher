import { NextResponse } from "next/server";
import { checkCdpHealth } from "@/lib/resolvers/cdp";

// Connection preflight for the Settings screen. Reports whether the signed-in
// debug browser is reachable over CDP and whether it carries an Instagram
// session — so a misconfigured setup surfaces as a plain status instead of a
// cryptic error the first time someone adds a channel. Drives the browser over
// CDP, so it runs on the Node runtime (the default for route handlers).

export async function GET() {
  const health = await checkCdpHealth();
  return NextResponse.json(health);
}
