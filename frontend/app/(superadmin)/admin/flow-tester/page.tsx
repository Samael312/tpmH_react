"use client";

import { useState, useCallback, useRef } from "react";
import { useAuthStore } from "@/store/authStore";
import {
  Play, RotateCcw, Download, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Circle, SkipForward, Pencil, Sparkles,
} from "lucide-react";
import api from "@/lib/api";

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface TestResult {
  status: "pending" | "running" | "pass" | "fail" | "warn" | "skipped";
  assertions: { name: string; pass: boolean }[];
  request: { url: string; method: string; headers: Record<string, string>; body?: unknown } | null;
  response: { status: number; data: unknown; timing: number; error?: string } | null;
  aiAnalysis?: { root_cause: string; issues: string[]; fix: string[] } | null;
}

// ─── ENV ──────────────────────────────────────────────────────────────────────
// NEXT_PUBLIC_API_URL normalmente ya incluye /api/v1 (ver next.config.ts).
// Lo despojamos aquí porque cada test antepone su propio prefijo /api/v1/...
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const BASE_URL = (RAW_API_URL.replace(/\/api\/v1\/?$/, "") || RAW_API_URL).replace(/\/$/, "");
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const featured_teacher = process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12";  // Fallback a "mar12" si no está definido

// ─── SHARED TEST STATE ────────────────────────────────────────────────────────
// Se reinicia en cada corrida completa para que los tests sean independientes.
const mkState = () => ({
  studentToken: null as string | null,
  teacherToken: null as string | null,
  studentId:    null as string | null,
  teacherId:    null as string | null,
  studentEmail: null as string | null,
  teacherEmail: null as string | null,
  enrollmentId: null as string | null,
  classId:      null as string | null,
  materialId:   null as string | null,
  homeworkId:   null as string | null,
  testSuffix:   null as string | null,
  availabilitySlot: null as unknown,
});
let S = mkState();

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
async function httpReq(method: string, path: string, body?: unknown, token?: string | null) {
  const url = BASE_URL + path;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts: RequestInit = { method, headers, mode: "cors" };
  if (body && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const t0 = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, timing: Date.now() - t0, error: undefined as string | undefined, url, method, headers, reqBody: body };
  } catch (e: unknown) {
    return { status: 0, data: null, timing: Date.now() - t0, error: (e as Error).message, url, method, headers, reqBody: body };
  }
}

type HttpRes = Awaited<ReturnType<typeof httpReq>>;

function mk(name: string, pass: boolean) { return { name, pass }; }

function ok(r: HttpRes, assertions: { name: string; pass: boolean }[]) {
  const allPass = assertions.every(a => a.pass);
  const st = r.status === 0 ? "fail" : allPass ? "pass" : r.status >= 500 ? "fail" : "warn";
  return { st: st as "pass" | "fail" | "warn", assertions, r };
}

function skip(reason: string) {
  return {
    st: "skipped" as const,
    assertions: [{ name: `⏭ ${reason}`, pass: true }],
    r: { status: 0, data: null, timing: 0, url: "", method: "", error: undefined as string | undefined, headers: {}, reqBody: undefined },
  };
}

function d(r: HttpRes) { return r.data as Record<string, unknown>; }

