// Registro declarativo de todas las acciones del Modo Dios.
//
// En vez de construir 13 pantallas separadas (una por endpoint), cada
// acción se describe acá como datos: qué campos pide, de qué tipo son,
// a qué endpoint y método pega. `GodModeActionRunner` lee este registro
// y arma el formulario dinámicamente, en el orden exacto del array
// `fields` (importa el orden: un selector que depende de otro campo debe
// aparecer después de él en el array). Agregar una acción nueva a futuro
// es agregar una entrada acá, no construir un componente nuevo.

export type GodModeFieldType =
  | "number" | "text" | "textarea" | "select" | "checkbox" | "datetime"
  // ── Campos "inteligentes": en vez de escribir un ID a mano, consultan
  // la base de datos y arman un selector dependiente de otros campos ya
  // elegidos en el mismo formulario (profesor → alumno → enrollment/clase).
  | "teacher-select"
  | "student-select"      // depende de teacher_id
  | "enrollment-select"   // depende de teacher_id + student_id
  | "class-select"        // depende de teacher_id + student_id
  | "subject-display"     // depende de enrollment_id — autocompleta desde el paquete, editable si no hay enrollment
  | "availability-picker" // depende de teacher_id (+ duration_minutes del mismo form) — abre el modal de disponibilidad real
  | "duration-select"     // duraciones permitidas configuradas por el superadmin (PlatformConfig), no un número libre
  | "credit-info"         // muestra créditos disponibles del enrollment elegido (solo informativo, no se envía)
  | "tri-bool-select"     // "automático" (omitido) / "sí" (true) / "no" (false) — para consume_credit
  | "package-select"      // paquetes individuales del profesor elegido, para cambiar de paquete
  | "cohort-select"       // cohortes del profesor elegido
  | "payment-select"      // pagos entre el profesor y alumno elegidos
  | "payment-info"        // muestra estado/monto del pago elegido + aviso si el cambio moverá la billetera del profesor
  | "review-student-select" // depende de teacher_id — a diferencia de student-select, incluye alumnos sin vínculo vigente (ya no activos)
  | "review-select"       // reseñas del profesor elegido, para editar/eliminar
  | "review-info";        // muestra el detalle de la reseña elegida (solo informativo, no se envía)

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
  /** Nombres de otros campos del mismo formulario de los que depende este selector */
  dependsOn?: string[];
  /** true = el valor va en la URL (buildUrl lo lee de v[name]); false/undefined = va en el body */
  isPathParam?: boolean;
  /**
   * Si es true, este campo se muestra en el formulario para ayudar a
   * filtrar otro selector en cascada (ej: teacher_id/student_id como
   * ayuda para elegir class_id) pero NO se envía en el body/URL del
   * request — el campo del que realmente depende el backend ya lo
   * identifica todo (ej: class_id).
   */
  excludeFromPayload?: boolean;
  /**
   * Si está presente, el valor se envía en el body/URL bajo ESTE nombre
   * en vez de `name`. Útil cuando el campo necesita el nombre "teacher_id"
   * para activar el selector en cascada (profesor → alumno) pero el
   * backend espera otro nombre (ej. "from_teacher_id").
   */
  sendAs?: string;
}

