# API_CALLS (generado)

Llamadas `api.<verbo>(...)` por archivo (regex; las URLs construidas dinámicamente fuera de la llamada no se detectan).

## ⚠ Llamadas que NO casan con ninguna ruta del backend

- GET `/payments/booking-status{x}` en `hooks/useStudentData.ts`
- PATCH `/admin/teachers/{x}/pending-video/{x}` en `app/(superadmin)/admin/teachers/page.tsx`

## Por archivo

- `app/(auth)/reset-password/page.tsx`: POST /auth/reset-password
- `app/(public)/login/page.tsx`: GET /teachers/me/profile, GET /users/me, GET /users/me/student-profile, POST /auth/google, POST /auth/login
- `app/(public)/register/google-complete/page.tsx`: GET /users/me, POST /auth/google/register
- `app/(public)/register/page.tsx`: POST /auth/google, POST /auth/register
- `app/(student)/dashboard/availability/page.tsx`: PUT /users/me/preferences
- `app/(student)/dashboard/classes/page.tsx`: DELETE /classes/{x}, DELETE /classes/{x}/leave, POST /cohorts/{x}/leave
- `app/(student)/dashboard/homework/page.tsx`: POST /homework/student/{x}/submit
- `app/(student)/dashboard/layout.tsx`: GET /users/me/student-profile
- `app/(student)/dashboard/materials/page.tsx`: PATCH /materials/student/{x}/progress, POST /tts/vocabulary/{x}
- `app/(student)/dashboard/onboarding/page.tsx`: GET /users/me, PATCH /users/me, PATCH /users/me/avatar, PATCH /users/me/student-profile, POST /users/me/preferences
- `app/(student)/dashboard/page.tsx`: POST /payments/request-refund-cohort-cancelled
- `app/(student)/dashboard/profile/page.tsx`: DELETE /users/me, PATCH /users/me, PATCH /users/me/avatar, PATCH /users/me/student-profile, POST /users/me/change-password
- `app/(student)/dashboard/schedule/page.tsx`: GET /cohorts/available, GET /teachers/{x}, POST /cohorts/{x}/enroll, POST /payments/book
- `app/(student)/dashboard/teachers/[username]/page.tsx`: DELETE /users/me/teachers/{x}, GET /reviews/{x}, GET /teachers/{x}, GET /users/me/student-profile, POST /reviews/{x}, POST /users/me/teachers/{x}
- `app/(student)/dashboard/teachers/page.tsx`: POST /payments/request-refund-teacher-suspended
- `app/(superadmin)/admin/classes/page.tsx`: DELETE /classes/admin/{x}, PATCH /classes/admin/{x}/reschedule
- `app/(superadmin)/admin/dashboard/page.tsx`: PATCH /admin/notifications/{x}/read, PATCH /payments/{x}/validate, POST /admin/notifications/mark-all-read
- `app/(superadmin)/admin/payments/page.tsx`: PATCH /payments/manual-grant-requests/{x}/resolve, PATCH /payments/{x}/validate, POST /payments/admin/withdrawals/{x}/process
- `app/(superadmin)/admin/settings/page.tsx`: GET /admin/platform-config/single-blockers, PATCH /admin/platform-config, PATCH /payments/config, PATCH /system-catalogs/business-rules, PATCH /system-catalogs/{x}
- `app/(superadmin)/admin/students/banned/page.tsx`: POST /admin/students/{x}/unban
- `app/(superadmin)/admin/students/page.tsx`: POST /admin/students/{x}/ban
- `app/(superadmin)/admin/support/page.tsx`: PATCH /admin/support-tickets/{x}/resolve
- `app/(superadmin)/admin/teachers/page.tsx`: PATCH /admin/appeals/{x}/resolve, PATCH /admin/teachers/{x}/commission, PATCH /admin/teachers/{x}/pending-video/{x}, PATCH /admin/teachers/{x}/status
- `app/(superadmin)/admin/users/page.tsx`: PATCH /admin/users/{x}
- `app/(teacher)/teacher/availability/ExceptionsSection.tsx`: DELETE /availability/me/exceptions/{x}, GET /availability/me/exceptions, POST /availability/me/exceptions
- `app/(teacher)/teacher/availability/page.tsx`: PUT /availability/me/weekly
- `app/(teacher)/teacher/cohorts/page.tsx`: GET /cohorts/{x}/recurring-candidates, PATCH /cohorts/sessions/{x}/participants/{x}/attendance, PATCH /cohorts/{x}, POST /cohorts, POST /cohorts/{x}/cancel, POST /cohorts/{x}/close, POST /cohorts/{x}/complete, POST /cohorts/{x}/reopen
- `app/(teacher)/teacher/dashboard/page.tsx`: PATCH /teachers/me/feedback-seen, POST /teachers/me/appeal, POST /teachers/me/video
- `app/(teacher)/teacher/homework/page.tsx`: DELETE /homework/{x}, PATCH /homework/{x}, PATCH /homework/{x}/submissions/{x}/grade, POST /homework
- `app/(teacher)/teacher/layout.tsx`: GET /teachers/me/profile
- `app/(teacher)/teacher/materials/page.tsx`: DELETE /materials/{x}, PATCH /materials/{x}, POST /materials, POST /materials/{x}/assign, POST /materials/{x}/vocabulary
- `app/(teacher)/teacher/onboarding/page.tsx`: GET /users/me, PATCH /teachers/me/profile, PATCH /users/me, POST /teachers/me/video, POST /users/me/photo, PUT /availability/me/weekly
- `app/(teacher)/teacher/packages/page.tsx`: DELETE /packages/{x}, PATCH /packages/{x}, POST /packages, POST /payments/manual-grant-requests
- `app/(teacher)/teacher/payments/page.tsx`: PATCH /payments/{x}/validate
- `app/(teacher)/teacher/profile/CalendarSync.tsx`: GET /calendar/auth-url, POST /calendar/disconnect, POST /calendar/sync, POST /calendar/toggle
- `app/(teacher)/teacher/profile/page.tsx`: DELETE /teachers/me/video, DELETE /users/me, PATCH /teachers/me/profile, PATCH /users/me, POST /teachers/me/appeal, POST /teachers/me/video, POST /users/me/change-password, POST /users/me/photo
- `app/(teacher)/teacher/wallet/page.tsx`: POST /payments/request-withdrawal
- `components/chipi/ChipiWidget.tsx`: POST /chipi/chat
- `components/classes/ClassCard.tsx`: DELETE /classes/teacher/{x}, DELETE /classes/{x}, DELETE /classes/{x}/leave, PATCH /classes/{x}/status, POST /cohorts/{x}/leave, POST /support/class-corrections
- `components/classes/MeetLinkModal.tsx`: PATCH /classes/{x}/meet-link
- `components/layout/VerifyEmailBanner.tsx`: POST /auth/resend-verification
- `components/payments/BuyCreditsModal.tsx`: POST /payments/notify-payment
- `components/payments/PackageCheckout.tsx`: POST /payments/notify-payment
- `components/tour/TourHost.tsx`: PATCH /users/me
- `hooks/useAdminData.ts`: GET /admin/notifications, GET /admin/notifications/unread-count, GET /admin/platform-config, GET /admin/platform-config/single-blockers, GET /admin/stats, GET /admin/teachers/{x}/appeals, GET /admin/users, GET /payments/config, GET /payments/pending-review, GET /system-catalogs/business-rules
- `hooks/useBusinessRules.ts`: GET /system-catalogs/business-rules
- `hooks/useChat.ts`: GET /chat/conversations/direct/{x}, GET /chat/conversations/group/{x}, GET /chat/conversations/unread-count
- `hooks/useChatAdmin.ts`: GET /chat/admin/conversations, GET /chat/admin/conversations/{x}/messages
- `hooks/useEmailSettings.ts`: GET /admin/email-settings, PUT /admin/email-settings
- `hooks/useErrorLogs.ts`: GET /logs, GET /logs/stats, GET /logs/users
- `hooks/useGodMode.ts`: GET /god-mode/audit-log, GET /god-mode/lookup/class-durations, GET /god-mode/lookup/teachers/{x}/packages, GET /god-mode/lookup/teachers/{x}/reviews, GET /god-mode/lookup/teachers/{x}/students/reviewable, GET /god-mode/lookup/teachers/{x}/students/{x}/classes, GET /god-mode/lookup/teachers/{x}/students/{x}/payments
- `hooks/useLandingData.ts`: GET /public/landing
- `hooks/useSpokenLanguages.ts`: PATCH /users/me
- `hooks/useStudentData.ts`: GET /admin/platform-config, GET /availability/featured-teacher/username, GET /homework/student/my-homework, GET /materials/student/my-materials, GET /packages/my-enrollments, GET /packages/teacher/{x}, GET /payments/booking-status, GET /payments/booking-status{x}, GET /reviews/{x}/summary, GET /teachers, GET /users/me/preferences, GET /users/me/student-profile, GET /users/me/teachers
- `hooks/useSupport.ts`: GET /support/tickets/me/unread-count, PATCH /support/tickets/{x}/seen, POST /support/tickets
- `hooks/useSystemCatalogs.ts`: GET /system-catalogs
- `hooks/useTeacherData.ts`: GET /availability/me/weekly, GET /calendar/status, GET /cohorts/{x}/members, GET /homework/my-homework, GET /homework/{x}/submissions, GET /materials/my-materials, GET /packages/my-packages, GET /payments/my-wallet, GET /payments/pending-review, GET /reviews/{x}, GET /teachers/me/profile, GET /users/me
- `hooks/useTeacherNotifications.ts`: GET /teachers/me/notifications/unread-count, PATCH /teachers/me/notifications/{x}/read, POST /teachers/me/notifications/mark-all-read
- `lib/me.ts`: GET /users/me
- `lib/platformTenantMode.ts`: GET /admin/platform-config
- `store/chatStore.ts`: GET /chat/conversations/{x}/messages, POST /chat/conversations/{x}/messages
