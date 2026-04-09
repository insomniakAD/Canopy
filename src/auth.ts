import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import authConfig from "@/auth.config";

// Username-only auth — no passwords for now.
// Used by API routes and server components (NOT proxy).
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
      },
      async authorize(credentials) {
        console.log("[auth] authorize called, credentials:", JSON.stringify(credentials));
        if (!credentials?.username) {
          console.log("[auth] no username provided");
          return null;
        }

        const username = (credentials.username as string).trim().toLowerCase();
        console.log("[auth] looking up username:", username);

        try {
          // Look up by name (case-insensitive)
          const user = await db.user.findFirst({
            where: {
              name: { equals: username, mode: "insensitive" },
              isActive: true,
            },
          });

          console.log("[auth] user found:", user ? { id: user.id, name: user.name } : null);

          if (!user) return null;

          return { id: user.id, email: user.email, name: user.name };
        } catch (err) {
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],
});
