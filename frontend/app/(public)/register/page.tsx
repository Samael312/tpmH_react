"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  
  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
    name: "",
    surname: "",
    role: "student",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.post("/auth/register", form);
      const { access_token, role, name, username } = response.data;

      login(access_token, { username, name, role });

      if (role === "student") router.push("/dashboard");
      else if (role === "teacher") router.push("/teacher/dashboard");

    } catch (err: any) {
      setError(err.response?.data?.detail || "Error en el registro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 py-12 px-4">
      <div className="w-full max-w-md p-8 bg-white border rounded-xl shadow-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Crea tu cuenta</h1>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Nombre"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black text-sm"
            />
            <input
              type="text"
              placeholder="Apellido"
              required
              value={form.surname}
              onChange={(e) => setForm({ ...form, surname: e.target.value })}
              className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black text-sm"
            />
          </div>

          <input
            type="text"
            placeholder="Nombre de usuario"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black text-sm"
          />

          <input
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black text-sm"
          />

          <input
            type="password"
            placeholder="Contraseña"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-black text-sm"
          />

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-700">Rol</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="border rounded-lg px-4 py-2 bg-white outline-none focus:ring-2 focus:ring-black text-sm"
            >
              <option value="student">Estudiante</option>
              <option value="teacher">Profesor</option>
            </select>
          </div>

          {error && (
            <p className="text-red-500 text-xs p-2 bg-red-50 border border-red-100 rounded">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 transition-opacity"
          >
            {loading ? "Registrando..." : "Registrarse"}
          </button>
        </form>
      </div>
    </main>
  );
}