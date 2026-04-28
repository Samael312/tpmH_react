import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeToken, isTokenExpired } from "@/lib/auth";

const authRoutes = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const { pathname } = request.nextUrl;

  const payload   = token ? decodeToken(token) : null;
  const isExpired = !token || isTokenExpired(token);
  const role      = payload?.role || "";

  // ── 1. Rutas de auth (login / register) ─────────────────────────────────
  if (authRoutes.includes(pathname)) {
    if (!isExpired && payload) {
      if (role === "student") return NextResponse.redirect(new URL("/dashboard", request.url));
      if (["teacher", "teacher_admin"].includes(role))
        return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
      if (["superadmin"].includes(role))
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // ── 2. Protección Estudiantes ────────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    if (isExpired || role !== "student")
      return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  }

  // ── 3. Protección Profesores ─────────────────────────────────────────────
  if (pathname.startsWith("/teacher")) {
    // Sin sesión o rol incorrecto → login
    if (isExpired || !["teacher", "teacher_admin"].includes(role))
      return NextResponse.redirect(new URL("/login", request.url));

    // El onboarding es siempre accesible para profesores autenticados
    if (pathname.startsWith("/teacher/onboarding"))
      return NextResponse.next();

    // Para el resto de rutas /teacher/* el onboarding se verifica
    // en el layout con una llamada a la API (el middleware no tiene
    // acceso a la BD, así que la redirección fina la maneja el layout)
    return NextResponse.next();
  }

  // ── 4. Protección Admin ──────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (isExpired || !["superadmin", "teacher_admin"].includes(role))
      return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};