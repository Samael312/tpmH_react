# ROUTES (generado)

Páginas del App Router. Guard = `proxy.ts` (solo UX: decodifica el JWT SIN verificar firma; la seguridad real es el backend).

| URL | Archivo | Guard (rol) | Líneas | Nota |
|---|---|---|---|---|
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | pública | 208 |  |
| `/reset-password` | `app/(auth)/reset-password/page.tsx` | pública | 215 |  |
| `/verify-email` | `app/(auth)/verify-email/page.tsx` | pública | 107 |  |
| `/login` | `app/(public)/login/page.tsx` | pública | 340 |  |
| `/privacy` | `app/(public)/privacy/page.tsx` | pública | 17 |  |
| `/register/google-complete` | `app/(public)/register/google-complete/page.tsx` | pública | 252 |  |
| `/register` | `app/(public)/register/page.tsx` | pública | 697 |  |
| `/terms` | `app/(public)/terms/page.tsx` | pública | 17 |  |
| `/dashboard/availability` | `app/(student)/dashboard/availability/page.tsx` | student | 448 |  |
| `/dashboard/chat` | `app/(student)/dashboard/chat/page.tsx` | student | 147 |  |
| `/dashboard/classes` | `app/(student)/dashboard/classes/page.tsx` | student | 733 |  |
| `/dashboard/homework` | `app/(student)/dashboard/homework/page.tsx` | student | 611 |  |
| `/dashboard/materials` | `app/(student)/dashboard/materials/page.tsx` | student | 494 | app/student/materials/page.tsx |
| `/dashboard/onboarding` | `app/(student)/dashboard/onboarding/page.tsx` | student | 895 |  |
| `/dashboard` | `app/(student)/dashboard/page.tsx` | student | 774 |  |
| `/dashboard/profile` | `app/(student)/dashboard/profile/page.tsx` | student | 987 |  |
| `/dashboard/schedule` | `app/(student)/dashboard/schedule/page.tsx` | student | 1812 |  |
| `/dashboard/support` | `app/(student)/dashboard/support/page.tsx` | student | 21 |  |
| `/dashboard/teachers/[username]` | `app/(student)/dashboard/teachers/[username]/page.tsx` | student | 317 |  |
| `/dashboard/teachers` | `app/(student)/dashboard/teachers/page.tsx` | student | 296 |  |
| `/admin/chat` | `app/(superadmin)/admin/chat/page.tsx` | superadmin, teacher_admin | 256 | app/(superadmin)/admin/chat/page.tsx N5: panel de solo lectura para que superadmin/teacher_admin puedan revisar una conv |
| `/admin/classes` | `app/(superadmin)/admin/classes/page.tsx` | superadmin, teacher_admin | 219 |  |
| `/admin/dashboard` | `app/(superadmin)/admin/dashboard/page.tsx` | superadmin, teacher_admin | 473 | frontend/app/(superadmin)/admin/dashboard/page.tsx |
| `/admin/flow-tester` | `app/(superadmin)/admin/flow-tester/page.tsx` | superadmin, teacher_admin | 552 |  |
| `/admin/god-mode` | `app/(superadmin)/admin/god-mode/page.tsx` | superadmin, teacher_admin | 99 |  |
| `/admin/logs` | `app/(superadmin)/admin/logs/page.tsx` | superadmin, teacher_admin | 31 |  |
| `/admin/materials` | `app/(superadmin)/admin/materials/page.tsx` | superadmin, teacher_admin | 91 |  |
| `/admin/payments` | `app/(superadmin)/admin/payments/page.tsx` | superadmin, teacher_admin | 749 |  |
| `/admin/settings` | `app/(superadmin)/admin/settings/page.tsx` | superadmin, teacher_admin | 1647 |  |
| `/admin/students/banned` | `app/(superadmin)/admin/students/banned/page.tsx` | superadmin, teacher_admin | 167 |  |
| `/admin/students` | `app/(superadmin)/admin/students/page.tsx` | superadmin, teacher_admin | 474 |  |
| `/admin/support` | `app/(superadmin)/admin/support/page.tsx` | superadmin, teacher_admin | 281 |  |
| `/admin/teachers` | `app/(superadmin)/admin/teachers/page.tsx` | superadmin, teacher_admin | 706 |  |
| `/admin/users` | `app/(superadmin)/admin/users/page.tsx` | superadmin, teacher_admin | 1065 | frontend/app/(superadmin)/admin/users/page.tsx |
| `/teacher/availability` | `app/(teacher)/teacher/availability/page.tsx` | teacher, teacher_admin | 408 |  |
| `/teacher/calendar/callback` | `app/(teacher)/teacher/calendar/callback/page.tsx` | teacher, teacher_admin | 137 |  |
| `/teacher/chat` | `app/(teacher)/teacher/chat/page.tsx` | teacher, teacher_admin | 143 |  |
| `/teacher/cohorts` | `app/(teacher)/teacher/cohorts/page.tsx` | teacher, teacher_admin | 1334 |  |
| `/teacher/dashboard` | `app/(teacher)/teacher/dashboard/page.tsx` | teacher, teacher_admin | 973 |  |
| `/teacher/homework` | `app/(teacher)/teacher/homework/page.tsx` | teacher, teacher_admin | 1262 |  |
| `/teacher/materials` | `app/(teacher)/teacher/materials/page.tsx` | teacher, teacher_admin | 1567 |  |
| `/teacher/notifications` | `app/(teacher)/teacher/notifications/page.tsx` | teacher, teacher_admin | 86 |  |
| `/teacher/onboarding` | `app/(teacher)/teacher/onboarding/page.tsx` | teacher, teacher_admin | 1135 |  |
| `/teacher/packages` | `app/(teacher)/teacher/packages/page.tsx` | teacher, teacher_admin | 1171 |  |
| `/teacher/payments` | `app/(teacher)/teacher/payments/page.tsx` | teacher, teacher_admin | 259 |  |
| `/teacher/profile` | `app/(teacher)/teacher/profile/page.tsx` | teacher, teacher_admin | 1439 |  |
| `/teacher/profile/preview` | `app/(teacher)/teacher/profile/preview/page.tsx` | teacher, teacher_admin | 86 |  |
| `/teacher/students` | `app/(teacher)/teacher/students/page.tsx` | teacher, teacher_admin | 503 |  |
| `/teacher/support` | `app/(teacher)/teacher/support/page.tsx` | teacher, teacher_admin | 21 |  |
| `/teacher/wallet` | `app/(teacher)/teacher/wallet/page.tsx` | teacher, teacher_admin | 427 |  |
| `/` | `app/page.tsx` | pública | 52 |  |
| `/unauthorized` | `app/unauthorized/page.tsx` | pública | 84 |  |

## Layouts

- `app/(student)/dashboard/layout.tsx` — 
- `app/(superadmin)/admin/layout.tsx` — 
- `app/(teacher)/teacher/layout.tsx` — 
- `app/layout.tsx` — 