// ─── TEST SUITES ──────────────────────────────────────────────────────────────
function buildSuites(adminToken: string, teacherUsername: string) {
  return [
    {
      id: "auth", name: "Autenticación", emoji: "🔐", color: "#ec4899",
      tests: [
        { id: "auth-health", name: "Health check API", method: "GET", path: "/health",
          desc: "Backend corriendo y respondiendo",
          run: async () => { const r = await httpReq("GET", "/health"); return ok(r, [mk("Status 200", r.status === 200)]); } },

        { id: "auth-register-student", name: "Registro estudiante temporal", method: "POST", path: "/api/v1/auth/register",
          desc: "Crea usuario de prueba con rol student",
          run: async () => {
            S.testSuffix = Math.random().toString(36).slice(2, 8);
            S.studentEmail = `test_s_${S.testSuffix}@tpmh.test`;
            const r = await httpReq("POST", "/api/v1/auth/register", {
              name: "Test", surname: "Student", username: `test_s_${S.testSuffix}`,
              email: S.studentEmail, password: "TestPass123!", role: "student",
            });
            const uid = (d(r)?.user as Record<string, unknown>)?.id ?? d(r)?.id;
            if (uid) S.studentId = String(uid);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "auth-register-teacher", name: "Registro profesor temporal", method: "POST", path: "/api/v1/auth/register",
          desc: "Crea usuario de prueba con rol teacher",
          run: async () => {
            S.teacherEmail = `test_t_${S.testSuffix}@tpmh.test`;
            const r = await httpReq("POST", "/api/v1/auth/register", {
              name: "TestProf", surname: "Auto", username: `test_t_${S.testSuffix}`,
              email: S.teacherEmail, password: "TestPass123!", role: "teacher",
            });
            const uid = (d(r)?.user as Record<string, unknown>)?.id ?? d(r)?.id;
            if (uid) S.teacherId = String(uid);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "auth-login", name: "Login estudiante", method: "POST", path: "/api/v1/auth/login",
          desc: "Login devuelve un access_token válido",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/auth/login", { login: S.studentEmail, password: "TestPass123!" });
            if (d(r)?.access_token) S.studentToken = d(r).access_token as string;
            return ok(r, [mk("Status 200", r.status === 200), mk("access_token presente", !!d(r)?.access_token)]);
          } },

        { id: "auth-login-teacher", name: "Login profesor", method: "POST", path: "/api/v1/auth/login",
          desc: "Login del profesor temporal para obtener su token",
          run: async () => {
            if (!S.teacherEmail) return skip("Requiere registro de profesor previo");
            const r = await httpReq("POST", "/api/v1/auth/login", { login: S.teacherEmail, password: "TestPass123!" });
            if (d(r)?.access_token) S.teacherToken = d(r).access_token as string;
            return ok(r, [mk("Status 200", r.status === 200), mk("access_token presente", !!d(r)?.access_token)]);
          } },

        { id: "auth-me", name: "GET /users/me autenticado", method: "GET", path: "/api/v1/users/me",
          desc: "JWT válido devuelve el perfil correcto",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/users/me", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Email coincide", d(r)?.email === S.studentEmail), mk("Tiene role", !!d(r)?.role)]);
          } },

        { id: "auth-me-unauth", name: "GET /users/me sin token → 401", method: "GET", path: "/api/v1/users/me",
          desc: "Ruta protegida rechaza peticiones sin JWT",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/users/me", undefined, null);
            return ok(r, [mk("Status 401 o 403", r.status === 401 || r.status === 403)]);
          } },

        { id: "auth-forgot", name: "Forgot password", method: "POST", path: "/api/v1/auth/forgot-password",
          desc: "Solicitud de reset devuelve 200",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/auth/forgot-password", { email: S.studentEmail });
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "users", name: "Perfil de Usuario", emoji: "👤", color: "#f59e0b",
      tests: [
        { id: "users-patch-me", name: "PATCH /users/me", method: "PATCH", path: "/api/v1/users/me",
          desc: "Actualiza nombre del estudiante temporal",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me", { name: "TestUpdated" }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "users-student-profile", name: "PATCH student-profile", method: "PATCH", path: "/api/v1/users/me/student-profile",
          desc: "Guarda timezone, objetivo y métodos de pago preferidos",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me/student-profile", {
              timezone: "America/Bogota",
              goal: "Mejorar la pronunciación y la fluidez al hablar",
              preferred_payment_methods: ["Paypal"],
            }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "users-preferences", name: "POST /users/me/preferences", method: "POST", path: "/api/v1/users/me/preferences",
          desc: "Guarda bloques de horario preferido del estudiante",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/users/me/preferences", {
              timezone: "America/Bogota",
              slots: [{ day_of_week: 1, start_time_local: "09:00", end_time_local: "11:00" }],
            }, S.studentToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "users-onboarding", name: "Completar onboarding", method: "PATCH", path: "/api/v1/users/me",
          desc: "Marca onboarding_completed = true",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me", { onboarding_completed: true }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "users-list-admin", name: "GET /admin/users", method: "GET", path: "/api/v1/admin/users",
          desc: "Admin lista todos los usuarios de la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/users", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna datos", Array.isArray(r.data) || !!(r.data as Record<string, unknown>)?.users)]);
          } },
      ],
    },

    {
      id: "availability", name: "Disponibilidad", emoji: "📅", color: "#22c55e",
      tests: [
        { id: "av-weekly", name: "POST horario semanal", method: "POST", path: "/api/v1/availability/me/weekly",
          desc: "Guarda bloques de disponibilidad semanal (profesor temporal)",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/availability/me/weekly", {
              timezone: "America/Bogota",
              slots: [
                { day_of_week: 1, start_time_local: "09:00", end_time_local: "12:00" },
                { day_of_week: 3, start_time_local: "14:00", end_time_local: "18:00" },
              ],
            }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "av-slots", name: "GET slots disponibles", method: "GET", path: `/api/v1/availability/${teacherUsername}/slots`,
          desc: `Slots libres de @${teacherUsername} para los próximos días`,
          run: async () => {
            const dt = new Date(); dt.setDate(dt.getDate() + 3);
            const date = dt.toISOString().split("T")[0];
            const r = await httpReq("GET", `/api/v1/availability/${teacherUsername}/slots?date=${date}&duration=60`, undefined, S.studentToken || adminToken);
            if (Array.isArray(r.data) && (r.data as unknown[]).length > 0) S.availabilitySlot = (r.data as unknown[])[0];
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna array", Array.isArray(r.data)), mk("No 500", r.status !== 500)]);
          } },

        { id: "av-featured", name: "GET featured-teacher/slots", method: "GET", path: `/api/v1/availability/${featured_teacher}/slots`,
          desc: "Slots del profesor destacado en PlatformConfig",
          run: async () => {
            const dt = new Date(); dt.setDate(dt.getDate() + 3);
            const r = await httpReq("GET", `/api/v1/availability/${featured_teacher}/slots?date=${dt.toISOString().split("T")[0]}&duration=60`, undefined, S.studentToken || adminToken);
            if (!S.availabilitySlot && Array.isArray(r.data) && (r.data as unknown[]).length > 0) S.availabilitySlot = (r.data as unknown[])[0];
            return ok(r, [mk("Status 200 o 404", r.status === 200 || r.status === 404), mk("No 500", r.status !== 500)]);
          } },

        { id: "av-exception", name: "POST excepción de disponibilidad", method: "POST", path: "/api/v1/availability/me/exceptions",
          desc: "Bloqueo puntual — ese slot debe desaparecer de la lista",
          run: async () => {
            const dt = new Date(); dt.setDate(dt.getDate() + 3);
            const r = await httpReq("POST", "/api/v1/availability/me/exceptions", { date: dt.toISOString().split("T")[0], start_time: "09:00", end_time: "10:00", reason: "Test block" }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },
      ],
    },

    {
      id: "packages", name: "Paquetes / Enrollments", emoji: "📦", color: "#a855f7",
      tests: [
        { id: "pkg-list", name: "GET /packages/", method: "GET", path: "/api/v1/packages/",
          desc: "Lista paquetes disponibles en la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/packages/", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pkg-assign", name: "Asignar paquete al estudiante (admin)", method: "PATCH", path: "/api/v1/admin/users/{id}",
          desc: "Admin asigna paquete y precio por clase al estudiante temporal",
          run: async () => {
            if (!S.studentId) return skip("Requiere studentId del registro");
            const r = await httpReq("PATCH", `/api/v1/admin/users/${S.studentId}`, {
              package_name: "Personalizado", price_per_class: 12,
            }, adminToken);
            if (r.status === 200) S.enrollmentId = S.studentId;
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pkg-my-enrollment", name: "GET my-enrollments (estudiante)", method: "GET", path: "/api/v1/packages/my-enrollments",
          desc: "Estudiante obtiene sus enrollments activos",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/packages/my-enrollments", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("No 500", r.status !== 500)]);
          } },
      ],
    },

    {
      id: "classes", name: "Reserva de Clases", emoji: "📋", color: "#f59e0b",
      tests: [
        { id: "cls-book", name: "POST /payments/book", method: "POST", path: "/api/v1/payments/book",
          desc: "Estudiante reserva un horario disponible (crea clase pendiente de pago)",
          run: async () => {
            if (!S.availabilitySlot) return skip("Requiere un slot disponible (suite Disponibilidad)");
            const slot = S.availabilitySlot as Record<string, unknown>;
            const r = await httpReq("POST", "/api/v1/payments/book", {
              start_time_utc: slot.start_time_utc,
              end_time_utc: slot.end_time_utc,
              duration_minutes: 60,
              payment_method: "binance",
            }, S.studentToken);
            if (d(r)?.class_id) S.classId = String(d(r).class_id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Devuelve class_id", !!d(r)?.class_id)]);
          } },

        { id: "cls-list-student", name: "GET clases del estudiante", method: "GET", path: "/api/v1/classes/my-classes",
          desc: "Lista clases pasadas y futuras del estudiante",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/classes/my-classes?include_history=false", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "cls-list-teacher", name: "GET clases del profesor", method: "GET", path: "/api/v1/classes/teacher/classes",
          desc: "Agenda de clases del profesor temporal",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/classes/teacher/classes", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "cls-conflict", name: "Reservar el mismo slot dos veces", method: "POST", path: "/api/v1/payments/book",
          desc: "Debe rechazar el slot ya reservado con un error controlado",
          run: async () => {
            if (!S.classId || !S.availabilitySlot) return skip("Requiere una reserva previa existente");
            const slot = S.availabilitySlot as Record<string, unknown>;
            const r = await httpReq("POST", "/api/v1/payments/book", {
              start_time_utc: slot.start_time_utc,
              end_time_utc: slot.end_time_utc,
              duration_minutes: 60,
              payment_method: "binance",
            }, S.studentToken);
            return ok(r, [mk("Status 409/400/422", r.status === 409 || r.status === 400 || r.status === 422)]);
          } },

        { id: "cls-cancel", name: "Cancelar clase", method: "DELETE", path: "/api/v1/classes/{id}",
          desc: "Estudiante cancela su clase reservada",
          run: async () => {
            if (!S.classId) return skip("Sin clase creada en este ciclo");
            const r = await httpReq("DELETE", `/api/v1/classes/${S.classId}`, undefined, S.studentToken);
            return ok(r, [mk("Status 200 o 400", r.status === 200 || r.status === 400), mk("No 500", r.status !== 500)]);
          } },

        { id: "cls-admin-list", name: "GET /admin/classes", method: "GET", path: "/api/v1/admin/classes",
          desc: "Admin lista todas las clases de la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/classes", undefined, adminToken);
            return ok(r, [mk("Status 200 o 404", r.status === 200 || r.status === 404), mk("No 500", r.status !== 500)]);
          } },
      ],
    },

    {
      id: "payments", name: "Pagos", emoji: "💳", color: "#ef4444",
      tests: [
        { id: "pay-config", name: "GET /payments/config", method: "GET", path: "/api/v1/payments/config",
          desc: "Métodos de pago habilitados en la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/payments/config", undefined, S.studentToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pay-pending", name: "GET pending-review", method: "GET", path: "/api/v1/payments/pending-review",
          desc: "Admin lista pagos pendientes con comprobante",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/payments/pending-review", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pay-wallet", name: "GET my-wallet del profesor", method: "GET", path: "/api/v1/payments/my-wallet",
          desc: "Balance disponible del profesor de prueba",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/payments/my-wallet", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pay-withdrawals", name: "GET withdrawals/pending", method: "GET", path: "/api/v1/admin/withdrawals/pending",
          desc: "Admin lista solicitudes de retiro de profesores",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/withdrawals/pending", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "materials", name: "Materiales", emoji: "📚", color: "#22c55e",
      tests: [
        { id: "mat-list", name: "GET /materials/my-materials", method: "GET", path: "/api/v1/materials/my-materials",
          desc: "Profesor lista sus materiales",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/materials/my-materials", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "mat-create", name: "POST /materials/", method: "POST", path: "/api/v1/materials/",
          desc: "Crea material de tipo vocabulario",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/materials/", {
              title: `Test Material ${S.testSuffix}`, category: "Vocabulary", level: "A1",
            }, S.teacherToken || adminToken);
            if (d(r)?.id) S.materialId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Tiene id", !!d(r)?.id)]);
          } },

        { id: "mat-vocab", name: "POST vocabulario", method: "POST", path: "/api/v1/materials/{id}/vocabulary",
          desc: "Agrega palabras de vocabulario al material",
          run: async () => {
            if (!S.materialId) return skip("Requiere material creado");
            const r = await httpReq("POST", `/api/v1/materials/${S.materialId}/vocabulary`, { words: ["Hello", "World"] }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "mat-assign", name: "POST assign material", method: "POST", path: "/api/v1/materials/{id}/assign",
          desc: "Asigna material al estudiante temporal",
          run: async () => {
            if (!S.materialId || !S.studentId) return skip("Requiere materialId y studentId");
            const r = await httpReq("POST", `/api/v1/materials/${S.materialId}/assign`, { student_ids: [S.studentId] }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "mat-student-list", name: "GET materiales del estudiante", method: "GET", path: "/api/v1/materials/student/my-materials",
          desc: "Estudiante ve sus materiales asignados",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/materials/student/my-materials", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "homework", name: "Tareas", emoji: "📝", color: "#f59e0b",
      tests: [
        { id: "hw-create", name: "POST /homework/", method: "POST", path: "/api/v1/homework/",
          desc: "Profesor crea tarea y la asigna al estudiante temporal",
          run: async () => {
            if (!S.studentId) return skip("Requiere studentId del registro");
            const due = new Date(); due.setDate(due.getDate() + 7);
            const r = await httpReq("POST", "/api/v1/homework/", {
              title: `Tarea ${S.testSuffix}`,
              content: "Instrucciones de prueba automatizada.",
              date_due: due.toISOString().split("T")[0],
              student_ids: [S.studentId],
            }, S.teacherToken || adminToken);
            if (d(r)?.id) S.homeworkId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Tiene id", !!d(r)?.id)]);
          } },

        { id: "hw-list-teacher", name: "GET /homework/my-homework", method: "GET", path: "/api/v1/homework/my-homework",
          desc: "Profesor lista todas sus tareas",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/homework/my-homework", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "hw-list-student", name: "GET /homework/student/my-homework", method: "GET", path: "/api/v1/homework/student/my-homework",
          desc: "Estudiante lista sus tareas pendientes",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/homework/student/my-homework", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "hw-submit", name: "POST submit tarea", method: "POST", path: "/api/v1/homework/student/{id}/submit",
          desc: "Estudiante entrega su tarea",
          run: async () => {
            if (!S.homeworkId) return skip("Requiere tarea creada");
            const r = await httpReq("POST", `/api/v1/homework/student/${S.homeworkId}/submit`, { submission: "Respuesta de test automatizado." }, S.studentToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },
      ],
    },

    {
      id: "admin", name: "Panel Admin", emoji: "🛡️", color: "#ef4444",
      tests: [
        { id: "adm-stats", name: "GET /admin/stats", method: "GET", path: "/api/v1/admin/stats",
          desc: "KPIs globales: usuarios, clases, ingresos",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/stats", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Tiene datos", !!r.data)]);
          } },

        { id: "adm-teachers", name: "GET /admin/teachers", method: "GET", path: "/api/v1/admin/teachers",
          desc: "Lista profesores con status de aprobación",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/teachers", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "adm-platform-config", name: "GET /admin/platform-config", method: "GET", path: "/api/v1/admin/platform-config",
          desc: "Configuración de la plataforma (featured teacher, etc.)",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/platform-config", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "adm-unauth", name: "Admin sin permisos → 401/403", method: "GET", path: "/api/v1/admin/stats",
          desc: "Estudiante no puede acceder a rutas de admin",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/stats", undefined, S.studentToken);
            return ok(r, [mk("Status 401 o 403", r.status === 401 || r.status === 403)]);
          } },
      ],
    },

    {
      id: "calendar", name: "Google Calendar", emoji: "📆", color: "#3b82f6",
      tests: [
        { id: "cal-status", name: "GET /calendar/status", method: "GET", path: "/api/v1/calendar/status",
          desc: "Estado de conexión del Calendar del profesor",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/calendar/status", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "cal-auth-url", name: "GET /calendar/auth-url", method: "GET", path: "/api/v1/calendar/auth-url",
          desc: "Genera URL de autorización OAuth2 de Google",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/calendar/auth-url", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("URL contiene google.com", typeof d(r)?.auth_url === "string" && String(d(r)?.auth_url).includes("google.com"))]);
          } },
      ],
    },

    {
      id: "chipi", name: "Chipi AI", emoji: "🤖", color: "#a855f7",
      tests: [
        { id: "chi-student", name: "POST /chipi/chat (estudiante)", method: "POST", path: "/api/v1/chipi/chat",
          desc: "Chipi responde con contexto de pantalla del estudiante",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/chipi/chat", { message: "Hola, ¿qué puedo hacer aquí?", screen_name: "student_home" }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Tiene respuesta", !!d(r)?.response)]);
          } },

        { id: "chi-public", name: "POST /chipi/chat (sin auth)", method: "POST", path: "/api/v1/chipi/chat",
          desc: "Chipi en landing sin JWT — debe responder o dar 401",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/chipi/chat", { message: "¿Cómo funciona?", screen_name: "main" }, null);
            return ok(r, [mk("Status 200 o 401", r.status === 200 || r.status === 401), mk("No 500", r.status !== 500)]);
          } },
      ],
    },
  ];
}

