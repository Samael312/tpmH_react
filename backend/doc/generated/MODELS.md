# MODELS (generado)

Tablas SQLAlchemy y columnas. FK = clave foránea; `?` = nullable.


## chat_conversations

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| conversation_type | VARCHAR(6) |  |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| student_id | INTEGER | FK→student_profiles.id ? |
| cohort_id | INTEGER | unique FK→group_cohorts.id ? |
| created_at | DATETIME | ? |
| last_message_at | DATETIME | ? |
| last_message_preview | VARCHAR | ? |
| teacher_last_notified_at | DATETIME | ? |
| teacher_notify_pending_at | DATETIME | ? |

## chat_messages

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| conversation_id | INTEGER | FK→chat_conversations.id |
| sender_id | INTEGER | FK→users.id |
| content | TEXT |  |
| created_at | DATETIME |  |
| delivered_at | DATETIME | ? |
| client_id | VARCHAR(64) | ? |

## chat_read_states

| Columna | Tipo | Notas |
|---|---|---|
| conversation_id | INTEGER | PK FK→chat_conversations.id |
| user_id | INTEGER | PK FK→users.id |
| last_read_at | DATETIME | ? |

## class_participants

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| class_id | INTEGER | FK→classes.id |
| student_id | INTEGER | FK→student_profiles.id |
| enrollment_id | INTEGER | FK→enrollments.id |
| attendance_status | VARCHAR | ? default=confirmed |

## classes

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| enrollment_id | INTEGER | FK→enrollments.id ? |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| student_id | INTEGER | FK→student_profiles.id ? |
| cohort_id | INTEGER | FK→group_cohorts.id ? |
| class_type | VARCHAR(8) | default=ClassType.regular |
| subject | VARCHAR | ? |
| start_time_utc | DATETIME |  |
| end_time_utc | DATETIME |  |
| day_of_week | VARCHAR | ? |
| duration | INTEGER |  |
| buffer_minutes | INTEGER | default=10 |
| google_event_id | VARCHAR | ? |
| google_sync_hash | VARCHAR(32) | ? |
| external_source | VARCHAR | ? |
| status | VARCHAR | ? default=pending |
| meet_link | VARCHAR | ? |
| teacher_timezone | VARCHAR | ? |
| student_timezone | VARCHAR | ? |
| notes | VARCHAR | ? |
| created_at | DATETIME | ? |
| updated_at | DATETIME | ? |
| payment_expires_at | DATETIME | ? |
| used_prepaid_credit | BOOLEAN | ? default=False |
| reminder_sent_at | DATETIME | ? |
| student_reschedule_count | INTEGER | default=0 |

## email_log

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| day | DATE |  |
| category | VARCHAR |  |
| outcome | VARCHAR |  |
| reason | VARCHAR | ? |
| created_at | DATETIME | ? |

## email_verification_tokens

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| token_hash | VARCHAR | unique |
| is_used | BOOLEAN | default=False |
| expires_at | DATETIME |  |
| created_at | DATETIME | ? |

## enrollments

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| student_id | INTEGER | FK→student_profiles.id |
| package_id | INTEGER | FK→packages.id |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| classes_used | INTEGER | ? default=0 |
| classes_total | INTEGER | ? |
| status | VARCHAR(22) | ? default=EnrollmentStatus.active |
| renewal_count | INTEGER | ? default=0 |
| previous_enrollment_id | INTEGER | FK→enrollments.id ? |
| renewal_requested_package_id | INTEGER | FK→packages.id ? |
| change_requested_package_id | INTEGER | FK→packages.id ? |
| cohort_id | INTEGER | FK→group_cohorts.id ? |
| credit_balance_usd | NUMERIC(12, 2) | ? |
| unlocked_credits | INTEGER | ? default=0 |
| prepaid_unlimited_credits | INTEGER | ? default=0 |
| payment_status | VARCHAR | ? default=unpaid |
| paid_via_installments | BOOLEAN | ? default=False |
| installments_paid | INTEGER | ? default=0 |
| low_credit_notified_at | DATETIME | ? |
| activated_at | DATETIME | ? |
| created_at | DATETIME | ? |

## error_logs

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| source | VARCHAR |  |
| level | VARCHAR | default=error |
| message | VARCHAR |  |
| detail | TEXT | ? |
| screen | VARCHAR | ? |
| method | VARCHAR | ? |
| status_code | INTEGER | ? |
| user_id | INTEGER | FK→users.id ? |
| user_name | VARCHAR | ? |
| user_role | VARCHAR | ? |
| extra_data | JSONB | ? |
| created_at | DATETIME | ? |

## god_mode_audit_logs

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| actor_user_id | INTEGER | FK→users.id |
| actor_role | VARCHAR |  |
| action | VARCHAR |  |
| entity_type | VARCHAR |  |
| entity_id | INTEGER |  |
| reason | VARCHAR |  |
| before_data | JSONB | ? |
| after_data | JSONB | ? |
| created_at | DATETIME | ? |

