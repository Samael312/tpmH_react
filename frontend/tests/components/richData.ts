/**
 * Escenario "con datos": registra respuestas pobladas para los endpoints que consumen las pantallas, para ejercitar las
 * ramas con filas (tablas, tarjetas, contadores) y no solo el estado vacío. Las formas siguen a las interfaces de hooks/.
 */
import { mockApi, FIXTURE } from "./fakeApi";

const NOW = new Date("2026-11-23T15:00:00Z").getTime();
const iso = (h: number) => new Date(NOW + h * 3600_000).toISOString();

export const RICH = {
  packageInfo: { id: 3, name: "Pack 8", classes_count: 8, price: 120, duration_minutes: 50, class_type: "individual", is_group: false, subject: "Español" },
  enrollment(over: Record<string, unknown> = {}) {
    return {
      id: 11, package_id: 3, package: RICH.packageInfo, classes_used: 2, unlocked_credits: 8, classes_total: 8, prepaid_unlimited_credits: 0,
      available_credits: 6, status: "active", installments_paid: 1, paid_via_installments: false, total_installments: 1,
      payment_status: "paid", teacher_name: "Profe Uno", teacher_username: "profe", teacher_status: "approved", teacher_avatar: null,
      created_at: iso(-72), updated_at: iso(-1), cohort_id: null, student_name: "Alumno Uno", student_username: "alumno", ...over,
    };
  },
  studentClass(id: number, status: string, hours: number, over: Record<string, unknown> = {}) {
    return {
      id, class_type: "regular", enrollment_id: 11, subject: "Español", start_time_utc: iso(hours), end_time_utc: iso(hours + 1),
      duration_minutes: 50, status, meet_link: "https://meet.example.com/abc", teacher_avatar: null, teacher_name: "Profe Uno",
      teacher_username: "profe", teacher_nationality: "VE", package_name: "Pack 8", class_count: "3/8", teacher_phone: "+58000000000",
      cohort_id: null, participant_count: null, participant_names: null, student_reschedule_count: 0, reschedule_limit: 2,
      reschedules_remaining: 2, student_name: "Alumno Uno", student_username: "alumno", ...over,
    };
  },
  teacherListItem: {
    ...FIXTURE.teacher, user_username: "profe", profile_photo_url: null, languages: ["es", "en"], subjects: ["Español"], skills: ["DELE"],
    certificates: [{ title: "DELE C2", year: "2020" }], social_links: {}, average_rating: 4.8, review_count: 3, packages: [],
  },
  review: { id: 1, student_name: "Alumno Uno", rating: 5, comment: "Excelente", created_at: iso(-100), teacher_username: "profe" },
  homeworkAssignment: (id: number, status: string) => ({
    id, homework_id: id, student_id: 1, status, submission: status === "pending" ? null : "mi respuesta", submitted_at: status === "pending" ? null : iso(-3),
    score: status === "graded" ? 9 : null, feedback: status === "graded" ? "Muy bien" : null, graded_at: status === "graded" ? iso(-1) : null,
    assigned_at: iso(-24), student_name: "Alumno Uno", student_username: "alumno",
    homework: { id, teacher_id: 7, title: `Tarea ${id}`, description: "Hacer los ejercicios", due_date_utc: iso(48), is_active: true, created_at: iso(-24) },
  }),
  material: { ...FIXTURE.material, link_id: 1, material_id: 41, progress: "pending", teacher_name: "Profe Uno" },
  withdrawal: { id: 5, amount: 50, status: "pending", created_at: iso(-10), payment_method: "paypal", teacher_name: "Profe Uno", teacher_username: "profe" },
  pendingPayment: {
    payment_id: 9, payment_type: "enrollment", installment_index: null, student_name: "Alumno Uno", student_username: "alumno", amount: 120,
    payment_method: "zelle", payment_method_label: "Zelle", created_at: iso(-2), payment_expires_at: iso(20), package_name: "Pack 8",
    teacher_name: "Profe Uno", enrollment_id: 11,
  },
};

