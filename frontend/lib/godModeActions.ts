// Registro declarativo de todas las acciones del Modo Dios.
//
// En vez de construir 13 pantallas separadas (una por endpoint), cada
// acción se describe acá como datos: qué campos pide, de qué tipo son,
// a qué endpoint y método pega. `GodModeActionRunner` lee este registro
// y arma el formulario dinámicamente. Agregar una acción nueva a futuro
// es agregar una entrada acá, no construir un componente nuevo.

export type GodModeFieldType = "number" | "text" | "textarea" | "select" | "checkbox" | "datetime";

export interface GodModeField {
  name: string;
  label: string;
  type: GodModeFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  /** Solo para type="number": si no se envía, el campo se omite del body (ajuste parcial) */
  optionalNumber?: boolean;
}

export interface GodModeAction {
  id: string;
  label: string;
  description: string;
  category: "Créditos y Paquetes" | "Cohortes" | "Clases" | "Pagos" | "Alumnos";
  method: "patch" | "post" | "delete";
  /** Construye la URL a partir de los valores de pathParams */
  buildUrl: (v: Record<string, string>) => string;
  pathParams: GodModeField[];
  bodyFields: GodModeField[];
  destructive?: boolean;
}

const STATUS_ENROLLMENT_OPTIONS = [
  { value: "active", label: "active" },
  { value: "completed", label: "completed" },
  { value: "cancelled", label: "cancelled" },
  { value: "pending_renewal", label: "pending_renewal" },
  { value: "pending_package_change", label: "pending_package_change" },
];

const STATUS_CLASS_OPTIONS = [
  "pending", "pending_trial", "pending_payment", "confirmed",
  "completed", "cancelled", "no_show", "rescheduled", "finalized",
].map(s => ({ value: s, label: s }));

const STATUS_PAYMENT_OPTIONS = [
  { value: "pending_review", label: "pending_review" },
  { value: "under_review", label: "under_review" },
  { value: "approved", label: "approved" },
  { value: "rejected", label: "rejected" },
];

