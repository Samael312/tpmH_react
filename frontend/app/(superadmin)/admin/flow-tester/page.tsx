'use client';
import { useState, useCallback, useRef, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
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
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const GEMINI_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "";

// ─── SHARED TEST STATE ────────────────────────────────────────────────────────
// Resets each full run so tests are independent
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
  return { st: "skipped" as const, assertions: [{ name: `⏭ ${reason}`, pass: true }],
    r: { status: 0, data: null, timing: 0, url: "", method: "", headers: {}, reqBody: undefined } };
}

function d(r: HttpRes) { return r.data as Record<string, unknown>; }

// ─── TEST SUITES ──────────────────────────────────────────────────────────────
function buildSuites(adminToken: string, teacherUsername: string) {
  return [
    {
      id: "auth", name: "Autenticación", emoji: "🔐", color: "#58a6ff",
      tests: [
        { id: "auth-health", name: "Health check API", method: "GET", path: "/health",
          desc: "Backend corriendo y respondiendo",
          run: async () => { const r = await httpReq("GET", "/health"); return ok(r, [mk("Status 200", r.status === 200)]); } },

        { id: "auth-register-student", name: "Registro estudiante temporal", method: "POST", path: "/api/v1/auth/register",
          desc: "Crea usuario de prueba con rol student y obtiene JWT",
          run: async () => {
            S.testSuffix = Math.random().toString(36).slice(2, 8);
            S.studentEmail = `test_s_${S.testSuffix}@tpmh.test`;
            const r = await httpReq("POST", "/api/v1/auth/register", { email: S.studentEmail, password: "TestPass123!", first_name: "Test", last_name: "Student", role: "student" });
            if (d(r)?.access_token) S.studentToken = d(r).access_token as string;
            if ((d(r)?.user as Record<string,unknown>)?.id) S.studentId = String((d(r).user as Record<string,unknown>).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("access_token presente", !!d(r)?.access_token), mk("Rol es student", (d(r)?.user as Record<string,unknown>)?.role === "student")]);
          } },

        { id: "auth-register-teacher", name: "Registro profesor temporal", method: "POST", path: "/api/v1/auth/register",
          desc: "Crea usuario de prueba con rol teacher y obtiene JWT",
          run: async () => {
            S.teacherEmail = `test_t_${S.testSuffix}@tpmh.test`;
            const r = await httpReq("POST", "/api/v1/auth/register", { email: S.teacherEmail, password: "TestPass123!", first_name: "TestProf", last_name: "Auto", role: "teacher" });
            if (d(r)?.access_token) S.teacherToken = d(r).access_token as string;
            if ((d(r)?.user as Record<string,unknown>)?.id) S.teacherId = String((d(r).user as Record<string,unknown>).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("access_token presente", !!d(r)?.access_token), mk("Rol es teacher", (d(r)?.user as Record<string,unknown>)?.role === "teacher")]);
          } },

        { id: "auth-login", name: "Login con email", method: "POST", path: "/api/v1/auth/login",
          desc: "Login devuelve nuevo token válido",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/auth/login", { login: S.studentEmail, password: "TestPass123!" });
            if (d(r)?.access_token) S.studentToken = d(r).access_token as string;
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
      id: "users", name: "Perfil de Usuario", emoji: "👤", color: "#ffa657",
      tests: [
        { id: "users-patch-me", name: "PATCH /users/me", method: "PATCH", path: "/api/v1/users/me",
          desc: "Actualiza nombre del estudiante temporal",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me", { first_name: "TestUpdated" }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "users-student-profile", name: "PATCH student-profile", method: "PATCH", path: "/api/v1/users/me/student-profile",
          desc: "Guarda timezone, learning_goal y nivel de inglés",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me/student-profile", { timezone: "America/Bogota", learning_goal: "conversacion", english_level: "intermediate" }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "users-preferences", name: "PATCH /users/me/preferences", method: "PATCH", path: "/api/v1/users/me/preferences",
          desc: "Guarda días y horarios preferidos del estudiante",
          run: async () => {
            const r = await httpReq("PATCH", "/api/v1/users/me/preferences", { preferred_days: ["monday", "wednesday"], preferred_times: ["morning"] }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
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
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna datos", Array.isArray(r.data) || !!(r.data as Record<string,unknown>)?.items)]);
          } },
      ],
    },

    {
      id: "availability", name: "Disponibilidad", emoji: "📅", color: "#3fb950",
      tests: [
        { id: "av-weekly", name: "POST horario semanal", method: "POST", path: "/api/v1/availability/me/weekly",
          desc: "Guarda bloques de disponibilidad semanal (con profesor temporal)",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/availability/me/weekly", { slots: [{ day_of_week: 1, start_time: "09:00", end_time: "12:00" }, { day_of_week: 3, start_time: "14:00", end_time: "18:00" }] }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "av-slots", name: "GET slots disponibles", method: "GET", path: `/api/v1/availability/${teacherUsername}/slots`,
          desc: `Slots libres del profesor @${teacherUsername} para los próximos días`,
          run: async () => {
            const dt = new Date(); dt.setDate(dt.getDate() + 3);
            const date = dt.toISOString().split("T")[0];
            const r = await httpReq("GET", `/api/v1/availability/${teacherUsername}/slots?date=${date}&duration=60`, undefined, S.studentToken || adminToken);
            if (Array.isArray(r.data) && (r.data as unknown[]).length > 0) S.availabilitySlot = (r.data as unknown[])[0];
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna array", Array.isArray(r.data)), mk("No 500", r.status !== 500)]);
          } },

        { id: "av-featured", name: "GET featured-teacher/slots", method: "GET", path: "/api/v1/availability/featured-teacher/slots",
          desc: "Slots del profesor destacado en PlatformConfig",
          run: async () => {
            const dt = new Date(); dt.setDate(dt.getDate() + 3);
            const r = await httpReq("GET", `/api/v1/availability/featured-teacher/slots?date=${dt.toISOString().split("T")[0]}&duration=60`, undefined, S.studentToken || adminToken);
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
      id: "packages", name: "Paquetes / Enrollments", emoji: "📦", color: "#bc8cff",
      tests: [
        { id: "pkg-list", name: "GET /packages/", method: "GET", path: "/api/v1/packages/",
          desc: "Lista paquetes disponibles en la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/packages/", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pkg-assign", name: "Asignar paquete a estudiante", method: "POST", path: "/api/v1/packages/assign",
          desc: "Admin asigna paquete al estudiante temporal",
          run: async () => {
            if (!S.studentId) return skip("Requiere studentId del registro");
            const r = await httpReq("POST", "/api/v1/packages/assign", { student_id: S.studentId, package_name: "basic", price_per_class: 20, total_classes: 4 }, adminToken);
            if (d(r)?.id) S.enrollmentId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Tiene enrollment id", !!d(r)?.id)]);
          } },

        { id: "pkg-my-enrollment", name: "GET my-enrollment (estudiante)", method: "GET", path: "/api/v1/packages/my-enrollment",
          desc: "Estudiante obtiene su enrollment activo",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/packages/my-enrollment", undefined, S.studentToken);
            if (d(r)?.id && !S.enrollmentId) S.enrollmentId = String(d(r).id);
            return ok(r, [mk("Status 200 o 404", r.status === 200 || r.status === 404), mk("No 500", r.status !== 500)]);
          } },
      ],
    },

    {
      id: "classes", name: "Reserva de Clases", emoji: "📋", color: "#d29922",
      tests: [
        { id: "cls-book", name: "POST /classes/book", method: "POST", path: "/api/v1/classes/book",
          desc: "Estudiante reserva clase en slot disponible",
          run: async () => {
            if (!S.enrollmentId) return skip("Requiere enrollment activo");
            const slot = S.availabilitySlot as Record<string, unknown> | null;
            const dt = new Date(); dt.setDate(dt.getDate() + 3); dt.setHours(10, 0, 0, 0);
            const r = await httpReq("POST", "/api/v1/classes/book", { enrollment_id: S.enrollmentId, teacher_username: teacherUsername, scheduled_at: slot?.start_time ?? dt.toISOString(), duration_minutes: 60 }, S.studentToken);
            if (d(r)?.id) S.classId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Clase tiene id", !!d(r)?.id), mk("Status válido", ["pending","pending_payment","confirmed"].includes(String(d(r)?.status)))]);
          } },

        { id: "cls-list-student", name: "GET clases del estudiante", method: "GET", path: "/api/v1/classes/my",
          desc: "Lista clases pasadas y futuras del estudiante",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/classes/my", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna datos", Array.isArray(r.data) || !!(r.data as Record<string,unknown>)?.items)]);
          } },

        { id: "cls-list-teacher", name: "GET clases del profesor", method: "GET", path: "/api/v1/classes/teacher/my",
          desc: "Agenda de clases del profesor de la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/classes/teacher/my", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "cls-conflict", name: "Conflicto de horario → 409", method: "POST", path: "/api/v1/classes/book",
          desc: "Intentar reservar el mismo slot dos veces debe dar error",
          run: async () => {
            if (!S.classId || !S.enrollmentId) return skip("Requiere clase previa existente");
            const slot = S.availabilitySlot as Record<string, unknown> | null;
            const dt = new Date(); dt.setDate(dt.getDate() + 3); dt.setHours(10, 0, 0, 0);
            const r = await httpReq("POST", "/api/v1/classes/book", { enrollment_id: S.enrollmentId, teacher_username: teacherUsername, scheduled_at: slot?.start_time ?? dt.toISOString(), duration_minutes: 60 }, S.studentToken);
            return ok(r, [mk("Status 409/400/422", r.status === 409 || r.status === 400 || r.status === 422)]);
          } },

        { id: "cls-cancel", name: "Cancelar clase", method: "DELETE", path: "/api/v1/classes/{id}",
          desc: "Estudiante cancela su clase (12h de antelación requeridas)",
          run: async () => {
            if (!S.classId) return skip("Sin clase creada en este ciclo");
            const r = await httpReq("DELETE", `/api/v1/classes/${S.classId}`, undefined, S.studentToken);
            return ok(r, [mk("Status 200 o 400", r.status === 200 || r.status === 400), mk("No 500", r.status !== 500)]);
          } },

        { id: "cls-admin-list", name: "GET /admin/classes", method: "GET", path: "/api/v1/admin/classes",
          desc: "Admin lista todas las clases de la plataforma",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/admin/classes", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "payments", name: "Pagos", emoji: "💳", color: "#f85149",
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
            return ok(r, [mk("Status 200", r.status === 200), mk("Retorna array", Array.isArray(r.data) || !!(r.data as Record<string,unknown>)?.items)]);
          } },

        { id: "pay-wallet", name: "GET wallet del profesor", method: "GET", path: "/api/v1/payments/teacher/wallet",
          desc: "Balance disponible del profesor de prueba",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/payments/teacher/wallet", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "pay-withdrawals", name: "GET withdrawals", method: "GET", path: "/api/v1/payments/withdrawals",
          desc: "Admin lista solicitudes de retiro de profesores",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/payments/withdrawals", undefined, adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "materials", name: "Materiales", emoji: "📚", color: "#3fb950",
      tests: [
        { id: "mat-list", name: "GET /materials/", method: "GET", path: "/api/v1/materials/",
          desc: "Profesor lista sus materiales",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/materials/", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "mat-create", name: "POST /materials/", method: "POST", path: "/api/v1/materials/",
          desc: "Crea material de tipo vocabulario",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/materials/", { title: `Test Material ${S.testSuffix}`, description: "Test auto", material_type: "vocabulary" }, S.teacherToken || adminToken);
            if (d(r)?.id) S.materialId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Tiene id", !!d(r)?.id)]);
          } },

        { id: "mat-vocab", name: "POST vocabulario", method: "POST", path: "/api/v1/materials/{id}/vocabulary",
          desc: "Agrega palabras de vocabulario al material",
          run: async () => {
            if (!S.materialId) return skip("Requiere material creado");
            const r = await httpReq("POST", `/api/v1/materials/${S.materialId}/vocabulary`, { words: [{ word: "hello", translation: "hola", example: "Hello world" }] }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "mat-assign", name: "POST assign material", method: "POST", path: "/api/v1/materials/{id}/assign",
          desc: "Asigna material al estudiante temporal",
          run: async () => {
            if (!S.materialId || !S.studentId) return skip("Requiere materialId y studentId");
            const r = await httpReq("POST", `/api/v1/materials/${S.materialId}/assign`, { student_ids: [S.studentId] }, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },

        { id: "mat-student-list", name: "GET materiales del estudiante", method: "GET", path: "/api/v1/materials/student/my",
          desc: "Estudiante ve sus materiales asignados",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/materials/student/my", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },
      ],
    },

    {
      id: "homework", name: "Tareas", emoji: "📝", color: "#ffa657",
      tests: [
        { id: "hw-create", name: "POST /homework/", method: "POST", path: "/api/v1/homework/",
          desc: "Profesor crea tarea y la asigna al estudiante temporal",
          run: async () => {
            if (!S.studentId) return skip("Requiere studentId del registro");
            const due = new Date(); due.setDate(due.getDate() + 7);
            const r = await httpReq("POST", "/api/v1/homework/", { title: `Tarea ${S.testSuffix}`, description: "Test auto", due_date: due.toISOString(), student_ids: [S.studentId] }, S.teacherToken || adminToken);
            if (d(r)?.id) S.homeworkId = String(d(r).id);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201), mk("Tiene id", !!d(r)?.id)]);
          } },

        { id: "hw-list-teacher", name: "GET tareas del profesor", method: "GET", path: "/api/v1/homework/teacher/my",
          desc: "Profesor lista todas sus tareas",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/homework/teacher/my", undefined, S.teacherToken || adminToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "hw-list-student", name: "GET tareas del estudiante", method: "GET", path: "/api/v1/homework/student/my",
          desc: "Estudiante lista sus tareas pendientes",
          run: async () => {
            const r = await httpReq("GET", "/api/v1/homework/student/my", undefined, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200)]);
          } },

        { id: "hw-submit", name: "POST submit tarea", method: "POST", path: "/api/v1/homework/student/{id}/submit",
          desc: "Estudiante entrega su tarea",
          run: async () => {
            if (!S.homeworkId) return skip("Requiere tarea creada");
            const r = await httpReq("POST", `/api/v1/homework/student/${S.homeworkId}/submit`, { submission_text: "Respuesta de test automatizado." }, S.studentToken);
            return ok(r, [mk("Status 200/201", r.status === 200 || r.status === 201)]);
          } },
      ],
    },

    {
      id: "admin", name: "Panel Admin", emoji: "🛡️", color: "#f85149",
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
      id: "calendar", name: "Google Calendar", emoji: "📆", color: "#58a6ff",
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
            return ok(r, [mk("Status 200", r.status === 200), mk("URL contiene google.com", typeof (d(r))?.auth_url === "string" && String(d(r)?.auth_url).includes("google.com"))]);
          } },
      ],
    },

    {
      id: "chipi", name: "Chipi AI", emoji: "🤖", color: "#bc8cff",
      tests: [
        { id: "chi-student", name: "POST /chipi/chat (estudiante)", method: "POST", path: "/api/v1/chipi/chat",
          desc: "Chipi responde con contexto de pantalla del estudiante",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/chipi/chat", { message: "Hola, ¿qué puedo hacer aquí?", screen_name: "dashboard", history: [], stream: false }, S.studentToken);
            return ok(r, [mk("Status 200", r.status === 200), mk("Tiene respuesta", !!d(r)?.response || !!d(r)?.message || !!d(r)?.content)]);
          } },

        { id: "chi-public", name: "POST /chipi/chat (sin auth)", method: "POST", path: "/api/v1/chipi/chat",
          desc: "Chipi en landing sin JWT — debe responder o dar 401",
          run: async () => {
            const r = await httpReq("POST", "/api/v1/chipi/chat", { message: "¿Cómo funciona?", screen_name: "landing", history: [], stream: false }, null);
            return ok(r, [mk("Status 200 o 401", r.status === 200 || r.status === 401), mk("No 500", r.status !== 500)]);
          } },
      ],
    },
  ];
}

