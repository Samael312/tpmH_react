# Pantallas y UX por rol

Tabla completa con archivos y tamaños: `generated/ROUTES.md`. Aquí, el propósito de cada una.

## Pública
`/` landing (3D, contenido de `/public/landing`, profesor destacado) · `/login` (usuario o email + Google) · `/register` (alumno/profesor) · `/register/google-complete` · `/forgot-password` · `/reset-password` · `/terms` · `/privacy` · `/unauthorized`.
El widget Chipi (asistente IA) está disponible incluso sin sesión.

## Alumno (`/dashboard/*`)
- `dashboard`: resumen, próximas clases, etapa de reserva, avisos de renovación y pocos créditos.
- `teachers`, `teachers/[username]`: catálogo y perfil; desde ahí prueba o compra de paquete.
- `schedule` (la más compleja): elegir profesor, ver slots, reservar prueba/clase, comprar/renovar/cambiar paquete con modal de pago (`components/payments`), reagendar y cancelar.
- `classes` historial y próximas · `availability` preferencias de horario · `homework` · `materials` · `chat` · `support` · `profile` (datos, zona horaria, contraseña, borrar cuenta escribiendo el usuario) · `onboarding`.
Notas UX: la UI valida cosas que el servidor no (disponibilidad); tras renovar un paquete agotado puede seguir viendo «sin créditos» (AUD-03); el texto de borrar cuenta promete eliminación total pero el backend anonimiza.

## Profesor (`/teacher/*`)
`dashboard` · `onboarding` (perfil, vídeo, zona, disponibilidad; necesario para ser aprobado) · `availability` (semanal + excepciones) · `calendar/callback` (OAuth Google Calendar) · `packages` (crear/editar, cuotas, ilimitados) · `students` · `payments` (validar pagos de alumnos) · `wallet` (saldo y retiros; mínimo $10 solo aquí) · `cohorts` (grupales) · `homework` · `materials` · `profile` (+`preview`) · `chat` · `support`.

## Admin (`/admin/*`, `superadmin` y `teacher_admin`)
`dashboard` · `users`, `students`, `students/banned` · `teachers` (aprobación, comisión) · `payments` (validar pagos; **retiros pendientes dan 404 hoy**) · `settings` (config de plataforma, pagos, reglas de negocio, landing; 1600 líneas) · `support` · `chat` (solo lectura) · `god-mode` (edición con auditoría) · `logs` · `flow-tester` (desarrollo; lanza pytest en el backend no productivo).

## UX transversal
Mensajes de error en español; modales de confirmación; toasts (`store/toastStore`); `ErrorBoundary`, `app/error.tsx`, `global-error.tsx`, `not-found.tsx`; reporte automático de errores; preferencia de movimiento reducido para el 3D.
Un 401 cierra sesión y recarga la página (se pierden formularios en curso).