export const GOD_MODE_ACTIONS: GodModeAction[] = [
  // ── Créditos y Paquetes ──────────────────────────────────────────
  {
    id: "enrollment.adjust",
    label: "Ajustar créditos / estado de un enrollment",
    description: "Cambia directamente unlocked_credits, classes_used, classes_total, payment_status o status. Solo se tocan los campos que llenes.",
    category: "Créditos y Paquetes",
    method: "patch",
    buildUrl: v => `/god-mode/enrollments/${v.enrollment_id}/adjust`,
    pathParams: [{ name: "enrollment_id", label: "ID del enrollment", type: "number", required: true }],
    bodyFields: [
      { name: "unlocked_credits", label: "Créditos disponibles", type: "number", optionalNumber: true },
      { name: "classes_used", label: "Clases usadas", type: "number", optionalNumber: true },
      { name: "classes_total", label: "Clases totales del paquete", type: "number", optionalNumber: true },
      { name: "prepaid_unlimited_credits", label: "Créditos ilimitados prepagados", type: "number", optionalNumber: true },
      { name: "installments_paid", label: "Cuotas pagadas", type: "number", optionalNumber: true },
      { name: "payment_status", label: "Estado de pago", type: "select", options: [
        { value: "unpaid", label: "unpaid" }, { value: "partially_paid", label: "partially_paid" }, { value: "paid", label: "paid" },
      ] },
      { name: "status", label: "Estado del enrollment", type: "select", options: STATUS_ENROLLMENT_OPTIONS },
    ],
  },
  {
    id: "enrollment.change_package",
    label: "Cambiar de paquete (instantáneo, sin pago)",
    description: "Asigna un paquete nuevo al enrollment saltándose el flujo de pago. El paquete debe ser del mismo profesor y no puede ser grupal.",
    category: "Créditos y Paquetes",
    method: "post",
    buildUrl: v => `/god-mode/enrollments/${v.enrollment_id}/change-package`,
    pathParams: [{ name: "enrollment_id", label: "ID del enrollment", type: "number", required: true }],
    bodyFields: [
      { name: "new_package_id", label: "ID del paquete nuevo", type: "number", required: true },
      { name: "reset_classes_used", label: "Reiniciar clases usadas a 0", type: "checkbox" },
    ],
  },
  // ── Cohortes ──────────────────────────────────────────────────────
  {
    id: "enrollment.move_cohort",
    label: "Mover alumno a otra cohorte / a individual",
    description: "Cambia al alumno de cohorte (mismo profesor) o lo convierte a individual si dejas la cohorte destino vacía.",
    category: "Cohortes",
    method: "post",
    buildUrl: v => `/god-mode/enrollments/${v.enrollment_id}/move-cohort`,
    pathParams: [{ name: "enrollment_id", label: "ID del enrollment", type: "number", required: true }],
    bodyFields: [
      { name: "new_cohort_id", label: "ID de la cohorte destino (vacío = individual)", type: "number", optionalNumber: true },
      { name: "force", label: "Forzar aunque no haya cupo", type: "checkbox" },
      { name: "reset_classes_used", label: "Reiniciar clases usadas a 0", type: "checkbox" },
    ],
  },
  {
    id: "cohort.edit",
    label: "Editar cupos / fecha de una cohorte",
    description: "Edita min/max de alumnos o la fecha de inicio de una cohorte ya creada.",
    category: "Cohortes",
    method: "patch",
    buildUrl: v => `/god-mode/cohorts/${v.cohort_id}`,
    pathParams: [{ name: "cohort_id", label: "ID de la cohorte", type: "number", required: true }],
    bodyFields: [
      { name: "min_students", label: "Mínimo de alumnos", type: "number", optionalNumber: true },
      { name: "max_students", label: "Máximo de alumnos", type: "number", optionalNumber: true },
      { name: "start_date", label: "Fecha de inicio", type: "datetime" },
    ],
  },
  {
    id: "cohort.reopen",
    label: "Reabrir cohorte cancelada / completada",
    description: "Devuelve la cohorte a 'filling' (acepta inscripciones) o 'confirmed'. No revive enrollments/clases ya canceladas.",
    category: "Cohortes",
    method: "post",
    buildUrl: v => `/god-mode/cohorts/${v.cohort_id}/reopen`,
    pathParams: [{ name: "cohort_id", label: "ID de la cohorte", type: "number", required: true }],
    bodyFields: [
      { name: "new_status", label: "Nuevo estado", type: "select", options: [
        { value: "filling", label: "filling (vuelve a aceptar inscripciones)" },
        { value: "confirmed", label: "confirmed (fecha ya fija)" },
      ] },
    ],
  },
  // ── Clases ────────────────────────────────────────────────────────
  {
    id: "class.create",
    label: "Crear clase manualmente",
    description: "Crea una clase individual (regular/trial) para cualquier profesor y alumno, sin pasar por su disponibilidad declarada.",
    category: "Clases",
    method: "post",
    buildUrl: () => `/god-mode/classes`,
    pathParams: [],
    bodyFields: [
      { name: "teacher_id", label: "ID del profesor", type: "number", required: true },
      { name: "student_id", label: "ID del alumno", type: "number", required: true },
      { name: "start_time_utc", label: "Fecha y hora (UTC)", type: "datetime", required: true },
      { name: "duration_minutes", label: "Duración (minutos)", type: "number", required: true },
      { name: "class_type", label: "Tipo", type: "select", options: [
        { value: "regular", label: "regular" }, { value: "trial", label: "trial" },
      ] },
      { name: "subject", label: "Materia (opcional)", type: "text" },
      { name: "enrollment_id", label: "ID del enrollment (opcional)", type: "number", optionalNumber: true },
      { name: "status", label: "Estado inicial", type: "select", options: STATUS_CLASS_OPTIONS },
      { name: "notes", label: "Notas (opcional)", type: "text" },
      { name: "skip_conflict_check", label: "Saltar chequeo de choque de horario", type: "checkbox" },
    ],
  },
  {
    id: "class.reschedule",
    label: "Reagendar clase sin restricciones",
    description: "Reagenda cualquier clase, incluso fuera de la antelación mínima normal.",
    category: "Clases",
    method: "patch",
    buildUrl: v => `/god-mode/classes/${v.class_id}/reschedule`,
    pathParams: [{ name: "class_id", label: "ID de la clase", type: "number", required: true }],
    bodyFields: [
      { name: "start_time_utc", label: "Nueva fecha y hora (UTC)", type: "datetime", required: true },
      { name: "duration_minutes", label: "Nueva duración (opcional)", type: "number", optionalNumber: true },
      { name: "skip_conflict_check", label: "Saltar chequeo de choque de horario", type: "checkbox" },
    ],
  },
  {
    id: "class.force_status",
    label: "Forzar estado de una clase",
    description: "Cambia el estado de cualquier clase sin la ventana de 72h. Ajusta el crédito del enrollment automáticamente si corresponde.",
    category: "Clases",
    method: "patch",
    buildUrl: v => `/god-mode/classes/${v.class_id}/force-status`,
    pathParams: [{ name: "class_id", label: "ID de la clase", type: "number", required: true }],
    bodyFields: [
      { name: "status", label: "Nuevo estado", type: "select", required: true, options: STATUS_CLASS_OPTIONS },
      { name: "notes", label: "Notas (opcional)", type: "text" },
    ],
  },
  {
    id: "class.hard_delete",
    label: "Eliminar clase permanentemente",
    description: "Borra la clase por completo (no es una cancelación). No reembolsa crédito automáticamente. No aplica a sesiones grupales.",
    category: "Clases",
    method: "delete",
    buildUrl: v => `/god-mode/classes/${v.class_id}`,
    pathParams: [{ name: "class_id", label: "ID de la clase", type: "number", required: true }],
    bodyFields: [],
    destructive: true,
  },
  // ── Pagos ─────────────────────────────────────────────────────────
  {
    id: "payment.edit",
    label: "Editar un pago registrado",
    description: "Corrige monto y/o estado de un Payment ya cargado. Ajusta la billetera del profesor automáticamente si el pago ya estaba aprobado.",
    category: "Pagos",
    method: "patch",
    buildUrl: v => `/god-mode/payments/${v.payment_id}`,
    pathParams: [{ name: "payment_id", label: "ID del pago", type: "number", required: true }],
    bodyFields: [
      { name: "amount_total", label: "Monto total corregido", type: "number", optionalNumber: true },
      { name: "status", label: "Nuevo estado", type: "select", options: STATUS_PAYMENT_OPTIONS },
      { name: "rejection_reason", label: "Motivo de rechazo (si aplica)", type: "text" },
      { name: "transaction_id", label: "ID de transacción (opcional)", type: "text" },
    ],
  },
  // ── Alumnos ───────────────────────────────────────────────────────
  {
    id: "student.transfer_teacher",
    label: "Transferir alumno a otro profesor",
    description: "Mueve al alumno a otro profesor: enrollments individuales activos y clases futuras. Solo superadmin. No corrige el paquete asignado — hazlo después con 'Cambiar de paquete'.",
    category: "Alumnos",
    method: "post",
    buildUrl: v => `/god-mode/students/${v.student_id}/transfer-teacher`,
    pathParams: [{ name: "student_id", label: "ID del alumno", type: "number", required: true }],
    bodyFields: [
      { name: "from_teacher_id", label: "ID del profesor actual", type: "number", required: true },
      { name: "to_teacher_id", label: "ID del profesor destino", type: "number", required: true },
      { name: "remove_old_link", label: "Eliminar vínculo con el profesor actual", type: "checkbox" },
    ],
    destructive: true,
  },
];

export const GOD_MODE_CATEGORIES = [
  "Créditos y Paquetes", "Cohortes", "Clases", "Pagos", "Alumnos",
] as const;
