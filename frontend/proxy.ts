import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeToken, isTokenExpired } from "@/lib/auth";

const authRoutes = ["/login", "/register"];

// SEC-05: el backend fija las cookies `tpm_access` (JWT corto) y `tpm_session` (marca de sesión con refresh
// vigente). Si el access venció pero hay `tpm_session`, se deja cargar la página: el cliente renueva con
// POST /auth/refresh en su primera llamada 401. Sin ninguna de las dos -> login. El rol solo se puede
// comprobar aquí mientras el access sigue vigente; la autorización real la hace siempre el backend.
export function proxy(request: NextRequest) {
  const token = request.cookies.get("tpm_access")?.value;
  const hasSession = !!request.cookies.get("tpm_session")?.value;
  const { pathname } = request.nextUrl;

  const payload   = token ? decodeToken(token) : null;
  const isExpired = !token || isTokenExpired(token);
  const role      = payload?.role || "";
  const canRenew  = isExpired && hasSession; // access vencido pero la sesión se puede renovar

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
    if (canRenew) return NextResponse.next();
    if (isExpired) return NextResponse.redirect(new URL("/login", request.url));
    if (role !== "student")
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    return NextResponse.next();
  }

  // ── 3. Protección Profesores ─────────────────────────────────────────────
  if (pathname.startsWith("/teacher")) {
    if (canRenew) return NextResponse.next();
    if (isExpired) return NextResponse.redirect(new URL("/login", request.url));
    if (!["teacher", "teacher_admin"].includes(role))
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    // El onboarding y el resto de rutas /teacher/* los resuelve el layout con una llamada a la API.
    return NextResponse.next();
  }

  // ── 4. Protección Admin ──────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (canRenew) return NextResponse.next();
    if (isExpired) return NextResponse.redirect(new URL("/login", request.url));
    if (!["superadmin", "teacher_admin"].includes(role))
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