export interface GodModeAction {
  id: string;
  label: string;
  description: string;
  category: "Créditos y Paquetes" | "Cohortes" | "Clases" | "Pagos" | "Alumnos" | "Reseñas";
  method: "patch" | "post" | "delete";
  /** Construye la URL a partir de los valores de los campos marcados isPathParam */
  buildUrl: (v: Record<string, string>) => string;
  /** Todos los campos del formulario, en el orden en que deben renderizarse */
  fields: GodModeField[];
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "enrollment_id", label: "Enrollment", type: "enrollment-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "credit_info", label: "", type: "credit-info", dependsOn: ["enrollment_id"], excludeFromPayload: true },
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "enrollment_id", label: "Enrollment", type: "enrollment-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "credit_info", label: "", type: "credit-info", dependsOn: ["enrollment_id"], excludeFromPayload: true },
      { name: "new_package_id", label: "Paquete nuevo", type: "package-select", required: true, dependsOn: ["teacher_id"] },
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "enrollment_id", label: "Enrollment del alumno", type: "enrollment-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "credit_info", label: "", type: "credit-info", dependsOn: ["enrollment_id"], excludeFromPayload: true },
      { name: "new_cohort_id", label: "Cohorte destino (vacío = individual)", type: "cohort-select", dependsOn: ["teacher_id"] },
      { name: "force", label: "Forzar aunque la cohorte destino no tenga cupo", type: "checkbox" },
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "cohort_id", label: "Cohorte", type: "cohort-select", required: true, dependsOn: ["teacher_id"], isPathParam: true },
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "cohort_id", label: "Cohorte", type: "cohort-select", required: true, dependsOn: ["teacher_id"], isPathParam: true },
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
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"] },
      { name: "enrollment_id", label: "Enrollment (opcional)", type: "enrollment-select", dependsOn: ["teacher_id", "student_id"] },
      { name: "subject", label: "Materia / idioma", type: "subject-display", dependsOn: ["enrollment_id"] },
      { name: "credit_info", label: "", type: "credit-info", dependsOn: ["enrollment_id"], excludeFromPayload: true },
      { name: "consume_credit", label: "¿Esta clase resta un crédito del enrollment?", type: "tri-bool-select", dependsOn: ["enrollment_id"],
        helpText: "Automático = sigue la regla normal (solo resta si el estado elegido cuenta contra el paquete, ej. 'completed')." },
      { name: "class_type", label: "Tipo", type: "select", options: [
        { value: "regular", label: "regular" }, { value: "trial", label: "trial" },
      ] },
      { name: "duration_minutes", label: "Duración", type: "duration-select", required: true, dependsOn: ["class_type"] },
      { name: "start_time_utc", label: "Fecha y hora", type: "availability-picker", required: true, dependsOn: ["teacher_id", "duration_minutes", "class_type"] },
      { name: "status", label: "Estado inicial", type: "select", options: STATUS_CLASS_OPTIONS },
      { name: "notes", label: "Nota visible en la clase (opcional)", type: "text",
        helpText: "Se muestra en cursiva en la tarjeta de la clase, visible para el profesor y el alumno." },
      { name: "skip_conflict_check", label: "Permitir doble-booking", type: "checkbox"}
    ],
  },
  {
    id: "class.reschedule",
    label: "Reagendar clase sin restricciones",
    description: "Reagenda cualquier clase, incluso fuera de la antelación mínima normal.",
    category: "Clases",
    method: "patch",
    buildUrl: v => `/god-mode/classes/${v.class_id}/reschedule`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "class_id", label: "Clase", type: "class-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "duration_minutes", label: "Nueva duración (opcional)", type: "duration-select", dependsOn: ["class_id"] },
      { name: "start_time_utc", label: "Nueva fecha y hora", type: "availability-picker", required: true, dependsOn: ["teacher_id", "duration_minutes"] },
      { name: "skip_conflict_check", label: "Permitir doble-booking", type: "checkbox"}
    ],
  },
  {
    id: "class.force_status",
    label: "Forzar estado de una clase",
    description: "Cambia el estado de cualquier clase sin la ventana de 72h. Ajusta el crédito del enrollment automáticamente si corresponde.",
    category: "Clases",
    method: "patch",
    buildUrl: v => `/god-mode/classes/${v.class_id}/force-status`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "class_id", label: "Clase", type: "class-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "status", label: "Nuevo estado", type: "select", required: true, options: STATUS_CLASS_OPTIONS },
      { name: "notes", label: "Nota visible en la clase (opcional)", type: "text",
        helpText: "Se muestra en cursiva en la tarjeta de la clase, visible para el profesor y el alumno." },
    ],
  },
  {
    id: "class.hard_delete",
    label: "Eliminar clase permanentemente",
    description: "Borra la clase por completo (no es una cancelación). No aplica a sesiones grupales.",
    category: "Clases",
    method: "delete",
    buildUrl: v => `/god-mode/classes/${v.class_id}`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "class_id", label: "Clase", type: "class-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "credit_info", label: "", type: "credit-info", dependsOn: ["class_id"], excludeFromPayload: true },
      { name: "refund_credit", label: "Devolver 1 crédito al eliminar (si esta clase ya lo consumía)", type: "checkbox" },
    ],
    destructive: true,
  },
  // ── Pagos ─────────────────────────────────────────────────────────
  {
    id: "payment.create",
    label: "Añadir un pago",
    description: "Registra un pago hecho por fuera del sistema (transferencia, efectivo, WhatsApp) que nunca quedó cargado. No activa ningún enrollment por su cuenta.",
    category: "Pagos",
    method: "post",
    buildUrl: () => `/god-mode/payments`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"] },
      { name: "enrollment_id", label: "Enrollment relacionado (opcional)", type: "enrollment-select", dependsOn: ["teacher_id", "student_id"] },
      { name: "amount_total", label: "Monto total", type: "number", required: true },
      { name: "payment_method", label: "Método de pago", type: "select", required: true, options: [
        { value: "bank_transfer", label: "Transferencia bancaria" },
        { value: "mobile_payment", label: "Pago móvil" },
        { value: "card", label: "Tarjeta" },
        { value: "cash", label: "Efectivo" },
        { value: "other", label: "Otro" },
      ] },
      { name: "payment_type", label: "Tipo de pago", type: "select", options: [
        { value: "package", label: "package" },
        { value: "single_class", label: "single_class" },
        { value: "unlimited_recharge", label: "unlimited_recharge" },
        { value: "manual", label: "manual" },
      ] },
      { name: "status", label: "Estado", type: "select", options: STATUS_PAYMENT_OPTIONS,
        helpText: "Por defecto queda 'approved' — ya se acredita a la billetera del profesor si corresponde." },
      { name: "transaction_id", label: "ID de transacción (opcional)", type: "text" },
      { name: "is_manual_grant", label: "Otorgamiento manual (no genera comisión, no mueve la billetera del profesor)", type: "checkbox" },
    ],
  },
  {
    id: "payment.edit",
    label: "Editar un pago registrado",
    description: "Corrige monto y/o estado de un Payment ya cargado. Ajusta la billetera del profesor automáticamente si el pago ya estaba aprobado.",
    category: "Pagos",
    method: "patch",
    buildUrl: v => `/god-mode/payments/${v.payment_id}`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "student_id", label: "Alumno", type: "student-select", required: true, dependsOn: ["teacher_id"], excludeFromPayload: true },
      { name: "payment_id", label: "Pago", type: "payment-select", required: true, dependsOn: ["teacher_id", "student_id"], isPathParam: true },
      { name: "payment_info", label: "", type: "payment-info", dependsOn: ["payment_id"], excludeFromPayload: true },
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
    fields: [
      { name: "teacher_id", label: "Profesor actual", type: "teacher-select", required: true, sendAs: "from_teacher_id" },
      { name: "student_id", label: "Alumno a transferir", type: "student-select", required: true, dependsOn: ["teacher_id"], isPathParam: true },
      { name: "to_teacher_id", label: "Profesor destino", type: "teacher-select", required: true },
      { name: "remove_old_link", label: "Eliminar vínculo con el profesor actual", type: "checkbox" },
    ],
    destructive: true,
  },
  // ── Reseñas ───────────────────────────────────────────────────────
  {
    id: "review.create_legacy",
    label: "Añadir reseña legacy",
    description: "Carga una reseña que un alumno ya dejó en la plataforma anterior. Si su cuenta sigue existiendo acá, elígela abajo; si no, escribe su nombre en 'Alumno sin cuenta'. Completa solo uno de los dos.",
    category: "Reseñas",
    method: "post",
    buildUrl: () => `/god-mode/reviews`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true },
      { name: "student_id", label: "Alumno con cuenta en el sistema (opcional)", type: "review-student-select", dependsOn: ["teacher_id"],
        helpText: "Incluye alumnos aunque ya no tengan vínculo activo con el profesor." },
      { name: "legacy_student_name", label: "Alumno sin cuenta (opcional)", type: "text", placeholder: "Nombre y apellido",
        helpText: "Solo si el alumno no eligió arriba — no tiene cuenta en este sistema." },
      { name: "rating", label: "Rating (1 a 5, acepta medios puntos)", type: "number", required: true, placeholder: "4.5" },
      { name: "comment", label: "Comentario (opcional)", type: "textarea", placeholder: "Texto de la reseña" },
      { name: "review_date", label: "Fecha original de la reseña (opcional)", type: "datetime",
        helpText: "Si la dejas vacía, queda con la fecha de hoy." },
    ],
  },
  {
    id: "review.edit",
    label: "Editar una reseña",
    description: "Corrige rating, comentario, nombre mostrado o fecha de una reseña ya cargada (legacy o no).",
    category: "Reseñas",
    method: "patch",
    buildUrl: v => `/god-mode/reviews/${v.review_id}`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "review_id", label: "Reseña", type: "review-select", required: true, dependsOn: ["teacher_id"], isPathParam: true },
      { name: "review_info", label: "", type: "review-info", dependsOn: ["review_id"], excludeFromPayload: true },
      { name: "rating", label: "Rating corregido (opcional)", type: "number", optionalNumber: true },
      { name: "comment", label: "Comentario corregido (opcional)", type: "textarea" },
      { name: "legacy_student_name", label: "Nombre mostrado (opcional, solo si no tiene cuenta)", type: "text" },
      { name: "review_date", label: "Fecha corregida (opcional)", type: "datetime" },
    ],
  },
  {
    id: "review.delete",
    label: "Eliminar una reseña",
    description: "Borra una reseña por completo (legacy o no). No se puede deshacer.",
    category: "Reseñas",
    method: "delete",
    buildUrl: v => `/god-mode/reviews/${v.review_id}`,
    fields: [
      { name: "teacher_id", label: "Profesor", type: "teacher-select", required: true, excludeFromPayload: true },
      { name: "review_id", label: "Reseña", type: "review-select", required: true, dependsOn: ["teacher_id"], isPathParam: true },
      { name: "review_info", label: "", type: "review-info", dependsOn: ["review_id"], excludeFromPayload: true },
    ],
    destructive: true,
  },
];

export const GOD_MODE_CATEGORIES = [
  "Créditos y Paquetes", "Cohortes", "Clases", "Pagos", "Alumnos", "Reseñas",
] as const;
