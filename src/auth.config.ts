import type { NextAuthConfig } from "next-auth";

// Edge-compatible auth config (no Node.js deps like Prisma/pg).
// Used by middleware for JWT session checks.
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
  },
} satisfies NextAuthConfig;
