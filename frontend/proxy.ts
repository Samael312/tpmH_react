import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeToken, isTokenExpired } from "@/lib/auth";

const authRoutes = ["/login", "/register"];

// 1. Cambiamos a exportación nombrada con el nombre 'proxy'
export function proxy(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const { pathname } = request.nextUrl;

  // Lógica de Redirección para Login/Register
  if (authRoutes.includes(pathname)) {
    if (token && !isTokenExpired(token)) {
      const payload = decodeToken(token);
      if (payload?.role === "student") return NextResponse.redirect(new URL("/dashboard", request.url));
      if (payload?.role === "teacher") return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
      if (payload?.role === "superadmin") return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    }
    return NextResponse.next();
  }

  const payload = token ? decodeToken(token) : null;
  const isExpired = !token || isTokenExpired(token);

  // Protección Estudiantes
  if (pathname.startsWith("/dashboard") && (isExpired || payload?.role !== "student")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Protección Profesores
  if (pathname.startsWith("/teacher") && (isExpired || payload?.role !== "teacher")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Protección Admin
  if (pathname.startsWith("/admin") && (isExpired || payload?.role !== "superadmin")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// 2. Exportamos también como default por si acaso
export default proxy;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};