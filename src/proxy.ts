import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Use NextAuth's own auth wrapper — this correctly reads the JWT cookie
// using the same salt/cookie-name that the credentials handler sets.
const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");
  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }

  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.nextUrl));
  }

  // Admin routes require admin role. Buyers get bounced to /import
  // with a flash query so the page can show a "not authorized" banner.
  if (isLoggedIn && isAdminRoute && role !== "admin") {
    const url = new URL("/import", req.nextUrl);
    url.searchParams.set("forbidden", "admin");
    return Response.redirect(url);
  }

  return undefined; // continue
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|templates/|audit/).*)",
  ],
};
