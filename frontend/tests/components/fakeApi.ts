/**
 * API simulada para los tests de pantallas. Sustituye a `@/lib/api` (ver setup.ts): ninguna prueba toca la red.
 *
 * - Cada petición se resuelve contra una lista de manejadores. Gana el último registrado con `mockApi`;
 *   si ninguno coincide, se usan los de `DEFAULTS` y, por último, un vacío razonable (GET -> lista vacía,
 *   escritura -> objeto vacío). Así una pantalla siempre se pinta con "sin datos" aunque el test no declare nada.
 * - Se guardan todas las llamadas en `apiCalls` para afirmar que una acción llegó al endpoint correcto.
 */
export type Method = "get" | "post" | "put" | "patch" | "delete";
export interface ApiRequest {
  method: Method;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
}
export type Handler = unknown | ((req: ApiRequest) => unknown);

interface Rule {
  method: Method | "*";
  pattern: RegExp;
  handler: Handler;
}

export const apiCalls: ApiRequest[] = [];
let overrides: Rule[] = [];

const toRegExp = (p: string | RegExp) =>
  p instanceof RegExp ? p : new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+") + "(\\?.*)?$");

/** Registra la respuesta de un endpoint. `*` en un string casa un segmento (`/teachers/*`). */
export function mockApi(method: Method | "*", pattern: string | RegExp, handler: Handler) {
  overrides.push({ method, pattern: toRegExp(pattern), handler });
}

/** Hace fallar un endpoint con el estado y el `detail` dados (formato de error de FastAPI). */
export function mockApiError(method: Method | "*", pattern: string | RegExp, status: number, detail: unknown) {
  mockApi(method, pattern, () => {
    throw Object.assign(new Error(`HTTP ${status}`), {
      isAxiosError: true,
      response: { status, data: { detail }, headers: {} },
    });
  });
}

export function resetApi() {
  overrides = [];
  apiCalls.length = 0;
}

export function callsTo(method: Method, pattern: string | RegExp) {
  const re = toRegExp(pattern);
  return apiCalls.filter((c) => c.method === method && re.test(c.url));
}

const now = new Date("2026-11-23T15:00:00Z");
const iso = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 3600_000).toISOString();

export const FIXTURE = {
  platformConfig: {
    platform_name: "TPM Test",
    single_tenant: false,
    featured_teacher: { username: "profe", name: "Profe", surname: "Uno" },
    currency: "USD",
    chat_enabled: true,
    support_email: "soporte@example.com",
    // Forma completa de /admin/platform-config (la pantalla de ajustes lee estos campos sin guardas).
    platform_tagline: null,
    is_single_tenant: false,
    show_teacher_whatsapp: false,
    chat_retention_days: 30,
    chat_reactivation_hours: 24,
    landing_content: {} as Record<string, unknown>, // lo rellena setup.ts (evita un import circular con @/lib/api)
  },
  adminStats: {
    total_users: 10, total_students: 7, total_teachers: 3, total_teachers_pending: 1, total_teachers_approved: 2,
    total_classes: 40, classes_this_month: 12, classes_completed: 30, classes_cancelled: 4, total_revenue: 1250.5,
    total_paid_to_teachers: 900, total_platform_earnings: 350.5, pending_withdrawals: 1, new_users_this_week: 2,
    new_classes_this_week: 5,
  },
  teacher: {
    id: 7, username: "profe", name: "Profe", surname: "Uno", email: "profe@example.com", role: "teacher",
    bio: "Profe de prueba", title: "Profesora de español", rating: 4.8, reviews_count: 3, languages: ["es"],
    nationality: "VE", timezone: "America/Caracas", status: "approved", video_url: null, spoken_languages: [],
    hourly_rate: 20, is_featured: true, avatar_url: null,
  },
  enrollment: {
    id: 11, student_id: 1, teacher_id: 7, package_id: 3, status: "active", classes_total: 8, classes_used: 2,
    classes_remaining: 6, package_name: "Pack 8", teacher_username: "profe", teacher_name: "Profe Uno",
    class_type: "individual", duration_minutes: 50, price: 120, payment_status: "paid",
  },
  classItem: {
    id: 21, enrollment_id: 11, status: "confirmed", start_time_utc: iso(26), end_time_utc: iso(27), duration_minutes: 50,
    teacher_name: "Profe Uno", teacher_username: "profe", student_name: "Alumno Uno", student_username: "alumno",
    class_type: "individual", meet_link: null, is_trial: false,
  },
  package: {
    id: 3, name: "Pack 8", classes_count: 8, price: 120, duration_minutes: 50, class_type: "individual",
    is_active: true, teacher_id: 7, description: "Paquete de prueba",
  },
  homework: {
    id: 31, title: "Tarea 1", description: "Hacer ejercicios", due_date_utc: iso(48), status: "pending",
    teacher_name: "Profe Uno", student_name: "Alumno Uno", created_at: iso(-24),
  },
  material: {
    id: 41, title: "Vocabulario", category: "vocabulary", level: "A1", content: "hola", tags: { words: ["hola"] },
    teacher_id: 7, created_at: iso(-48), file_url: null,
  },
  ticket: {
    id: 51, category: "question", subject: "Duda", message: "Hola", screen_context: "/dashboard", status: "pending",
    admin_response: null, created_at: iso(-5), resolved_at: null, user_notified_seen: false,
  },
};