## google_google_calendar

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | unique FK→users.id |
| teacher_id | INTEGER | unique FK→teacher_profiles.id |
| access_token | TEXT |  |
| refresh_token | TEXT | ? |
| token_expiry | DATETIME | ? |
| calendar_id | VARCHAR | ? default=primary |
| google_account_sub | VARCHAR | ? |
| google_account_email | VARCHAR | ? |
| is_active | BOOLEAN | ? default=True |
| needs_reauth | BOOLEAN | ? default=False |
| last_synced_at | DATETIME | ? |
| last_error | VARCHAR | ? |
| created_at | DATETIME | ? |
| updated_at | DATETIME | ? |

## group_cohorts

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| package_id | INTEGER | FK→packages.id |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| start_date | DATETIME | ? |
| status | VARCHAR(11) | default=CohortStatus.filling |
| min_students | INTEGER |  |
| max_students | INTEGER |  |
| created_at | DATETIME | ? |
| closed_at | DATETIME | ? |

## homework

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| title | VARCHAR |  |
| description | VARCHAR |  |
| due_date_utc | DATETIME |  |
| is_active | BOOLEAN | ? default=True |
| created_at | DATETIME | ? |

## homework_assignments

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| homework_id | INTEGER | FK→homework.id |
| student_id | INTEGER | FK→student_profiles.id |
| status | VARCHAR | ? default=pending |
| submission | VARCHAR | ? |
| submitted_at | DATETIME | ? |
| score | FLOAT | ? |
| feedback | VARCHAR | ? |
| graded_at | DATETIME | ? |
| assigned_at | DATETIME | ? |

## manual_grant_requests

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| student_id | INTEGER | FK→student_profiles.id |
| enrollment_id | INTEGER | FK→enrollments.id |
| package_id | INTEGER | FK→packages.id ? |
| reason | TEXT |  |
| status | VARCHAR | default=pending |
| rejection_reason | VARCHAR | ? |
| created_at | DATETIME | ? |
| resolved_at | DATETIME | ? |
| resolved_by | INTEGER | ? |
| payment_id | INTEGER | FK→payments.id ? |

## material_assignments

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| material_id | INTEGER | FK→materials.id |
| student_id | INTEGER | FK→student_profiles.id |
| progress | VARCHAR | ? default=not_started |
| assigned_at | DATETIME | ? |
| completed_at | DATETIME | ? |

## materials

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| title | VARCHAR |  |
| description | VARCHAR | ? |
| category | VARCHAR |  |
| level | VARCHAR | ? |
| file_url | VARCHAR | ? |
| file_public_id | VARCHAR | ? |
| file_type | VARCHAR | ? |
| file_size | BIGINT | ? |
| vocabulary_words | JSONB | ? |
| language | VARCHAR | ? |
| is_active | BOOLEAN | ? default=True |
| created_at | DATETIME | ? |

## notifications

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| recipient_role | VARCHAR | default=staff |
| type | VARCHAR |  |
| title | VARCHAR |  |
| message | VARCHAR | ? |
| related_teacher_id | INTEGER | FK→teacher_profiles.id ? |
| related_support_ticket_id | INTEGER | FK→support_tickets.id ? |
| recipient_user_id | INTEGER | FK→users.id ? |
| is_read | BOOLEAN | ? default=False |
| created_at | DATETIME | ? |

## packages

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| name | VARCHAR |  |
| subject | VARCHAR |  |
| description | VARCHAR | ? |
| classes_count | INTEGER | ? |
| price | NUMERIC(12, 2) |  |
| price_per_class | NUMERIC(12, 2) | ? |
| duration_minutes | INTEGER | ? default=50 |
| is_active | BOOLEAN | ? default=True |
| created_at | DATETIME | ? |
| icon | VARCHAR | ? default=📦 |
| color | VARCHAR | ? default=#ec4899 |
| description_type | VARCHAR | ? default=paragraph |
| description_items | JSONB | ? |
| is_group | BOOLEAN | ? default=False |
| min_students | INTEGER | ? |
| max_students | INTEGER | ? |
| group_schedule_mode | VARCHAR | ? default=manual |
| group_recurring_days_of_week | JSONB | ? |
| group_recurring_time_local | VARCHAR(5) | ? |
| allow_installments | BOOLEAN | ? default=False |
| installment_count | INTEGER | ? |
| installment_amount | NUMERIC(12, 2) | ? |

## password_reset_tokens

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| token | VARCHAR | unique |
| is_used | BOOLEAN | ? default=False |
| expires_at | DATETIME |  |
| created_at | DATETIME | ? |