// ─── VISUAL CONSTANTS (Tailwind, para la UI) ──────────────────────────────────
const STATUS_LABEL: Record<string, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", running: "...", pending: "—", skipped: "SKIP" };
const STATUS_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  pass:    { text: "text-emerald-600", bg: "bg-emerald-50", border: "border-l-emerald-400" },
  fail:    { text: "text-rose-600",    bg: "bg-rose-50",    border: "border-l-rose-400" },
  warn:    { text: "text-amber-600",   bg: "bg-amber-50",   border: "border-l-amber-400" },
  running: { text: "text-blue-600",    bg: "bg-blue-50",    border: "border-l-blue-400" },
  pending: { text: "text-slate-400",   bg: "bg-slate-50",   border: "border-l-slate-200" },
  skipped: { text: "text-slate-400",   bg: "bg-slate-50",   border: "border-l-slate-200" },
};
const METHOD_STYLE: Record<string, string> = {
  GET: "bg-blue-50 text-blue-600",
  POST: "bg-emerald-50 text-emerald-600",
  PATCH: "bg-amber-50 text-amber-600",
  DELETE: "bg-rose-50 text-rose-600",
};

// ─── VISUAL CONSTANTS (hex, para el reporte HTML exportado) ───────────────────
const STATUS_HEX: Record<string, string> = { pass: "#059669", fail: "#e11d48", warn: "#d97706", running: "#2563eb", pending: "#94a3b8", skipped: "#94a3b8" };
const METHOD_HEX: Record<string, string> = { GET: "#2563eb", POST: "#059669", PATCH: "#d97706", DELETE: "#e11d48" };

