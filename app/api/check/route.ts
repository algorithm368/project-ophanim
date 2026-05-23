import { type NextRequest } from "next/server";
import { parseIPv4 } from "@/lib/ip";
import { checkIp } from "@/lib/ti/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(ipParam: string | null) {
  if (!ipParam) {
    return Response.json({ error: "Missing 'ip' parameter" }, { status: 400 });
  }

  const parsed = parseIPv4(ipParam);
  if (!parsed) {
    return Response.json(
      { error: "Invalid IPv4 address" },
      { status: 400 },
    );
  }
  if (parsed.isPrivate || parsed.isReserved) {
    return Response.json(
      {
        error: `Cannot check non-routable address: ${parsed.scopeNote}`,
        scope: parsed.scopeNote,
      },
      { status: 422 },
    );
  }

  const result = await checkIp(parsed.ip);
  return Response.json(result);
}

export async function GET(request: NextRequest) {
  return handle(request.nextUrl.searchParams.get("ip"));
}

export async function POST(request: NextRequest) {
  let ip: string | null = null;
  try {
    const body = (await request.json()) as { ip?: string };
    ip = body.ip ?? null;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return handle(ip);
}