## payment_config

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| paypal_enabled | BOOLEAN | ? default=True |
| binance_enabled | BOOLEAN | ? default=True |
| bank_transfer_enabled | BOOLEAN | ? default=False |
| mobile_payment_enabled | BOOLEAN | ? default=False |
| paypal_email | VARCHAR | ? |
| binance_address | VARCHAR | ? |
| binance_network | VARCHAR | ? default=USDT TRC20 |
| bank_transfer_details | VARCHAR | ? |
| mobile_payment_details | VARCHAR | ? |
| whatsapp_number | VARCHAR | ? |
| default_commission_rate | FLOAT | ? default=0.15 |
| updated_at | DATETIME | ? |
| updated_by | INTEGER | ? |

## payments

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| enrollment_id | INTEGER | FK→enrollments.id ? |
| class_id | INTEGER | FK→classes.id ? |
| student_id | INTEGER | FK→student_profiles.id |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| amount_total | NUMERIC(12, 2) |  |
| amount_teacher | NUMERIC(12, 2) |  |
| amount_platform | NUMERIC(12, 2) |  |
| payment_method | VARCHAR |  |
| payment_type | VARCHAR | ? |
| installment_index | INTEGER | ? |
| is_manual_grant | BOOLEAN | ? default=False |
| receipt_url | VARCHAR | ? |
| receipt_public_id | VARCHAR | ? |
| transaction_id | VARCHAR | ? |
| status | VARCHAR | ? default=pending_review |
| validated_by | INTEGER | ? |
| validated_at | DATETIME | ? |
| rejection_reason | VARCHAR | ? |
| refund_payment_info | JSONB | ? |
| created_at | DATETIME | ? |

## platform_config

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| featured_teacher_id | INTEGER | FK→teacher_profiles.id ? |
| platform_name | VARCHAR | ? default=TPM |
| platform_tagline | VARCHAR | ? |
| landing_content | JSONB | ? |
| is_single_tenant | BOOLEAN | ? default=True |
| updated_at | DATETIME | ? |
| min_booking_hours | INTEGER | ? default=1 |
| min_cancel_hours | INTEGER | ? default=12 |
| min_reschedule_hours_student | INTEGER | ? default=12 |
| allowed_class_durations | JSONB | ? |
| allowed_package_durations | JSONB | ? |
| low_credit_threshold | INTEGER | ? default=1 |
| low_credit_renotify_days | INTEGER | ? default=6 |
| trial_duration_minutes | INTEGER | ? default=25 |
| buffer_trial_minutes | INTEGER | ? |
| buffer_regular_minutes | INTEGER | ? |
| buffer_group_minutes | INTEGER | ? |
| meet_link_autogen_minutes | INTEGER | ? default=30 |
| show_teacher_whatsapp | BOOLEAN | ? default=True |
| min_classes_before_package_change | INTEGER | ? default=0 |
| chat_enabled | BOOLEAN | ? default=True |
| chat_retention_days | INTEGER | ? default=90 |
| chat_reactivation_hours | INTEGER | ? default=24 |
| email_notifications | JSONB | ? |
| email_daily_limit | INTEGER | ? default=100 |
| email_auto_saver_enabled | BOOLEAN | ? default=False |
| email_auto_saver_percent | INTEGER | ? default=80 |

## refresh_tokens

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| token_hash | VARCHAR | unique |
| family_id | VARCHAR |  |
| expires_at | DATETIME |  |
| revoked_at | DATETIME | ? |
| created_at | DATETIME | ? |

## reviews

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| student_id | INTEGER | FK→student_profiles.id ? |
| rating | FLOAT |  |
| comment | VARCHAR | ? |
| created_at | DATETIME | ? |
| is_legacy | BOOLEAN | default=False |
| legacy_student_name | VARCHAR | ? |
| total_completed_classes | INTEGER | ? |

## student_profiles

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| user_username | VARCHAR |  |
| timezone | VARCHAR | ? default=UTC |
| goal | VARCHAR | ? |
| teacher_username | VARCHAR | ? |
| preferred_payment_methods | JSONB | ? |
| created_at | DATETIME | ? |
| profile_photo_url | VARCHAR | ? |
| profile_photo_public_id | VARCHAR | ? |
| total_completed_classes | INTEGER | default=0 |

## student_schedule_preferences

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| student_id | INTEGER | FK→student_profiles.id |
| day_of_week | INTEGER |  |
| local_day_of_week | INTEGER | ? |
| start_time_utc | VARCHAR(5) |  |
| end_time_utc | VARCHAR(5) |  |
| created_at | DATETIME | ? |

## student_teacher_links

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| student_id | INTEGER | FK→student_profiles.id |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| linked_at | DATETIME | ? |

