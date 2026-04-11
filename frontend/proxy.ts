import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeToken, isTokenExpired } from "@/lib/auth";

const authRoutes = ["/login", "/register"];

// ¡Volvemos a usar 'proxy' como exige Next.js 16+!
export function proxy(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const { pathname } = request.nextUrl;

  const payload = token ? decodeToken(token) : null;
  const isExpired = !token || isTokenExpired(token);

  // 1. Lógica de Redirección para Login/Register
  if (authRoutes.includes(pathname)) {
    if (!isExpired && payload) {
      if (payload.role === "student") return NextResponse.redirect(new URL("/dashboard", request.url));
      if (payload.role === "teacher") return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
      // Aplicamos el || "" para calmar a TypeScript
      if (["superadmin", "professor_admin"].includes(payload.role || "")) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }

  // 2. Protección Estudiantes
  if (pathname.startsWith("/dashboard") && (isExpired || payload?.role !== "student")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 3. Protección Profesores
  if (pathname.startsWith("/teacher") && (isExpired || payload?.role !== "teacher")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 4. Protección Admin (Unificada)
  if (pathname.startsWith("/admin")) {
    // Aplicamos el || "" para calmar a TypeScript
    if (isExpired || !["superadmin", "professor_admin"].includes(payload?.role || "")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  if (pathname.startsWith('/teacher')) {
    if (!token || isTokenExpired(token)) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    const payload = decodeToken(token)
    if (!['teacher', 'professor_admin'].includes(payload?.role || '')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};