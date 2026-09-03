"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import Button from "@/components/ui/Button";

/**
 * Se muestra cuando `proxy.ts` detecta una sesión válida pero con un rol
 * que no tiene acceso a la sección pedida (ej. un estudiante entrando a
 * /admin/algo). A diferencia de una sesión vencida — que manda a
 * /login —, acá el problema no es la autenticación sino el permiso, así
 * que no tiene sentido pedirle que inicie sesión de nuevo.
 */
export default function Unauthorized() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const homeHref = !user
    ? "/login"
    : user.role === "student"
      ? "/dashboard"
      : user.role === "superadmin"
        ? "/admin/dashboard"
        : "/teacher/dashboard"; // teacher | teacher_admin

  const handleSwitchAccount = () => {
    logout();
    router.push("/login");
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-b from-amber-50/60 via-white to-white">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-amber-500" />
        </div>

        <p className="font-display font-black text-6xl bg-gradient-to-r from-amber-500 to-orange-400 bg-clip-text text-transparent">
          403
        </p>

        <h1 className="font-display font-bold text-xl text-ink">
          No tenés permiso para ver esta página
        </h1>

        <p className="text-sm text-ink-muted max-w-sm">
          Tu cuenta no tiene el rol necesario para acceder a esta sección.
          Si creés que esto es un error, contactá a soporte.
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
              {user ? "Ir a mi panel" : "Iniciar sesión"}
            </Button>
          </Link>
        </div>

        {user && (
          <button
            onClick={handleSwitchAccount}
            className="text-xs text-ink-subtle hover:text-primary underline underline-offset-2 mt-1"
          >
            ¿No sos {user.name}? Cerrar sesión
          </button>
        )}
      </div>
    </main>
  );
}
