import type { NextAuthConfig } from "next-auth";

// Edge-compatible auth config (no Node.js deps like Prisma/pg).
// Used by proxy for JWT session checks, and by the main NextAuth handler.
export default {
  providers: [],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    // Persist extra fields (id, role) into the JWT token
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    // Expose id and role on the client-side session object
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
