import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/profile — return current user's profile
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      preferences: true,
      createdAt: true,
    },
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return Response.json(user);
}

// PUT /api/profile — update current user's profile fields
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { name, email, preferences } = body as {
    name?: string;
    email?: string;
    preferences?: Record<string, unknown>;
  };

  // Build update payload — only include fields that were provided
  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) {
      return Response.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    data.name = trimmed;
  }
  if (email !== undefined) {
    const trimmed = email.trim();
    if (!trimmed) {
      return Response.json({ error: "Email cannot be empty" }, { status: 400 });
    }
    data.email = trimmed;
  }
  if (preferences !== undefined) {
    data.preferences = preferences;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await db.user.update({
      where: { id: session.user.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        preferences: true,
        createdAt: true,
      },
    });
    return Response.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    if (message.includes("Unique constraint")) {
      return Response.json({ error: "Email is already in use" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
