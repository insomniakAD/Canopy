import { db } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const existing = await db.pendingVendorTransition.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: "Transition not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return Response.json(
        { error: `Transition is already "${existing.status}"` },
        { status: 409 }
      );
    }
    const updated = await db.pendingVendorTransition.update({
      where: { id },
      data: { status: "cancelled" },
    });
    return Response.json({ ok: true, transition: updated });
  } catch {
    return Response.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