export function makeUser(role: "student" | "teacher" | "teacher_admin" | "superadmin") {
  const base = {
    id: role === "student" ? 1 : role === "superadmin" ? 99 : 7,
    username: { student: "alumno", teacher: "profe", teacher_admin: "profeadmin", superadmin: "admin" }[role],
    name: "Test", surname: role, email: `${role}@example.com`, role,
    timezone: "America/Caracas", onboarding_completed: true, email_verified: true, spoken_languages: [],
    is_active: true, avatar_url: null, nationality: "VE", phone_number: "+58000000000",
  };
  return base;
}

/** Respuestas por defecto: lo mínimo que muchas pantallas esperan como objeto (no como lista). */
const DEFAULTS: Array<[Method, RegExp, Handler]> = [
  ["get", /^\/platform\/config|^\/public\/config|^\/payments\/config|^\/admin\/platform-config/, FIXTURE.platformConfig],
  ["get", /^\/users\/me\/student-profile/, { goal: "viajar", level: "A1", timezone: "America/Caracas", onboarding_completed: true }],
  ["get", /^\/teachers\/me\/profile/, FIXTURE.teacher],
  ["get", /^\/teachers\/[^/]+$/, FIXTURE.teacher],
  ["get", /^\/support\/tickets\/me\/unread-count/, { unread_count: 0 }],
  ["get", /^\/chat\/unread/, { unread_count: 0, count: 0 }],
  ["get", /^\/payments\/my-income/, { total: 0, rows: [] }],
  ["get", /^\/payments\/wallet|^\/payments\/my-wallet/, { balance: 0, currency: "USD" }],
  ["get", /^\/materials\/quota/, { used: 0, limit: 10 }],
  ["get", /^\/admin\/stats/, FIXTURE.adminStats],
  ["get", /^\/system-catalogs\/business-rules/, {
    min_booking_hours: 1, min_cancel_hours: 12, min_reschedule_hours_student: 12, allowed_class_durations: [50, 80, 110],
    allowed_package_durations: [50, 80, 110], low_credit_threshold: 1, low_credit_renotify_days: 6, trial_duration_minutes: 25,
    buffer_trial_minutes: 5, buffer_regular_minutes: 10, buffer_group_minutes: 10, meet_link_autogen_minutes: 30,
    min_classes_before_package_change: 0, min_withdrawal_amount: 10,
  }],
  ["get", /^\/payments\/booking-status/, { stage: "ready", enrollment_id: 11 }],
];

function resolve(req: ApiRequest): unknown {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const r = overrides[i];
    if ((r.method === "*" || r.method === req.method) && r.pattern.test(req.url)) {
      return typeof r.handler === "function" ? (r.handler as (q: ApiRequest) => unknown)(req) : r.handler;
    }
  }
  for (const [m, re, h] of DEFAULTS) {
    if (m === req.method && re.test(req.url)) return typeof h === "function" ? (h as (q: ApiRequest) => unknown)(req) : h;
  }
  return req.method === "get" ? [] : {};
}

async function request(method: Method, url: string, a?: unknown, b?: unknown) {
  // axios: get/delete(url, config) · post/put/patch(url, data, config)
  const hasBody = method === "post" || method === "put" || method === "patch";
  const body = hasBody ? a : undefined;
  const config = (hasBody ? b : a) as { params?: Record<string, unknown> } | undefined;
  const req: ApiRequest = { method, url, params: config?.params, body };
  apiCalls.push(req);
  const data = resolve(req);
  const total = Array.isArray(data) ? String(data.length) : undefined;
  return { data, status: 200, statusText: "OK", headers: total ? { "x-total-count": total } : {}, config: {} };
}

export const fakeApi = {
  get: (url: string, config?: unknown) => request("get", url, config),
  delete: (url: string, config?: unknown) => request("delete", url, config),
  post: (url: string, data?: unknown, config?: unknown) => request("post", url, data, config),
  put: (url: string, data?: unknown, config?: unknown) => request("put", url, data, config),
  patch: (url: string, data?: unknown, config?: unknown) => request("patch", url, data, config),
  request: (cfg: { method?: string; url: string; data?: unknown; params?: Record<string, unknown> }) =>
    request((cfg.method ?? "get").toLowerCase() as Method, cfg.url, cfg.data, { params: cfg.params }),
  defaults: { baseURL: "http://localhost:8000/api/v1", headers: { common: {} } },
  interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
};