function syntaxHL(obj: unknown): string {
  if (obj === null || obj === undefined) return '<span class="text-slate-500">null</span>';
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"]+)":/g, '<span class="text-sky-300">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="text-emerald-300">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="text-amber-300">$1</span>')
    .replace(/: (true|false)/g, ': <span class="text-rose-300">$1</span>');
}

async function geminiAnalyze(
  test: { name: string; method: string; path: string; desc: string },
  result: TestResult
) {
  if (result.status === "pass" || result.status === "skipped") return null;
  try {
    const res = await api.post("/ai-tools/analyze-test-failure", {
      test_name: test.name,
      method: test.method,
      path: test.path,
      description: test.desc,
      http_status: result.response?.status,
      error: result.response?.error,
      response_data: JSON.stringify(result.response?.data)?.slice(0, 500),
      failed_assertions: result.assertions.filter(a => !a.pass).map(a => a.name),
    });
    return res.data; // { root_cause, issues, fix }
  } catch {
    return null;
  }
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function StatusIcon({ status, className }: { status: TestResult["status"]; className?: string }) {
  switch (status) {
    case "pass": return <CheckCircle2 className={className} />;
    case "fail": return <XCircle className={className} />;
    case "warn": return <AlertTriangle className={className} />;
    case "running": return <Loader2 className={`${className} animate-spin`} />;
    case "skipped": return <SkipForward className={className} />;
    default: return <Circle className={className} />;
  }
}

function CodeBlock({ label, code }: { label: string; code: unknown }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</div>
      <div
        className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto"
        dangerouslySetInnerHTML={{ __html: syntaxHL(code) }}
      />
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function FlowTester() {
  const { token } = useAuthStore();
  const adminToken = token ?? "";

  const [teacherUsername, setTeacherUsername] = useState("maria");
  const [editingUsername, setEditingUsername] = useState(false);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [activeSuite, setActiveSuite] = useState("auth");
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"response" | "request" | "assertions" | "ai">("response");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const runningRef = useRef(false);

  const suites = buildSuites(adminToken, teacherUsername);
  const allTests = suites.flatMap(s => s.tests.map(t => ({ ...t, suiteId: s.id })));

  const setResult = useCallback((id: string, patch: Partial<TestResult>) => {
    setResults(prev => ({ ...prev, [id]: { ...({ status: "pending", assertions: [], request: null, response: null } as TestResult), ...prev[id], ...patch } }));
  }, []);

  const runTest = useCallback(async (test: typeof allTests[0]) => {
    setResult(test.id, { status: "running" });
    try {
      const out = await test.run();
      const r: TestResult = {
        status: out.st as TestResult["status"],
        assertions: out.assertions,
        request: out.r ? { url: out.r.url, method: out.r.method, headers: out.r.headers, body: out.r.reqBody } : null,
        response: out.r ? { status: out.r.status, data: out.r.data, timing: out.r.timing, error: out.r.error } : null,
      };
      setResult(test.id, r);
      if (GEMINI_KEY && r.status !== "pass" && r.status !== "skipped") {
        const ai = await geminiAnalyze(test, r);
        setResult(test.id, { aiAnalysis: ai });
      }
    } catch (e: unknown) {
      setResult(test.id, { status: "fail", assertions: [{ name: `Error: ${(e as Error).message}`, pass: false }], request: null, response: null });
    }
  }, [setResult]);

  const runSuite = useCallback(async (suiteId: string) => {
    if (runningRef.current) return;
    runningRef.current = true; setIsRunning(true);
    for (const test of allTests.filter(t => t.suiteId === suiteId)) {
      await runTest(test);
      await new Promise(r => setTimeout(r, 150));
    }
    runningRef.current = false; setIsRunning(false);
  }, [allTests, runTest]);

  const runAll = useCallback(async () => {
    if (runningRef.current) return;
    S = mkState();
    runningRef.current = true; setIsRunning(true); setProgress(0); setResults({});
    for (let i = 0; i < allTests.length; i++) {
      await runTest(allTests[i]);
      setProgress(Math.round(((i + 1) / allTests.length) * 100));
      await new Promise(r => setTimeout(r, 150));
    }
    runningRef.current = false; setIsRunning(false);
  }, [allTests, runTest]);

  const clearAll = () => { S = mkState(); setResults({}); setProgress(0); setSelectedTest(null); };

  const exportReport = () => {
    const rows = allTests.map(t => {
      const r = results[t.id]; const su = suites.find(s => s.id === t.suiteId);
      if (!r) return "";
      return `<tr><td>${su?.emoji} ${su?.name}</td><td>${t.name}</td><td style="color:${METHOD_HEX[t.method]}">${t.method}</td><td>${r.response?.status ?? "—"}</td><td>${r.response?.timing ?? 0}ms</td><td style="color:${STATUS_HEX[r.status]};font-weight:700">${STATUS_LABEL[r.status]}</td><td style="color:#8b949e;font-size:11px">${r.assertions.filter(a => !a.pass).map(a => a.name).join(", ") || "—"}</td></tr>`;
    }).join("");
    const g = {
      pass: Object.values(results).filter(r => r.status === "pass").length,
      fail: Object.values(results).filter(r => r.status === "fail").length,
      warn: Object.values(results).filter(r => r.status === "warn").length,
    };
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TPMH Test Report</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;margin:0}h1{font-size:20px;font-weight:800}p{color:#8b949e;margin-bottom:24px}.s{display:flex;gap:12px;margin-bottom:24px}.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 18px}.sv{font-size:24px;font-weight:700;font-family:monospace}.sl{font-size:10px;color:#8b949e;margin-top:2px}table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}th{padding:9px 12px;text-align:left;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;font-weight:700;text-transform:uppercase}td{padding:8px 12px;border-bottom:1px solid #21262d;font-size:12px}</style></head><body><h1>🧪 TPMH Flow Tester</h1><p>${new Date().toLocaleString()} · ${BASE_URL}</p><div class="s"><div class="sc"><div class="sv">${allTests.length}</div><div class="sl">Total</div></div><div class="sc"><div class="sv" style="color:#3fb950">${g.pass}</div><div class="sl">Pasaron</div></div><div class="sc"><div class="sv" style="color:#f85149">${g.fail}</div><div class="sl">Fallaron</div></div><div class="sc"><div class="sv" style="color:#d29922">${g.warn}</div><div class="sl">Warnings</div></div></div><table><thead><tr><th>Suite</th><th>Test</th><th>Método</th><th>HTTP</th><th>Timing</th><th>Resultado</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = `tpmh-report-${Date.now()}.html`; a.click();
  };

  const currentSuite = suites.find(s => s.id === activeSuite)!;
  const selectedResult = selectedTest ? results[selectedTest] : null;
  const getSuiteStats = (suite: typeof currentSuite) => {
    const res = suite.tests.map(t => results[t.id]).filter(Boolean) as TestResult[];
    return { pass: res.filter(r => r.status === "pass").length, fail: res.filter(r => r.status === "fail").length, warn: res.filter(r => r.status === "warn").length, done: res.length, total: suite.tests.length };
  };
  const gStats = {
    pass: Object.values(results).filter(r => r.status === "pass").length,
    fail: Object.values(results).filter(r => r.status === "fail").length,
    warn: Object.values(results).filter(r => r.status === "warn").length,
  };

  return (
    <div className="space-y-6 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Flow Tester
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Suite de pruebas funcionales end-to-end contra la API en vivo
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-pink-50 border border-pink-100 rounded-xl px-3 py-2">
            <span className="text-[10px] font-black text-pink-400 uppercase tracking-widest">Profesor</span>
            {editingUsername ? (
              <input
                autoFocus
                value={teacherUsername}
                onChange={e => setTeacherUsername(e.target.value)}
                onBlur={() => setEditingUsername(false)}
                onKeyDown={e => e.key === "Enter" && setEditingUsername(false)}
                className="bg-white border border-pink-200 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-700 w-28 focus:outline-none focus:ring-2 focus:ring-pink-200"
              />
            ) : (
              <button onClick={() => setEditingUsername(true)} className="flex items-center gap-1 text-xs font-bold text-pink-600">
                @{teacherUsername} <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>

          {gStats.pass + gStats.fail + gStats.warn > 0 && (
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-black">
              {gStats.pass > 0 && <span className="text-emerald-600">✓ {gStats.pass}</span>}
              {gStats.fail > 0 && <span className="text-rose-600">✕ {gStats.fail}</span>}
              {gStats.warn > 0 && <span className="text-amber-600">⚠ {gStats.warn}</span>}
            </div>
          )}

          <button onClick={clearAll} disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:border-slate-300 transition-all disabled:opacity-40">
            <RotateCcw className="w-4 h-4" /> Limpiar
          </button>
          <button onClick={exportReport} disabled={Object.keys(results).length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:border-slate-300 transition-all disabled:opacity-40">
            <Download className="w-4 h-4" /> Reporte
          </button>
          <button onClick={runAll} disabled={isRunning}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-400 text-white text-sm font-bold rounded-xl shadow-md shadow-pink-200 hover:shadow-pink-300 active:scale-[0.97] transition-all disabled:opacity-60">
            {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> {progress}%</> : <><Play className="w-4 h-4" /> Ejecutar todo</>}
          </button>
        </div>
      </div>

      {isRunning && (
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Layout principal */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_380px] gap-5 lg:h-[78vh]">

        {/* Sidebar: suites */}
        <div className="bg-slate-50/70 border border-slate-100 rounded-3xl p-3 overflow-y-auto">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 py-2">Suites</p>
          <div className="space-y-1">
            {suites.map(suite => {
              const st = getSuiteStats(suite);
              const isActive = activeSuite === suite.id;
              const badge =
                st.fail > 0 ? <span className="text-[10px] font-black text-rose-600">{st.fail}✕</span> :
                st.warn > 0 ? <span className="text-[10px] font-black text-amber-600">{st.warn}⚠</span> :
                st.done > 0 && st.pass === st.total ? <span className="text-[10px] font-black text-emerald-600">{st.pass}✓</span> : null;
              return (
                <button key={suite.id} onClick={() => setActiveSuite(suite.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-all duration-150
                    ${isActive ? "bg-white shadow-sm border border-pink-100" : "hover:bg-white/60 border border-transparent"}`}>
                  <span className="text-base flex-shrink-0">{suite.emoji}</span>
                  <span className={`flex-1 text-xs font-bold truncate ${isActive ? "text-pink-600" : "text-slate-500"}`}>{suite.name}</span>
                  {badge}
                  <span className="text-[10px] text-slate-300 font-bold">{st.done}/{st.total}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de tests de la suite activa */}
        <div className="bg-slate-50/70 border border-slate-100 rounded-3xl overflow-y-auto">
          <div className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-100 px-5 py-3.5 flex items-center justify-between z-10 rounded-t-3xl">
            <div className="flex items-center gap-2">
              <span className="text-lg">{currentSuite.emoji}</span>
              <span className="text-sm font-black text-slate-800">{currentSuite.name}</span>
            </div>
            <button onClick={() => runSuite(activeSuite)} disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-pink-200 text-pink-600 text-xs font-bold rounded-xl hover:bg-pink-50 transition-all disabled:opacity-40">
              <Play className="w-3.5 h-3.5" /> Ejecutar suite
            </button>
          </div>

          {(() => {
            const st = getSuiteStats(currentSuite);
            if (!st.done) return null;
            const timings = currentSuite.tests.map(t => results[t.id]?.response?.timing).filter((n): n is number => typeof n === "number");
            const avg = timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0;
            return (
              <div className="grid grid-cols-4 gap-3 px-5 py-4">
                {[
                  { v: `${st.pass}/${st.total}`, l: "Pasaron", c: st.pass === st.total ? "text-emerald-600" : "text-slate-700" },
                  { v: st.fail, l: "Fallaron", c: st.fail > 0 ? "text-rose-600" : "text-slate-300" },
                  { v: st.warn, l: "Warnings", c: st.warn > 0 ? "text-amber-600" : "text-slate-300" },
                  { v: `${avg}ms`, l: "Latencia", c: avg < 500 ? "text-emerald-600" : avg < 1500 ? "text-amber-600" : "text-rose-600" },
                ].map(({ v, l, c }) => (
                  <div key={l} className="bg-white border border-slate-100 rounded-2xl px-3 py-2.5 shadow-sm">
                    <div className={`text-xl font-black font-mono ${c}`}>{v}</div>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{l}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="px-4 pb-4 space-y-2">
            {currentSuite.tests.map(test => {
              const r = results[test.id];
              const status = r?.status ?? "pending";
              const meta = STATUS_STYLE[status];
              const isSelected = selectedTest === test.id;
              return (
                <div key={test.id} onClick={() => { setSelectedTest(test.id); setActiveTab("response"); }}
                  className={`bg-white rounded-2xl border-l-4 ${meta.border} shadow-sm cursor-pointer transition-all duration-150
                    ${isSelected ? "ring-2 ring-pink-300" : "hover:shadow-md"}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.text}`}>
                      <StatusIcon status={status} className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 text-sm font-bold text-slate-800 truncate">{test.name}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${METHOD_STYLE[test.method]}`}>{test.method}</span>
                    {r?.response?.status ? (
                      <span className={`text-xs font-mono font-black
                        ${r.response.status < 300 ? "text-emerald-600" : r.response.status < 500 ? "text-amber-600" : "text-rose-600"}`}>
                        {r.response.status}
                      </span>
                    ) : null}
                    {r?.response?.timing ? <span className="text-[10px] text-slate-400 font-mono min-w-[42px] text-right">{r.response.timing}ms</span> : null}
                    <button onClick={e => { e.stopPropagation(); runTest({ ...test, suiteId: activeSuite }); }} disabled={isRunning}
                      className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-pink-50 text-slate-400 hover:text-pink-500 flex items-center justify-center transition-colors disabled:opacity-30 flex-shrink-0">
                      <Play className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="px-4 pb-2.5 text-xs text-slate-400">{test.desc}</div>
                  {r && !["pending", "running"].includes(r.status) && (
                    <div className={`px-4 pb-3 text-xs font-bold ${meta.text}`}>
                      {r.status === "pass" || r.status === "skipped" ? (r.assertions[0]?.name ?? "✓") : r.assertions.filter(a => !a.pass).map(a => a.name).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector */}
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Inspector</span>
            {selectedResult && (
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${STATUS_STYLE[selectedResult.status].bg} ${STATUS_STYLE[selectedResult.status].text}`}>
                {STATUS_LABEL[selectedResult.status]}
              </span>
            )}
          </div>

          <div className="flex gap-1 px-3 pt-3 flex-shrink-0">
            {(["response", "request", "assertions", "ai"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                  ${activeTab === tab ? "bg-pink-50 text-pink-600" : "text-slate-400 hover:text-slate-600"}`}>
                {tab === "ai" ? "✦ IA" : tab === "response" ? "Response" : tab === "request" ? "Request" : "Asserts"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedResult ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2">
                <span className="text-3xl">🔍</span>
                <span className="text-xs font-bold">Selecciona un test para inspeccionar</span>
              </div>
            ) : activeTab === "response" ? (
              <>
                <div className="flex gap-6 mb-4">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</div>
                    <div className={`text-2xl font-black font-mono
                      ${!selectedResult.response?.status ? "text-slate-300" : selectedResult.response.status < 300 ? "text-emerald-600" : selectedResult.response.status < 500 ? "text-amber-600" : "text-rose-600"}`}>
                      {selectedResult.response?.status || (selectedResult.response?.error ? "ERR" : "—")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Timing</div>
                    <div className="text-2xl font-black font-mono text-pink-500">{selectedResult.response?.timing ?? 0}ms</div>
                  </div>
                </div>
                {selectedResult.response?.error && <CodeBlock label="Error de conexión" code={selectedResult.response.error} />}
                <CodeBlock label="Response Body" code={selectedResult.response?.data} />
              </>
            ) : activeTab === "request" ? (
              <>
                <CodeBlock label="Endpoint" code={`${selectedResult.request?.method} ${selectedResult.request?.url}`} />
                {selectedResult.request?.body ? <CodeBlock label="Request Body" code={selectedResult.request.body} /> : null}
                <CodeBlock label="Headers" code={selectedResult.request?.headers} />
              </>
            ) : activeTab === "assertions" ? (
              <div className="space-y-0.5">
                {selectedResult.assertions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 border-b border-slate-50 last:border-0">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 mt-0.5
                      ${a.pass ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                      {a.pass ? "✓" : "✕"}
                    </span>
                    <span className="text-xs text-slate-600">{a.name}</span>
                  </div>
                ))}
              </div>
            ) : !selectedResult.aiAnalysis ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2">
                <Sparkles className="w-6 h-6" />
                <span className="text-xs font-bold">{selectedResult.status === "pass" ? "Test pasó — sin análisis" : "Analizando con Gemini..."}</span>
              </div>
            ) : (
              <div>
                <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 mb-4">
                  <div className="text-[10px] font-black text-purple-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Análisis Gemini
                  </div>
                  <div className="text-xs text-slate-600 mb-2">
                    <span className="text-slate-800 font-bold">Causa raíz: </span>{selectedResult.aiAnalysis.root_cause}
                  </div>
                  {selectedResult.aiAnalysis.issues?.map((iss, i) => (
                    <div key={i} className="flex gap-2 text-xs text-slate-500 mb-1">
                      <span className="text-rose-400">▸</span>{iss}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Soluciones sugeridas</div>
                {selectedResult.aiAnalysis.fix?.map((f, i) => (
                  <div key={i} className="flex gap-2 text-xs text-slate-500 mb-1.5">
                    <span className="text-emerald-500">→</span>{f}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}