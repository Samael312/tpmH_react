# Dominio y diagramas

Los diagramas usan [Mermaid](https://mermaid.js.org/) (GitHub y la mayoría de editores los renderizan). Reflejan el **comportamiento actual** del código; donde difiere de lo deseable se marca con ⚠ y el ID de `KNOWN_ISSUES.md`.

## 1. Glosario

| Término | Significado | Dónde vive |
|---|---|---|
| **User** | cuenta con rol (`student`, `teacher`, `teacher_admin`, `superadmin`) | `models/user.py` |
| **StudentProfile / TeacherProfile** | datos específicos del rol; el profesor tiene `status` (`pending`, `approved`, `suspended`…), `commission_rate`, zona horaria, lista de alumnos | `models/student.py`, `teacher.py` |
| **Clase de prueba (trial)** | primera clase con un profesor; no consume paquete; necesaria antes de comprar; cada profesor exige la suya | `Class.class_type='trial'` |
| **Package (paquete)** | producto del profesor: N clases por un precio (`price_per_class × N = price`), o **ilimitado** (créditos prepagados), con cuotas opcionales | `models/package.py` |
| **Enrollment (inscripción)** | relación alumno–profesor–paquete comprada; guarda créditos y estados de pago | `models/package.py` |
| **Crédito** | derecho a agendar una clase. Se libera al aprobar el pago (`unlocked_credits`) y se *ocupa al agendar* | `Enrollment` |
| **Cuota (installment)** | pago parcial de un paquete; cada una desbloquea créditos proporcionales | `Package.allow_installments` |
| **Payment** | pago notificado por el alumno (`pending_review → approved/rejected`); incluye comisión | `models/payment.py` |
| **Comisión** | porción de la plataforma (15 % por defecto, por profesor), fijada al aprobar el pago | `TeacherProfile.commission_rate` |
| **TeacherWallet** | saldo del profesor: `available_balance`, `total_earned`, `total_withdrawn` | `models/payment.py` |
| **Withdrawal** | solicitud de retiro del profesor, procesada por staff | `models/payment.py` |
| **Cohorte (cohort)** | grupo de alumnos con un profesor para clases grupales (`filling → …`) | `models/group_cohort.py` |
| **ClassParticipant** | alumno participante de una sesión grupal | `models/class_participant.py` |
| **Buffer** | margen de preparación entre clases (5/10/10 min) que ocupa agenda | `PlatformConfig` |
| **Etapa de reserva** | estado del alumno con un profesor: `needs_trial`, `trial_in_progress`, `needs_package`, `package_pending_payment`, `ready`, `needs_renewal`, `renewal_pending`, `needs_group_refund` | `get_student_booking_stage` |
| **God Mode** | edición administrativa directa con motivo y auditoría | `endpoints/god_mode.py` |
| **Chipi** | asistente de IA (OpenAI) con contexto por rol y pantalla | `core/chipi/` |
| **PlatformConfig** | única fila de configuración: reglas de tiempos, duraciones, buffers, chat, landing, modo single/multi-tenant | `models/payment_config.py` |
| **single-tenant** | modo de un solo profesor destacado (`FEATURED_TEACHER_USERNAME`) | `PlatformConfig.is_single_tenant` |

## 2. Arquitectura

```mermaid
flowchart LR
  subgraph Cliente
    B[Navegador<br/>Next.js 16]
  end
  subgraph Railway
    F[Frontend<br/>node server.js]
    A[Backend FastAPI<br/>+ APScheduler + WebSocket]
  end
  B -->|HTML/JS| F
  B -->|REST /api/v1 + WS /chat/ws<br/>Bearer JWT| A
  A -->|SQLAlchemy| N[(Neon PostgreSQL)]
  A --> R[Resend<br/>emails]
  A --> C[Cloudinary<br/>archivos y audio]
  A --> O[OpenAI<br/>Chipi y TTS]
  A --> G[Google<br/>Calendar/Meet + Sign-In]
```

## 3. Etapas de reserva del alumno (por profesor)

```mermaid
stateDiagram-v2
  [*] --> needs_trial
  needs_trial --> trial_in_progress: reserva la prueba
  trial_in_progress --> needs_package: prueba completed
  trial_in_progress --> needs_trial: prueba cancelada
  needs_package --> package_pending_payment: notifica pago
  package_pending_payment --> ready: pago aprobado
  package_pending_payment --> needs_package: pago rechazado
  ready --> needs_renewal: créditos agotados
  needs_renewal --> renewal_pending: notifica renovación
  renewal_pending --> ready: aprobada ⚠ AUD-03 (puede quedar sin créditos)
```

## 4. Estados de una clase

```mermaid
stateDiagram-v2
  [*] --> pending_trial: prueba reservada
  [*] --> confirmed: clase regular reservada
  pending_trial --> confirmed: staff/profesor confirma
  pending_trial --> no_show: pasa la hora (job)
  pending_trial --> cancelled
  confirmed --> cancelled: alumno ≥12 h · profesor siempre
  confirmed --> completed: profesor (hasta 72 h tras el fin) ⚠ AUD-04 permite futuras
  confirmed --> no_show: profesor
  confirmed --> finalized: pasa la hora (job cada 10 min)
  finalized --> completed: profesor (ventana 72 h)
  finalized --> no_show: profesor
  completed --> confirmed: reversión del profesor
  cancelled --> [*]
```
`classes_used` sube con `completed` y `no_show`. Una `finalized` que el profesor no resuelve **no cuenta** y queda en limbo (decisión de negocio abierta).

## 5. Estados de la inscripción y del pago

```mermaid
stateDiagram-v2
  direction LR
  state Enrollment {
    [*] --> unpaid
    unpaid --> active: pago aprobado
    active --> completed: créditos agotados
    active --> pending_renewal: pide renovar
    active --> pending_package_change: pide cambio
    pending_renewal --> active: aprobado
    pending_package_change --> active: aprobado
    active --> cancelled
  }
  state Payment {
    [*] --> pending_review
    pending_review --> approved
    pending_review --> rejected: requiere motivo
  }
  state Withdrawal {
    [*] --> pending
    pending --> completed: staff, con referencia
    pending --> rejected: devuelve saldo
  }
```
`payment_status` del enrollment: `unpaid → partially_paid → paid` (cuotas).

## 6. Flujo principal (secuencia)

```mermaid
sequenceDiagram
  actor Al as Alumno
  participant Web as Frontend
  participant API as Backend
  actor Pr as Profesor/Staff
  Al->>Web: reserva prueba
  Web->>API: POST /payments/book (etapa needs_trial crea la prueba; staff usa POST /classes/trial)
  Pr->>API: PATCH /classes/{id}/status completed
  Al->>API: POST /payments/notify-payment {package}
  API-->>Pr: email "pago pendiente"
  Pr->>API: PATCH /payments/{id}/validate approve
  API->>API: comisión · billetera · créditos · email recibo
  Al->>API: POST /payments/book (clase)
  API->>API: can_book_slot · crédito ocupado · email · Calendar
  Note over API: job: crea Meet ~30 min antes · recordatorio 24 h
  Pr->>API: marca completed/no_show
  Pr->>API: POST /payments/request-withdrawal
  Pr->>API: (staff) /payments/admin/withdrawals/{id}/process
```

## 7. Flujo del dinero

```mermaid
flowchart TD
  P[Alumno paga fuera de la plataforma<br/>transferencia · PayPal · Binance · pago móvil] --> N[notify-payment<br/>Payment pending_review]
  N --> V{¿Staff o profesor aprueba?}
  V -- rechazar --> X[rejected · sin dinero movido]
  V -- aprobar --> S[amount_total]
  S --> C[Comisión = total × commission_rate<br/>15 % por defecto]
  C --> PL[amount_platform]
  C --> T[amount_teacher = total − comisión]
  T --> W[(TeacherWallet.available_balance<br/>+ total_earned)]
  W --> RW[Solicitud de retiro<br/>saldo reservado]
  RW --> D{Staff procesa}
  D -- complete --> TW[total_withdrawn +]
  D -- reject --> BK[saldo devuelto]
  S -. reembolso .-> RF[amount_teacher = 0<br/>⚠ AUD-14 no descuenta la billetera]
```
El dinero real nunca pasa por la plataforma: es un libro contable; el staff paga los retiros fuera.

## 8. Modelo de datos (núcleo)

```mermaid
erDiagram
  USER ||--o| STUDENT_PROFILE : tiene
  USER ||--o| TEACHER_PROFILE : tiene
  TEACHER_PROFILE ||--o{ PACKAGE : ofrece
  TEACHER_PROFILE ||--o{ TEACHER_AVAILABILITY : define
  TEACHER_PROFILE ||--|| TEACHER_WALLET : acumula
  STUDENT_PROFILE ||--o{ ENROLLMENT : compra
  PACKAGE ||--o{ ENROLLMENT : origina
  ENROLLMENT ||--o{ CLASS : consume
  ENROLLMENT ||--o{ PAYMENT : "se paga con"
  TEACHER_PROFILE ||--o{ CLASS : imparte
  STUDENT_PROFILE ||--o{ CLASS : asiste
  GROUP_COHORT ||--o{ CLASS : sesiones
  CLASS ||--o{ CLASS_PARTICIPANT : "grupal"
  TEACHER_PROFILE ||--o{ WITHDRAWAL : solicita
  TEACHER_PROFILE ||--o{ REVIEW : recibe
```
Todas las tablas y columnas: `backend/doc/generated/MODELS.md` (34 tablas).

## 9. Scheduler

```mermaid
flowchart LR
  S((APScheduler)) -->|5 min| M[Generar Meet]
  S -->|10 min| F[Finalizar clases]
  S -->|30 min| CS[Sync Calendar]
  S -->|1 h| R[Recordatorios 24 h]
  S -->|7 días| LC[Aviso bajo crédito]
  S -->|24 h| PG[Purga de chat]
```