export function seedRichData() {
  const classes = [
    RICH.studentClass(21, "confirmed", 26),
    RICH.studentClass(22, "pending", 50, { class_type: "trial" }),
    RICH.studentClass(23, "completed", -30),
    RICH.studentClass(24, "cancelled", -60),
    RICH.studentClass(25, "confirmed", 74, { class_type: "group", cohort_id: 4, participant_count: 3, participant_names: ["Ana", "Luis", "Eva"] }),
  ];
  const enrollments = [RICH.enrollment(), RICH.enrollment({ id: 12, status: "pending_payment", payment_status: "pending" })];

  // ── alumno ──
  mockApi("get", "/classes/my-classes", classes);
  mockApi("get", "/packages/my-enrollments", enrollments);
  mockApi("get", "/packages/my-packages", [FIXTURE.package, { ...FIXTURE.package, id: 4, name: "Pack 16", classes_count: 16, price: 220 }]);
  mockApi("get", "/users/me/teachers", [RICH.teacherListItem]);
  mockApi("get", "/teachers/", [RICH.teacherListItem]);
  mockApi("get", "/teachers/profe", { ...RICH.teacherListItem, packages: [FIXTURE.package], availability: [] });
  mockApi("get", "/reviews/profe", [RICH.review]);
  // /homework/my-homework y /materials/my-materials los consume el PROFESOR (lista de lo que creó); el alumno usa /student/.
  mockApi("get", "/homework/my-homework", [
    { id: 31, teacher_id: 7, title: "Tarea 1", description: "Hacer ejercicios", due_date_utc: iso(48), is_active: true, created_at: iso(-24) },
    { id: 32, teacher_id: 7, title: "Tarea 2", description: "Leer un texto", due_date_utc: iso(-5), is_active: false, created_at: iso(-96) },
  ]);
  mockApi("get", "/homework/student/my-homework", [RICH.homeworkAssignment(31, "pending"), RICH.homeworkAssignment(33, "graded")]);
  mockApi("get", "/materials/my-materials", [
    { id: 41, title: "Vocabulario", description: "Lista de palabras", category: "vocabulary", level: "A1", file_url: null, file_type: null, created_at: iso(-48), vocabulary_words: ["hola", "adiós"] },
    { id: 42, title: "Gramática", description: null, category: "grammar", level: "B1", file_url: "https://files.example.com/g.pdf", file_type: "pdf", created_at: iso(-20), vocabulary_words: null },
  ]);
  mockApi("get", "/materials/student/my-materials", [RICH.material]);
  mockApi("get", "/payments/my-wallet", { balance: 35.5, currency: "USD", transactions: [] });
  mockApi("get", "/support/tickets/me", [FIXTURE.ticket, { ...FIXTURE.ticket, id: 52, status: "answered", admin_response: "Resuelto" }]);
  mockApi("get", "/users/me/preferences", [
    { day_of_week: 0, local_day_of_week: 0, start_time_utc: "22:00", end_time_utc: "23:00" },
    { day_of_week: 2, local_day_of_week: 2, start_time_utc: "21:00", end_time_utc: "22:00" },
  ]);
  mockApi("get", "/chat/conversations", [
    { id: 1, type: "direct", title: "Profe Uno", last_message: "Hola", last_message_at: iso(-1), unread_count: 2, participants: [] },
  ]);

  // ── profesor ──
  mockApi("get", "/classes/teacher/classes", classes);
  mockApi("get", "/teachers/me/students", [{ id: 1, user_id: 1, username: "alumno", name: "Alumno", surname: "Uno", email: "alumno@example.com", timezone: "America/Caracas" }]);
  mockApi("get", "/teachers/me/students-full", [{ id: 1, user_id: 1, username: "alumno", name: "Alumno", surname: "Uno", email: "alumno@example.com", enrollments: [RICH.enrollment()], classes_used: 2, classes_total: 8 }]);
  mockApi("get", "/packages/teacher/enrollments", enrollments);
  mockApi("get", "/cohorts/teacher", [
    { id: 4, name: "Grupo A", status: "confirmed", package_id: 3, min_students: 2, max_students: 6, member_count: 3, members: [], teacher_id: 7, start_date: iso(24) },
  ]);
  mockApi("get", "/payments/my-income", { total: 450, available: 120, pending: 30, rows: [] });
  mockApi("get", "/payments/my-withdrawals", [RICH.withdrawal]);
  mockApi("get", "/teachers/me/notifications", [{ id: 1, type: "class_booked", title: "Nueva clase", message: "Reservaron una clase", is_read: false, created_at: iso(-1) }]);
  mockApi("get", "/availability/me/weekly", []);
  mockApi("get", "/availability/me/exceptions", []);

  // ── admin ──
  mockApi("get", "/admin/teachers", [{ ...RICH.teacherListItem, id: 7, user_id: 7, status: "approved", email: "profe@example.com", is_active: true, balance: 120.5, commission_rate: 0.2 }]);
  mockApi("get", "/admin/users", { total: 2, active_count: 2, users: [
    { id: 1, username: "alumno", name: "Alumno", surname: "Uno", email: "a@example.com", role: "student", is_active: true, is_banned: false },
    { id: 7, username: "profe", name: "Profe", surname: "Uno", email: "p@example.com", role: "teacher", is_active: true, is_banned: false },
  ] });
  mockApi("get", "/admin/support-tickets", [{ ...FIXTURE.ticket, user_name: "Alumno Uno", user_role: "student" }]);
  mockApi("get", "/classes/admin/list", classes);
  mockApi("get", "/payments/pending-review", [RICH.pendingPayment]);
  mockApi("get", "/payments/admin/withdrawals/pending", [RICH.withdrawal]);
  mockApi("get", "/admin/notifications", [{ id: 1, type: "payment", title: "Pago pendiente", message: "Revisar", is_read: false, created_at: iso(-1) }]);
  mockApi("get", "/god-mode/lookup/teachers", [{ id: 7, username: "profe", name: "Profe", surname: "Uno" }]);
}