// ─── VISUAL CONSTANTS ─────────────────────────────────────────────────────────
const SC: Record<string, string> = { pass: "#3fb950", fail: "#f85149", warn: "#d29922", running: "#58a6ff", pending: "#484f58", skipped: "#6e7681" };
const SL: Record<string, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", running: "...", pending: "—", skipped: "SKIP" };
const MC: Record<string, string> = { GET: "#58a6ff", POST: "#3fb950", PATCH: "#d29922", DELETE: "#f85149" };

function syntaxHL(obj: unknown): string {
  if (obj === null || obj === undefined) return '<span style="color:#6e7681">null</span>';
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"]+)":/g, '<span style="color:#79c0ff">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span style="color:#a5d6ff">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span style="color:#ffa657">$1</span>')
    .replace(/: (true|false)/g, ': <span style="color:#ff7b72">$1</span>');
}

async function geminiAnalyze(test: { name: string; method: string; path: string; desc: string }, result: TestResult) {
  if (!GEMINI_KEY || result.status === "pass" || result.status === "skipped") return null;
  const prompt = `QA engineer experto en FastAPI + Next.js. Test fallido en TPMH.
Test: ${test.name} | ${test.method} ${test.path}
HTTP: ${result.response?.status ?? 0} | Error: ${result.response?.error ?? "none"}
Response: ${JSON.stringify(result.response?.data)?.slice(0, 400)}
Assertions fallidas: ${result.assertions.filter(a => !a.pass).map(a => a.name).join(", ")}
Responde SOLO en JSON sin markdown: {"root_cause":"frase corta","issues":["máx 2"],"fix":["máx 2 soluciones"]}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 256 } }),
    });
    const data = await res.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function CodeBlock({ label, code, color }: { label: string; code: unknown; color?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: color ?? "#484f58", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div>
      <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "#8b949e", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6, maxHeight: 280, overflowY: "auto" }}
        dangerouslySetInnerHTML={{ __html: syntaxHL(code) }} />
    </div>
  );
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: primary ? (disabled ? "#21262d" : "#238636") : "transparent", border: primary ? "none" : "1px solid #30363d", color: primary ? "#fff" : "#8b949e", padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: primary ? 700 : 400, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "flex", alignItems: "center", gap: 5 }}>
      {children}
    </button>
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
      if (GEMINI_KEY && r.status !== "pass") {
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
      return r ? `<tr><td>${su?.emoji} ${su?.name}</td><td>${t.name}</td><td style="color:${MC[t.method]}">${t.method}</td><td>${r.response?.status ?? "—"}</td><td>${r.response?.timing ?? 0}ms</td><td style="color:${SC[r.status]};font-weight:700">${SL[r.status]}</td><td style="color:#8b949e;font-size:11px">${r.assertions.filter(a => !a.pass).map(a => a.name).join(", ") || "—"}</td></tr>` : "";
    }).join("");
    const g = { pass: Object.values(results).filter(r => r.status === "pass").length, fail: Object.values(results).filter(r => r.status === "fail").length, warn: Object.values(results).filter(r => r.status === "warn").length };
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TPMH Test Report</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;margin:0}h1{font-size:20px;font-weight:800}p{color:#8b949e;margin-bottom:24px}.s{display:flex;gap:12px;margin-bottom:24px}.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 18px}.sv{font-size:24px;font-weight:700;font-family:monospace}.sl{font-size:10px;color:#8b949e;margin-top:2px}table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}th{padding:9px 12px;text-align:left;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;font-weight:700;text-transform:uppercase}td{padding:8px 12px;border-bottom:1px solid #21262d;font-size:12px}</style></head><body><h1>🧪 TPMH Flow Tester</h1><p>${new Date().toLocaleString()} · ${BASE_URL}</p><div class="s"><div class="sc"><div class="sv">${allTests.length}</div><div class="sl">Total</div></div><div class="sc"><div class="sv" style="color:#3fb950">${g.pass}</div><div class="sl">Pasaron</div></div><div class="sc"><div class="sv" style="color:#f85149">${g.fail}</div><div class="sl">Fallaron</div></div><div class="sc"><div class="sv" style="color:#d29922">${g.warn}</div><div class="sl">Warnings</div></div></div><table><thead><tr><th>Suite</th><th>Test</th><th>Método</th><th>HTTP</th><th>Timing</th><th>Resultado</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = `tpmh-report-${Date.now()}.html`; a.click();
  };

  const currentSuite = suites.find(s => s.id === activeSuite)!;
  const selectedResult = selectedTest ? results[selectedTest] : null;
  const selectedTestData = selectedTest ? allTests.find(t => t.id === selectedTest) : null;
  const getSuiteStats = (suite: typeof currentSuite) => {
    const res = suite.tests.map(t => results[t.id]).filter(Boolean);
    return { pass: res.filter(r => r.status === "pass").length, fail: res.filter(r => r.status === "fail").length, warn: res.filter(r => r.status === "warn").length, done: res.length, total: suite.tests.length };
  };
  const gStats = { pass: Object.values(results).filter(r => r.status === "pass").length, fail: Object.values(results).filter(r => r.status === "fail").length, warn: Object.values(results).filter(r => r.status === "warn").length };

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", fontSize: 13, color: "#e6edf3", background: "#0d1117", height: "calc(100vh - 80px)", display: "grid", gridTemplateColumns: "220px 1fr 340px", gridTemplateRows: "48px 1fr", overflow: "hidden", borderRadius: 12, border: "1px solid #21262d" }}>

      {/* ── TOPBAR ──────────────────────────────────────────────────────────── */}
      <div style={{ gridColumn: "1/-1", background: "#161b22", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderRadius: "12px 12px 0 0" }}>
        <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: -0.3 }}>TPMH <span style={{ color: "#58a6ff" }}>Tester</span></span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#1f6feb22", color: "#58a6ff", border: "1px solid #1f6feb55", fontWeight: 700 }}>FUNCTIONAL</span>
        <div style={{ width: 1, height: 20, background: "#30363d" }} />

        {/* Teacher username pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#484f58" }}>Profesor:</span>
          {editingUsername ? (
            <input autoFocus value={teacherUsername} onChange={e => setTeacherUsername(e.target.value)}
              onBlur={() => setEditingUsername(false)} onKeyDown={e => e.key === "Enter" && setEditingUsername(false)}
              style={{ background: "#0d1117", border: "1px solid #58a6ff", color: "#e6edf3", padding: "2px 8px", borderRadius: 6, fontSize: 12, fontFamily: "monospace", outline: "none", width: 120 }} />
          ) : (
            <button onClick={() => setEditingUsername(true)} style={{ background: "#1f6feb22", border: "1px solid #1f6feb55", color: "#58a6ff", padding: "2px 10px", borderRadius: 99, fontSize: 11, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>
              @{teacherUsername} ✎
            </button>
          )}
        </div>

        {progress > 0 && progress < 100 && (
          <div style={{ flex: 1, height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden", maxWidth: 160 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "#58a6ff", transition: "width 0.3s" }} />
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {gStats.pass > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#3fb950" }}>✓ {gStats.pass}</span>}
          {gStats.fail > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#f85149" }}>✕ {gStats.fail}</span>}
          {gStats.warn > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#d29922" }}>⚠ {gStats.warn}</span>}
          <Btn onClick={clearAll} disabled={isRunning}>↺ Limpiar</Btn>
          <Btn onClick={exportReport} disabled={Object.keys(results).length === 0}>↓ Reporte</Btn>
          <Btn onClick={runAll} disabled={isRunning} primary>{isRunning ? `▶ ${progress}%` : "▶ Ejecutar todo"}</Btn>
        </div>
      </div>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div style={{ background: "#161b22", borderRight: "1px solid #30363d", overflowY: "auto", padding: "8px 6px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 0.8, padding: "8px 8px 4px", textTransform: "uppercase" }}>Suites</div>
        {suites.map(suite => {
          const st = getSuiteStats(suite);
          const isActive = activeSuite === suite.id;
          const color = st.fail > 0 ? "#f85149" : st.warn > 0 ? "#d29922" : st.pass === st.total && st.done > 0 ? "#3fb950" : "#484f58";
          return (
            <div key={suite.id} onClick={() => setActiveSuite(suite.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 7, cursor: "pointer", background: isActive ? "#1f6feb22" : "transparent", marginBottom: 2, transition: "background 0.1s" }}>
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{suite.emoji}</span>
              <span style={{ flex: 1, fontSize: 12, color: isActive ? "#58a6ff" : "#8b949e", fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{suite.name}</span>
              {st.done > 0 && <span style={{ fontSize: 10, fontWeight: 700, color }}>{st.fail > 0 ? `${st.fail}✕` : st.warn > 0 ? `${st.warn}⚠` : `${st.pass}✓`}</span>}
              <span style={{ fontSize: 10, color: "#484f58" }}>{st.done}/{st.total}</span>
            </div>
          );
        })}
      </div>

      {/* ── MAIN ────────────────────────────────────────────────────────────── */}
      <div style={{ overflowY: "auto", background: "#0d1117" }}>
        <div style={{ position: "sticky", top: 0, background: "#0d1117", borderBottom: "1px solid #21262d", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 700 }}>
            <span>{currentSuite.emoji}</span><span style={{ color: currentSuite.color }}>{currentSuite.name}</span>
          </div>
          <button onClick={() => runSuite(activeSuite)} disabled={isRunning}
            style={{ background: "transparent", border: `1px solid ${currentSuite.color}`, color: currentSuite.color, padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: isRunning ? "not-allowed" : "pointer", opacity: isRunning ? 0.5 : 1 }}>
            ▶ Ejecutar suite
          </button>
        </div>

        {/* Suite stats */}
        {(() => {
          const st = getSuiteStats(currentSuite);
          if (!st.done) return null;
          const timings = currentSuite.tests.map(t => results[t.id]?.response?.timing).filter((n): n is number => typeof n === "number");
          const avg = timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "12px 16px" }}>
              {[{ v: `${st.pass}/${st.total}`, l: "Pasaron", c: st.pass === st.total ? "#3fb950" : "#e6edf3" }, { v: st.fail, l: "Fallaron", c: st.fail > 0 ? "#f85149" : "#484f58" }, { v: st.warn, l: "Warnings", c: st.warn > 0 ? "#d29922" : "#484f58" }, { v: `${avg}ms`, l: "Latencia", c: avg < 500 ? "#3fb950" : avg < 1500 ? "#d29922" : "#f85149" }]
                .map(({ v, l, c }) => (
                  <div key={l} style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: c }}>{v}</div>
                    <div style={{ fontSize: 10, color: "#484f58", marginTop: 2, textTransform: "uppercase", letterSpacing: .4 }}>{l}</div>
                  </div>
                ))}
            </div>
          );
        })()}

        {/* Test cards */}
        <div style={{ padding: "0 12px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          {currentSuite.tests.map(test => {
            const r = results[test.id];
            const st = r?.status ?? "pending";
            const isSelected = selectedTest === test.id;
            return (
              <div key={test.id} onClick={() => { setSelectedTest(test.id); setActiveTab("response"); }}
                style={{ background: "#161b22", border: `1px solid ${isSelected ? "#58a6ff" : st === "fail" ? "#f8514933" : st === "pass" ? "#3fb95022" : "#21262d"}`, borderLeft: `3px solid ${SC[st]}`, borderRadius: 8, cursor: "pointer", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: `${SC[st]}22`, color: SC[st], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, animation: st === "running" ? "tpmh-spin 0.8s linear infinite" : "none" }}>
                    {st === "pass" ? "✓" : st === "fail" ? "✕" : st === "warn" ? "⚠" : st === "running" ? "◌" : st === "skipped" ? "⏭" : "○"}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{test.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${MC[test.method]}22`, color: MC[test.method] }}>{test.method}</span>
                  {r?.response?.status ? <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: r.response.status < 300 ? "#3fb950" : r.response.status < 500 ? "#d29922" : "#f85149" }}>{r.response.status}</span> : null}
                  {r?.response?.timing ? <span style={{ fontSize: 10, color: "#484f58", fontFamily: "monospace", minWidth: 44, textAlign: "right" }}>{r.response.timing}ms</span> : null}
                  <button onClick={e => { e.stopPropagation(); runTest({ ...test, suiteId: activeSuite }); }} disabled={isRunning}
                    style={{ background: "transparent", border: "1px solid #30363d", color: "#8b949e", padding: "2px 8px", borderRadius: 5, fontSize: 11, cursor: isRunning ? "not-allowed" : "pointer", opacity: isRunning ? 0.4 : 1 }}>▶</button>
                </div>
                <div style={{ padding: "0 14px 8px", fontSize: 11, color: "#6e7681" }}>{test.desc}</div>
                {r && !["pending", "running"].includes(r.status) && (
                  <div style={{ padding: "0 14px 10px", fontSize: 11, fontWeight: 600, color: SC[r.status] }}>
                    {r.status === "pass" || r.status === "skipped" ? r.assertions[0]?.name ?? "✓" : r.assertions.filter(a => !a.pass).map(a => a.name).join(" · ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── INSPECTOR ───────────────────────────────────────────────────────── */}
      <div style={{ background: "#161b22", borderLeft: "1px solid #30363d", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "0 0 12px 0" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#8b949e" }}>Inspector</span>
          {selectedResult && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: `${SC[selectedResult.status]}22`, color: SC[selectedResult.status], border: `1px solid ${SC[selectedResult.status]}55` }}>
              {SL[selectedResult.status]}
            </span>
          )}
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid #30363d", flexShrink: 0 }}>
          {(["response", "request", "assertions", "ai"] as const).map(tab => (
            <div key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: activeTab === tab ? "#58a6ff" : "#484f58", borderBottom: `2px solid ${activeTab === tab ? "#58a6ff" : "transparent"}`, fontWeight: activeTab === tab ? 600 : 400 }}>
              {tab === "ai" ? "✦ IA" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {!selectedResult ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, color: "#484f58", gap: 8 }}>
              <span style={{ fontSize: 28 }}>🔍</span>
              <span style={{ fontSize: 12 }}>Selecciona un test para inspeccionar</span>
            </div>
          ) : activeTab === "response" ? (
            <>
              <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#484f58", marginBottom: 4, textTransform: "uppercase", letterSpacing: .5 }}>Status</div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "monospace", color: !selectedResult.response?.status ? "#484f58" : selectedResult.response.status < 300 ? "#3fb950" : selectedResult.response.status < 500 ? "#d29922" : "#f85149" }}>
                    {selectedResult.response?.status || (selectedResult.response?.error ? "ERR" : "—")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#484f58", marginBottom: 4, textTransform: "uppercase", letterSpacing: .5 }}>Timing</div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "monospace", color: "#58a6ff" }}>{selectedResult.response?.timing ?? 0}ms</div>
                </div>
              </div>
              {selectedResult.response?.error && <CodeBlock label="Error de conexión" code={selectedResult.response.error} color="#f85149" />}
              <CodeBlock label="Response Body" code={selectedResult.response?.data} />
            </>
          ) : activeTab === "request" ? (
            <>
              <CodeBlock label="Endpoint" code={`${selectedResult.request?.method} ${selectedResult.request?.url}`} />
              {selectedResult.request?.body && <CodeBlock label="Request Body" code={selectedResult.request.body} />}
              <CodeBlock label="Headers" code={selectedResult.request?.headers} />
            </>
          ) : activeTab === "assertions" ? (
            <div>
              {selectedResult.assertions.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderBottom: i < selectedResult.assertions.length - 1 ? "1px solid #21262d" : "none" }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%", background: a.pass ? "#23863633" : "#da363022", color: a.pass ? "#3fb950" : "#f85149", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                    {a.pass ? "✓" : "✕"}
                  </span>
                  <span style={{ fontSize: 11, color: "#8b949e" }}>{a.name}</span>
                </div>
              ))}
            </div>
          ) : !GEMINI_KEY ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 160, color: "#484f58", gap: 8, textAlign: "center", padding: "0 16px" }}>
              <span style={{ fontSize: 22 }}>✦</span>
              <span style={{ fontSize: 12 }}>Agrega <code>NEXT_PUBLIC_GEMINI_API_KEY</code> en tu <code>.env</code> para análisis IA de fallos</span>
            </div>
          ) : !selectedResult.aiAnalysis ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 160, color: "#484f58", gap: 8 }}>
              <span style={{ fontSize: 22 }}>✦</span>
              <span style={{ fontSize: 12 }}>{selectedResult.status === "pass" ? "Test pasó — sin análisis" : "Analizando con Gemini..."}</span>
            </div>
          ) : (
            <div>
              <div style={{ background: "#bc8cff11", border: "1px solid #bc8cff33", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#bc8cff", marginBottom: 8, textTransform: "uppercase", letterSpacing: .5 }}>✦ Análisis Gemini</div>
                <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }}><span style={{ color: "#e6edf3", fontWeight: 600 }}>Causa raíz: </span>{selectedResult.aiAnalysis.root_cause}</div>
                {selectedResult.aiAnalysis.issues?.map((iss, i) => <div key={i} style={{ display: "flex", gap: 7, fontSize: 11, color: "#8b949e", marginBottom: 4 }}><span style={{ color: "#f85149" }}>▸</span>{iss}</div>)}
              </div>
              <div style={{ fontSize: 10, color: "#484f58", marginBottom: 8, textTransform: "uppercase", letterSpacing: .5, fontWeight: 700 }}>Soluciones sugeridas</div>
              {selectedResult.aiAnalysis.fix?.map((f, i) => <div key={i} style={{ display: "flex", gap: 7, fontSize: 11, color: "#8b949e", marginBottom: 6 }}><span style={{ color: "#3fb950" }}>→</span>{f}</div>)}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes tpmh-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}