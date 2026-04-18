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
        if (!credentials?.username) return null;

        const username = (credentials.username as string).trim().toLowerCase();

        try {
          const user = await db.user.findFirst({
            where: {
              name: { equals: username, mode: "insensitive" },
              isActive: true,
            },
          });

          if (!user) return null;

          return { id: user.id, email: user.email, name: user.name, role: user.role };
        } catch {
          return null;
        }
      },
    }),
  ],
});
