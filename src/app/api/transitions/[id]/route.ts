import { NextRequest } from "next/server";
import { db } from "@/lib/db";

interface Body {
  reason?: string | null;
  expectedFirstPoDate?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if ("reason" in body) {
    data.reason = body.reason?.toString().trim() || null;
  }
  if ("expectedFirstPoDate" in body) {
    const raw = body.expectedFirstPoDate;
    if (!raw) {
      data.expectedFirstPoDate = null;
    } else {
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        return Response.json(
          { error: "expectedFirstPoDate is not a valid date" },
          { status: 400 }
        );
      }
      data.expectedFirstPoDate = d;
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No editable fields in body" }, { status: 400 });
  }

  try {
    const updated = await db.pendingVendorTransition.update({
      where: { id },
      data,
    });
    return Response.json({ ok: true, transition: updated });
  } catch {
    return Response.json({ error: "Transition not found" }, { status: 404 });
  }
}
