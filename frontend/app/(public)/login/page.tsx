"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.post("/auth/login", form);
      const { access_token, role, name, username } = response.data;

      login(access_token, { username, name, role });

      // Redirigir según rol
      if (role === "student") router.push("/dashboard");
      else if (role === "teacher") router.push("/teacher/dashboard");
      else if (role === "superadmin") router.push("/admin/dashboard");

    } catch (err: any) {
      setError(err.response?.data?.detail || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm p-8 border rounded-xl shadow-sm">
        <h1 className="text-2xl font-bold mb-6">Iniciar sesión</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Usuario o email"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black"
          />

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-black text-white py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? "Cargando..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          ¿No tienes cuenta?{" "}
          <a href="/register" className="underline">
            Regístrate
          </a>
        </p>
      </div>
    </main>
  );
}