## support_tickets

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| category | VARCHAR(16) | default=SupportCategory.question |
| subject | VARCHAR |  |
| message | TEXT |  |
| screen_context | VARCHAR | ? |
| status | VARCHAR(8) | default=SupportTicketStatus.pending |
| admin_response | TEXT | ? |
| resolved_at | DATETIME | ? |
| resolved_by | INTEGER | ? |
| user_notified_seen | BOOLEAN | ? default=False |
| class_id | INTEGER | FK→classes.id ? |
| requested_status | VARCHAR | ? |
| decision | VARCHAR | ? |
| created_at | DATETIME | ? |

## system_catalogs

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| key | VARCHAR | unique |
| label | VARCHAR |  |
| value | JSONB |  |
| updated_at | DATETIME | ? |

## teacher_appeals

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| appeal_number | INTEGER |  |
| message | TEXT |  |
| kind | VARCHAR | default=profile |
| status | VARCHAR | ? default=pending |
| admin_response | VARCHAR | ? |
| created_at | DATETIME | ? |
| resolved_at | DATETIME | ? |
| resolved_by | INTEGER | ? |

## teacher_availability

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| day_of_week | INTEGER |  |
| start_time_local | VARCHAR(5) |  |
| end_time_local | VARCHAR(5) |  |
| is_available | BOOLEAN | ? default=True |

## teacher_availability_exceptions

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| start_time_utc | DATETIME |  |
| end_time_utc | DATETIME |  |
| is_available | BOOLEAN | ? default=True |
| reason | VARCHAR | ? |

## teacher_profiles

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | FK→users.id |
| user_username | VARCHAR |  |
| bio | VARCHAR | ? |
| title | VARCHAR | ? |
| timezone | VARCHAR | ? default=UTC |
| languages | JSONB | ? |
| subjects | JSONB | ? |
| skills | JSONB | ? |
| certificates | JSONB | ? |
| gallery | JSONB | ? |
| students | JSONB | ? |
| social_links | JSONB | ? |
| status | VARCHAR(9) | ? default=TeacherStatus.pending |
| commission_rate | FLOAT | ? default=0.15 |
| balance | NUMERIC(12, 2) | ? default=0.0 |
| stripe_account_id | VARCHAR | ? |
| created_at | DATETIME | ? |
| updated_at | DATETIME | ? |
| profile_photo_url | VARCHAR | ? |
| profile_photo_public_id | VARCHAR | ? |
| video_url | VARCHAR | ? |
| video_public_id | VARCHAR | ? |
| video_pending_url | VARCHAR | ? |
| video_pending_public_id | VARCHAR | ? |
| video_pending_rejection_reason | VARCHAR | ? |
| video_pending_appeal_used | BOOLEAN | default=False |
| theme_color | VARCHAR | ? default=#ec4899 |
| rejection_reason | VARCHAR | ? |
| rejection_feedback_seen | BOOLEAN | ? default=True |
| appeal_count | INTEGER | ? default=0 |
| appeal_exhausted | BOOLEAN | ? default=False |

## teacher_wallets

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | unique FK→teacher_profiles.id ? |
| available_balance | NUMERIC(12, 2) | ? default=0.0 |
| total_earned | NUMERIC(12, 2) | ? default=0.0 |
| total_withdrawn | NUMERIC(12, 2) | ? default=0.0 |
| updated_at | DATETIME | ? |

## users

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| email | VARCHAR | unique |
| password_hash | VARCHAR | ? |
| role | VARCHAR(13) | default=UserRole.student |
| username | VARCHAR | unique |
| name | VARCHAR |  |
| surname | VARCHAR |  |
| avatar | VARCHAR | ? |
| phone_number | VARCHAR | unique ? |
| nationality | VARCHAR | ? |
| is_active | BOOLEAN | ? default=True |
| is_verified | BOOLEAN | ? default=False |
| google_id | VARCHAR | unique ? |
| created_at | DATETIME | ? |
| updated_at | DATETIME | ? |
| onboarding_completed | BOOLEAN | ? default=False |
| spoken_languages | JSONB |  |
| is_banned | BOOLEAN | ? default=False |
| ban_reason | VARCHAR | ? |
| banned_at | DATETIME | ? |
| failed_login_count | INTEGER | default=0 |
| locked_until | DATETIME | ? |
| is_test_account | BOOLEAN | default=False |

## withdrawals

| Columna | Tipo | Notas |
|---|---|---|
| id | INTEGER | PK |
| teacher_id | INTEGER | FK→teacher_profiles.id |
| amount | NUMERIC(12, 2) |  |
| status | VARCHAR | ? default=pending |
| destination_method | VARCHAR | ? |
| destination_details | VARCHAR | ? |
| processed_by | INTEGER | ? |
| processed_at | DATETIME | ? |
| rejection_reason | VARCHAR | ? |
| created_at | DATETIME | ? |
| reference | VARCHAR | ? |
| updated_at | DATETIME | ? |
