"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, ArrowLeft } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import Button from "@/components/ui/Button";

/**
 * 404 global de la app. Next.js renderiza este archivo cuando:
 *  - una URL no coincide con ninguna ruta, o
 *  - una página llama a `notFound()` explícitamente.
 *
 * El CTA principal lleva al usuario a "su" home según el rol (mismo
 * mapeo que usa proxy.ts para las redirecciones post-login), en vez de
 * mandar siempre a "/".
 */
export default function NotFound() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const homeHref = !user
    ? "/"
    : user.role === "student"
      ? "/dashboard"
      : user.role === "superadmin"
        ? "/admin/dashboard"
        : "/teacher/dashboard"; // teacher | teacher_admin

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-b from-pink-50/60 via-white to-white">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-3xl bg-pink-50 flex items-center justify-center">
          <Compass className="w-8 h-8 text-primary" />
        </div>

        <p className="font-display font-black text-6xl bg-gradient-to-r from-primary to-rose-400 bg-clip-text text-transparent">
          404
        </p>

        <h1 className="font-display font-bold text-xl text-ink">
          No encontramos esta página
        </h1>

        <p className="text-sm text-ink-muted max-w-sm">
          Puede que el enlace esté roto, la página se haya movido o la
          dirección tenga un error de tipeo.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
          <Button
            variant="ghost"
            size="md"
            onClick={() => router.back()}
            className="order-2 sm:order-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver atrás
          </Button>

          <Link href={homeHref} className="order-1 sm:order-2">
            <Button variant="primary" size="md" className="w-full">
              Ir al inicio
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
