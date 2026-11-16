# SCHEMAS (generado)

Modelos Pydantic (`app/schemas`) con campos y validadores.


## schemas/admin.py

- **PlatformStatsResponse** — total_users: int; total_students: int; total_teachers: int; total_teachers_pending: int; total_teachers_approved: int; total_classes: int; classes_this_month: int; classes_completed: int; classes_cancelled: int; total_revenue: float; total_paid_to_teachers: float; total_platform_earnings: float; pending_withdrawals: float; new_users_this_week: int; new_classes_this_week: int
- **TeacherAdminResponse** — id: int; user_id: int; username: str; name: str; surname: str; email: str; status: str; commission_rate: float; balance: float; total_classes: int; total_students: int; created_at: datetime; video_url: Optional[str] = None; theme_color: Optional[str] = None; profile_photo_url: Optional[str] = None; phone_number: Optional[str] = None; nationality: Optional[str] = None; rejection_reason: Optional[str] = None; appeal_count: int = 0; appeal_exhausted: bool = False; has_pending_appeal: bool = False
- **UpdateTeacherStatusRequest** — status: str; reason: Optional[str] = None
- **UpdateCommissionRequest** — commission_rate: float
- **UserAdminResponse** — id: int; username: str; email: str; name: str; surname: str; phone_number: Optional[str] = None; nationality: Optional[str] = None; role: str; is_active: bool; is_verified: bool; is_banned: bool = False; ban_reason: Optional[str] = None; banned_at: Optional[datetime] = None; created_at: datetime
- **PaginatedUsersResponse** — total: int; users: List[UserAdminResponse]
- **UpdateUserStatusRequest** — is_active: bool; reason: Optional[str] = None
- **AdminUserUpdate** — role: Optional[str] = None; is_active: Optional[bool] = None; phone_number: Optional[str] = None; nationality: Optional[str] = None
- **BanStudentRequest** — reason: str  _(validadores: validate_reason)_

## schemas/auth.py

- **GoogleAuthResponse** — needs_registration: bool = False; access_token: Optional[str] = None; token_type: str = 'bearer'; role: Optional[str] = None; name: Optional[str] = None; username: Optional[str] = None; email: Optional[EmailStr] = None; surname: Optional[str] = None; avatar: Optional[str] = None
- **GoogleRegisterRequest** — id_token: str; username: str; role: str  _(validadores: validate_role, validate_username)_
- **RegisterRequest** — email: EmailStr; username: str = Field(min_length=3, max_length=50); password: str = Field(min_length=8, max_length=128); name: str = Field(min_length=1, max_length=100); surname: str = Field(min_length=1, max_length=100); role: str = 'student'  _(validadores: normalize_email, validate_username, validate_password, validate_not_blank, validate_role)_
- **LoginRequest** — login: str = Field(min_length=1, max_length=255); password: str = Field(min_length=1, max_length=128)
- **TokenResponse** — access_token: str; token_type: str = 'bearer'; role: str; name: str; surname: str; username: str; email: str; avatar_url: str | None = None
- **GoogleAuthRequest** — id_token: str
- **ForgotPasswordRequest** — email: EmailStr
- **ForgotUsernameRequest** — email: EmailStr
- **ResetPasswordRequest** — token: str; new_password: str  _(validadores: validate_password)_

## schemas/availability.py

- **WeeklySlotCreate** — day_of_week: int; start_time_local: str; end_time_local: str; is_available: bool = True  _(validadores: validate_day, validate_time_format)_
- **SetWeeklyAvailabilityRequest** — timezone: str; slots: List[WeeklySlotCreate]
- **WeeklySlotResponse** — id: int; teacher_id: int; day_of_week: int; local_day_of_week: int; start_time_utc: str; end_time_utc: str; is_available: bool
- **ExceptionCreate** — date: str; end_date: Optional[str] = None; timezone: str; is_full_day: bool = False; start_time_local: Optional[str] = None; end_time_local: Optional[str] = None; is_available: bool = True; reason: Optional[str] = None  _(validadores: validate_time_format)_
- **ExceptionResponse** — id: int; teacher_id: int; start_time_utc: datetime; end_time_utc: datetime; is_available: bool; reason: Optional[str]; is_full_day: bool
- **AvailableSlotResponse** — start_time_utc: datetime; end_time_utc: datetime; duration_minutes: int; is_past: bool = False; too_soon: bool = False; is_preferred: bool = False; is_available: bool = True; buffer_minutes: int = 0; block_end_time_utc: datetime
- **PreferenceDraft** — day_of_week: int; start_time_local: str; end_time_local: str
- **UpdatePreferencesRequest** — preferences: List[PreferenceDraft]

## schemas/chat.py

- **SendMessageRequest** — content: str; client_id: Optional[str] = Field(None, max_length=64)  _(validadores: validate_content)_
- **ChatUserSummary** — username: str; name: str; avatar: Optional[str] = None
- **ChatMessageResponse** — id: int; conversation_id: int; sender_id: int; sender_username: str; content: str; created_at: datetime; delivered_at: Optional[datetime] = None; client_id: Optional[str] = None
- **ChatConversationResponse** — id: int; conversation_type: Literal['direct', 'group']; title: str; subtitle: Optional[str] = None; avatar: Optional[str] = None; other_username: Optional[str] = None; cohort_id: Optional[int] = None; last_message_preview: Optional[str] = None; last_message_at: Optional[datetime] = None; unread_count: int = 0
- **ChatConversationAdminResponse** — id: int; conversation_type: Literal['direct', 'group']; title: str; subtitle: Optional[str] = None; teacher_username: Optional[str] = None; teacher_name: Optional[str] = None; student_username: Optional[str] = None; student_name: Optional[str] = None; cohort_id: Optional[int] = None; last_message_preview: Optional[str] = None; last_message_at: Optional[datetime] = None; message_count: int = 0
- **UnreadCountResponse** — unread_count: int

## schemas/chipi.py

- **ChatMessage** — role: str; content: str
- **ChipiRequest** — message: str; screen: str; history: List[ChatMessage] = []; stream: bool = True
- **ChipiResponse** — response: str; screen: str

## schemas/classes.py

- **BookClassRequest** — enrollment_id: int; start_time_utc: datetime; end_time_utc: datetime; day_of_week: Optional[str] = None; duration_minutes: int  _(validadores: validate_duration)_
- **BookTrialRequest** — teacher_username: str; student_id: int; start_time_utc: datetime; end_time_utc: datetime; day_of_week: Optional[str] = None; subject: str; duration_minutes: int = 30  _(validadores: validate_duration)_
- **RescheduleClassRequest** — start_time_utc: datetime; end_time_utc: datetime; day_of_week: Optional[str] = None  _(validadores: require_timezone)_
- **UpdateClassStatusRequest** — status: str; notes: Optional[str] = None  _(validadores: validate_status)_
- **UpdateMeetLinkRequest** — meet_link: Optional[str] = None  _(validadores: validate_meet_link)_
- **ClassResponse** — id: int; enrollment_id: Optional[int]; teacher_id: int; teacher_username: Optional[str] = None; student_id: Optional[int] = None; class_type: str; subject: Optional[str]; start_time_utc: datetime; end_time_utc: datetime; day_of_week: Optional[str]; duration_minutes: int; status: str; meet_link: Optional[str] = None; notes: Optional[str]; teacher_timezone: Optional[str]; student_timezone: Optional[str]; created_at: datetime; teacher_nationality: Optional[str] = None; student_nationality: Optional[str] = None; teacher_phone: Optional[str] = None; teacher_name: Optional[str] = None; teacher_avata
- **ClassListResponse** — classes: List[ClassResponse]; total: int; upcoming: int; completed: int
- **GodModeCreateClassRequest** — teacher_id: int; student_id: int; start_time_utc: datetime; duration_minutes: int; class_type: str = 'regular'; subject: Optional[str] = None; enrollment_id: Optional[int] = None; status: str = 'confirmed'; notes: Optional[str] = None; consume_credit: Optional[bool] = None; skip_conflict_check: bool = False  _(validadores: validate_class_type, validate_duration_minutes, validate_status)_
- **GodModeRescheduleClassRequest** — start_time_utc: datetime; duration_minutes: Optional[int] = None; skip_conflict_check: bool = False
- **GodModeForceStatusRequest** — status: str; notes: Optional[str] = None  _(validadores: validate_status)_

## schemas/cohorts.py

- **CohortCreate** — package_id: int; min_students: int; max_students: int  _(validadores: validate_min, validate_max)_
- **CohortEditRequest** — min_students: Optional[int] = None; max_students: Optional[int] = None  _(validadores: validate_positive)_
- **CohortCloseRequest** — start_date: datetime; duration_minutes: int = 50
- **CohortResponse** — id: int; package_id: int; package_name: Optional[str] = None; teacher_id: int; start_date: Optional[datetime] = None; status: str; min_students: int; max_students: int; current_students: int; created_at: datetime; closed_at: Optional[datetime] = None; completed_sessions: int = 0; effective_price: float = 0.0
- **GroupEnrollRequest** — cohort_id: int; payment_method: str; transaction_reference: Optional[str] = None
- **GodModeMoveCohortRequest** — new_cohort_id: Optional[int] = None; force: bool = False; reset_classes_used: bool = False
- **GodModeCohortEditRequest** — min_students: Optional[int] = None; max_students: Optional[int] = None; start_date: Optional[datetime] = None  _(validadores: validate_positive)_
- **GodModeCohortReopenRequest** — new_status: str = 'filling'  _(validadores: validate_new_status)_
- **GodModeCohortActionResponse** — message: str; cohort: CohortResponse
- **GodModeMoveCohortResponse** — message: str
- **GroupToIndividualMigrationRequest** — current_enrollment_id: int; new_package_id: int
- **GroupSessionCreate** — start_time_utc: datetime; duration_minutes: int = 50
- **GroupSessionResponse** — id: int; cohort_id: int; start_time_utc: datetime; end_time_utc: datetime; duration: int; status: str; participant_count: int
- **CohortMemberResponse** — enrollment_id: int; student_id: int; student_name: str; student_avatar: Optional[str] = None; payment_status: str; joined_at: datetime
- **SessionParticipantResponse** — student_id: int; student_name: str; attendance_status: str
- **AttendanceSummaryResponse** — student_id: int; student_name: str; sessions_confirmed: int; sessions_no_show: int; sessions_total: int
- **MarkAttendanceRequest** — attendance_status: str
- **MigrationQuoteResponse** — classes_remaining_in_group: int; remaining_value_usd: float; new_package_name: str; new_package_price: float; difference_usd: float; is_instant: bool

## schemas/god_mode.py

- **GodModeActionBase** — reason: str = Field(..., min_length=5, max_length=500)
- **GodModeAuditLogResponse** — id: int; actor_user_id: int; actor_name: Optional[str] = None; actor_role: str; action: str; entity_type: str; entity_id: int; reason: str; before_data: Optional[dict[str, Any]] = None; after_data: Optional[dict[str, Any]] = None; created_at: datetime
- **GodModeTransferStudentRequest** — from_teacher_id: int; to_teacher_id: int; remove_old_link: bool = False
- **GodModeTransferStudentResponse** — message: str; enrollments_transferred: int; future_classes_transferred: int
- **PaginatedGodModeAuditLogResponse** — items: list[GodModeAuditLogResponse]; total: int; page: int; page_size: int

## schemas/homework.py

- **HomeworkCreate** — title: str; description: str; due_date_utc: datetime; student_ids: List[int] = []; cohort_id: Optional[int] = None
- **HomeworkResponse** — id: int; teacher_id: int; title: str; description: str; due_date_utc: datetime; is_active: bool; created_at: datetime
- **HomeworkUpdate** — title: Optional[str] = None; description: Optional[str] = None; due_date_utc: Optional[datetime] = None  _(validadores: validate_title, validate_description)_
- **HomeworkAssignmentResponse** — id: int; homework_id: int; student_id: int; status: str; submission: Optional[str]; submitted_at: Optional[datetime]; score: Optional[float]; feedback: Optional[str]; graded_at: Optional[datetime]; assigned_at: datetime; homework: HomeworkResponse; student_name: Optional[str] = None; student_username: Optional[str] = None; student_avatar: Optional[str] = None
- **SubmitHomeworkRequest** — submission: str
- **GradeHomeworkRequest** — score: float; feedback: Optional[str] = None  _(validadores: validate_score)_

## schemas/logs.py

- **FrontendErrorReportRequest** — message: str = Field(..., min_length=1, max_length=2000; stack: Optional[str] = None; screen: str = Field(..., description='Ruta del fronten; level: str = Field('error', pattern='^(error|warning); status_code: Optional[int] = None; extra: Optional[dict[str, Any]] = None
- **ErrorLogResponse** — id: int; source: str; level: str; message: str; detail: Optional[str] = None; screen: Optional[str] = None; method: Optional[str] = None; status_code: Optional[int] = None; user_id: Optional[int] = None; user_name: Optional[str] = None; user_role: Optional[str] = None; extra_data: Optional[dict[str, Any]] = None; created_at: datetime
- **PaginatedErrorLogResponse** — items: list[ErrorLogResponse]; total: int; page: int; page_size: int
- **ErrorLogUserOption** — id: int; name: str
- **ErrorLogStats** — total: int; errors: int; warnings: int; backend: int; frontend: int; security: int; last_24h: int

## schemas/materials.py

- **MaterialCreate** — title: str; description: Optional[str] = None; category: str; level: Optional[str] = None; vocabulary_words: Optional[List[str]] = None  _(validadores: validate_category, validate_level)_
- **MaterialResponse** — id: int; teacher_id: int; title: str; description: Optional[str]; category: str; level: Optional[str]; file_url: Optional[str]; file_type: Optional[str]; vocabulary_words: Optional[List[str]]; is_active: bool; created_at: datetime
- **AssignMaterialRequest** — student_ids: List[int] = []; cohort_id: Optional[int] = None
- **MaterialAssignmentResponse** — id: int; material_id: int; student_id: int; progress: str; assigned_at: datetime; completed_at: Optional[datetime]; material: MaterialResponse
- **UpdateProgressRequest** — progress: str  _(validadores: validate_progress)_
- **MaterialUpdate** — title: Optional[str] = None; description: Optional[str] = None; category: Optional[str] = None; level: Optional[str] = None  _(validadores: validate_title)_

## schemas/notifications.py

- **NotificationResponse** — id: int; type: str; title: str; message: Optional[str] = None; related_teacher_id: Optional[int] = None; related_support_ticket_id: Optional[int] = None; is_read: bool; created_at: datetime
- **UnreadCountResponse** — unread_count: int
- **CreateAppealRequest** — message: str  _(validadores: validate_message)_
- **ResolveAppealRequest** — action: str; admin_response: Optional[str] = None  _(validadores: validate_action)_
- **TeacherAppealResponse** — id: int; teacher_id: int; appeal_number: int; message: str; status: str; admin_response: Optional[str] = None; created_at: datetime; resolved_at: Optional[datetime] = None
- **TeacherAppealWithTeacherResponse** — teacher_username: str; teacher_name: str; teacher_surname: str; teacher_status: str

## schemas/packages.py

- **PackageCreate** — name: str; subject: str; description: Optional[str] = None; description_type: str = 'paragraph'; description_items: Optional[List[str]] = None; icon: Optional[str] = '📦'; color: Optional[str] = '#ec4899'; classes_count: Optional[int] = None; price: float; price_per_class: Optional[float] = None; duration_minutes: int = 50; allow_installments: bool = False; installment_count: Optional[int] = None; installment_amount: Optional[float] = None; is_group: bool = False; min_students: Optional[int] = None; max_students: Optional[int] = None; group_schedule_mode: str = 'manual'; group_recurring_days_of  _(validadores: validate_duration_minutes, validate_installments, validate_classes, validate_price, validate_description_type, validate_group_schedule_mode, validate_recurring_days, validate_recurring_time, validate_price_per_class, validate_installment_amount, validate_fixed_schedule_complete)_
- **PackageResponse** — id: int; teacher_id: int; name: str; subject: str; description: Optional[str]; description_type: str = 'paragraph'; description_items: Optional[List[str]] = None; icon: Optional[str] = '📦'; color: Optional[str] = '#ec4899'; classes_count: Optional[int]; price: float; price_per_class: Optional[float] = None; duration_minutes: int; allow_installments: bool = False; installment_count: Optional[int] = None; installment_amount: Optional[float] = None; is_active: bool; created_at: datetime; is_group: bool = False; min_students: Optional[int] = None; max_students: Optional[int] = None; group_schedule
- **EnrollmentResponse** — id: int; student_id: int; package_id: int; teacher_id: int; classes_used: int; classes_total: Optional[int]; status: str; payment_status: Optional[str] = None; installments_paid: Optional[int] = 0; paid_via_installments: Optional[bool] = False; unlocked_credits: Optional[int] = 0; prepaid_unlimited_credits: Optional[int] = 0; available_credits: Optional[int] = None; activated_at: Optional[datetime] = None; renewal_count: int; created_at: datetime; package: PackageResponse; teacher_name: Optional[str] = None; teacher_username: Optional[str] = None; teacher_status: Optional[str] = None; teacher_
- **RenewalRequest** — current_enrollment_id: int; new_package_id: int
- **EnrollmentComplianceResponse** — id: int; student_id: int; student_username: str; student_name: str; package_id: int; package_name: str; classes_used: int; classes_total: Optional[int]; available_credits: Optional[int] = None; status: str; completed_count: int; no_show_count: int; cancelled_late_count: int; renewal_requested_package_name: Optional[str] = None; change_requested_package_name: Optional[str] = None; created_at: datetime
- **PackageChangeRequest** — current_enrollment_id: int; new_package_id: int
- **GodModeEnrollmentAdjustRequest** — unlocked_credits: Optional[int] = Field(None, ge=0); classes_used: Optional[int] = Field(None, ge=0); classes_total: Optional[int] = Field(None, ge=0); prepaid_unlimited_credits: Optional[int] = Field(None, ge=0); installments_paid: Optional[int] = Field(None, ge=0); payment_status: Optional[str] = None; status: Optional[str] = None  _(validadores: validate_payment_status, validate_status)_
- **GodModeChangePackageRequest** — new_package_id: int; reset_classes_used: bool = False
- **GodModeEnrollmentResponse** — message: str; enrollment: EnrollmentResponse
- **PackageChangeApprovalResponse** — message: str; enrollment_id: int; package: str; classes_total: Optional[int]; classes_used: int

## schemas/payments.py

- **PaymentConfigResponse** — paypal_enabled: bool; binance_enabled: bool; bank_transfer_enabled: bool; mobile_payment_enabled: bool; paypal_email: Optional[str]; binance_address: Optional[str]; binance_network: Optional[str]; bank_transfer_details: Optional[str]; mobile_payment_details: Optional[str]; whatsapp_number: Optional[str]; default_commission_rate: float; has_any_method: bool
- **UpdatePaymentConfigRequest** — paypal_enabled: Optional[bool] = None; binance_enabled: Optional[bool] = None; bank_transfer_enabled: Optional[bool] = None; mobile_payment_enabled: Optional[bool] = None; paypal_email: Optional[str] = None; binance_address: Optional[str] = None; binance_network: Optional[str] = None; bank_transfer_details: Optional[str] = None; mobile_payment_details: Optional[str] = None; whatsapp_number: Optional[str] = None; default_commission_rate: Optional[float] = None
- **BookAndPayRequest** — enrollment_id: Optional[int] = None; teacher_username: Optional[str] = None; start_time_utc: datetime; end_time_utc: datetime; duration_minutes: int; subject: Optional[str] = None  _(validadores: require_timezone)_
- **PaymentResponse** — id: int; class_id: Optional[int]; student_id: int; teacher_id: int; amount_total: float; amount_teacher: float; amount_platform: float; payment_method: str; receipt_url: Optional[str]; transaction_id: Optional[str]; status: str; created_at: datetime; validated_at: Optional[datetime]
- **ValidatePaymentRequest** — action: str; rejection_reason: Optional[str] = None  _(validadores: validate_action)_
- **WalletResponse** — available_balance: float; total_earned: float; total_withdrawn: float
- **RefundPaymentInfo** — bank_name: Optional[str] = None; bank_account: Optional[str] = None; account_holder: Optional[str] = None; mobile_payment: Optional[str] = None; paypal_or_zelle: Optional[str] = None; other_notes: Optional[str] = None  _(validadores: validate_at_least_one_field)_
- **RequestRefundTeacherSuspendedRequest** — enrollment_id: int; payment_info: RefundPaymentInfo
- **RequestRefundCohortCancelledRequest** — enrollment_id: int; payment_info: RefundPaymentInfo
- **WithdrawalRequest** — amount: float; destination_method: str; destination_details: str  _(validadores: validate_amount)_
- **WithdrawalResponse** — id: int; teacher_id: int; amount: float; status: str; destination_method: Optional[str]; created_at: datetime
- **NotifyPaymentRequest** — type: str; enrollment_id: Optional[int] = None; package_id: Optional[int] = None; class_id: Optional[int] = None; installment_index: Optional[int] = None; credits_requested: Optional[int] = None; payment_method: Optional[str] = None; transaction_reference: Optional[str] = None; change_option: Optional[str] = None; payment_info: Optional[RefundPaymentInfo] = None  _(validadores: validate_change_option, validate_type, validate_installment)_
- **WithdrawalRequestV2** — amount: float; payment_info: str  _(validadores: validate_amount)_
- **ProcessWithdrawalRequest** — action: str; reference: Optional[str] = None; rejection_reason: Optional[str] = None  _(validadores: validate_action)_
- **GodModeEditPaymentRequest** — amount_total: Optional[float] = Field(None, gt=0); status: Optional[str] = None; rejection_reason: Optional[str] = None; transaction_id: Optional[str] = None  _(validadores: validate_status)_
- **GodModeCreatePaymentRequest** — teacher_id: int; student_id: int; enrollment_id: Optional[int] = None; amount_total: float = Field(..., gt=0); payment_method: str; payment_type: str = 'package'; status: str = 'approved'; transaction_id: Optional[str] = None; is_manual_grant: bool = False  _(validadores: validate_create_status, validate_payment_type)_
- **GodModeEditPaymentResponse** — message: str; payment: PaymentResponse

## schemas/preferences.py

- **PreferenceSlotCreate** — day_of_week: int; start_time_local: str; end_time_local: str  _(validadores: validate_day, validate_time)_
- **SetPreferencesRequest** — timezone: str; slots: List[PreferenceSlotCreate]
- **PreferenceSlotResponse** — id: int; student_id: int; day_of_week: int; local_day_of_week: int; start_time_utc: str; end_time_utc: str; created_at: datetime

## schemas/reviews.py

- **CreateReviewRequest** — rating: float; comment: Optional[str] = None  _(validadores: validate_rating)_
- **ReviewResponse** — id: int; teacher_id: int; student_id: Optional[int] = None; rating: float; comment: Optional[str]; created_at: datetime; student_name: Optional[str] = None; student_username: Optional[str] = None; is_legacy: bool = False; legacy_student_name: Optional[str] = None; total_completed_classes: Optional[int] = None
- **GodModeCreateReviewRequest** — teacher_id: int; rating: float; comment: Optional[str] = None; student_id: Optional[int] = None; legacy_student_name: Optional[str] = Field(None, min_length=2, max_length=150; review_date: Optional[datetime] = None; total_completed_classes: Optional[int] = Field(None, ge=0)  _(validadores: validate_rating, check_identity)_
- **GodModeEditReviewRequest** — rating: Optional[float] = None; comment: Optional[str] = None; legacy_student_name: Optional[str] = Field(None, min_length=2, max_length=150; review_date: Optional[datetime] = None; total_completed_classes: Optional[int] = Field(None, ge=0)  _(validadores: validate_rating)_
- **GodModeReviewActionResponse** — message: str; review: ReviewResponse
- **TeacherRatingSummary** — average_rating: float; total_reviews: int; rating_distribution: dict

## schemas/support.py

- **CreateSupportTicketRequest** — category: str = 'question'; subject: str; message: str; screen_context: Optional[str] = None  _(validadores: validate_category, validate_subject, validate_message)_
- **CreateClassCorrectionRequest** — class_id: int; requested_status: Literal['completed', 'cancelled']; reason: str  _(validadores: validate_reason)_
- **SupportTicketResponse** — id: int; category: str; subject: str; message: str; screen_context: Optional[str] = None; status: str; admin_response: Optional[str] = None; created_at: datetime; resolved_at: Optional[datetime] = None; user_notified_seen: bool; class_id: Optional[int] = None; requested_status: Optional[str] = None; decision: Optional[str] = None
- **UnreadSupportCountResponse** — unread_count: int
- **ResolveSupportTicketRequest** — admin_response: str; decision: Optional[Literal['approved', 'rejected']] = None  _(validadores: validate_admin_response)_
- **SupportTicketWithUserResponse** — user_id: int; user_name: str; user_surname: str; user_username: str; user_email: str; user_role: str

## schemas/system_catalog.py

- **SystemCatalogResponse** — key: str; label: str; value: Any; updated_at: Optional[datetime] = None
- **UpdateSystemCatalogRequest** — value: Any
- **BusinessRulesResponse** — min_booking_hours: int; min_cancel_hours: int; min_reschedule_hours_student: int; allowed_class_durations: List[int]; allowed_package_durations: List[int]; low_credit_threshold: int; low_credit_renotify_days: int; trial_duration_minutes: int; buffer_trial_minutes: int; buffer_regular_minutes: int; buffer_group_minutes: int; meet_link_autogen_minutes: int; min_classes_before_package_change: int
- **UpdateBusinessRulesRequest** — min_booking_hours: Optional[int] = None; min_cancel_hours: Optional[int] = None; min_reschedule_hours_student: Optional[int] = None; allowed_class_durations: Optional[List[int]] = None; allowed_package_durations: Optional[List[int]] = None; low_credit_threshold: Optional[int] = None; low_credit_renotify_days: Optional[int] = None; trial_duration_minutes: Optional[int] = None; buffer_trial_minutes: Optional[int] = None; buffer_regular_minutes: Optional[int] = None; buffer_group_minutes: Optional[int] = None; meet_link_autogen_minutes: Optional[int] = None; min_classes_before_package_change: Opt  _(validadores: validate_min_classes_before_package_change, validate_durations_subset, validate_trial_duration, validate_buffer, validate_meet_link_autogen_minutes)_

## schemas/teacher.py

- **TeacherPublicResponse** — id: int; user_username: str; name: Optional[str] = None; surname: Optional[str] = None; nationality: Optional[str] = None; bio: Optional[str]; title: Optional[str]; timezone: Optional[str]; languages: Optional[List[str]]; subjects: Optional[List[str]]; skills: Optional[List[str]]; certificates: Optional[List[Dict[str, Any]]]; gallery: Optional[List[str]]; social_links: Optional[Dict[str, str]]; status: str; profile_photo_url: Optional[str] = None; video_url: Optional[str] = None; theme_color: Optional[str] = '#ec4899'
- **TeacherProfileResponse** — commission_rate: float; balance: float; stripe_account_id: Optional[str]; created_at: datetime; video_public_id: Optional[str] = None; rejection_reason: Optional[str] = None; rejection_feedback_seen: bool = True; appeal_count: int = 0; appeal_exhausted: bool = False
- **UpdateTeacherProfileRequest** — bio: Optional[str] = None; title: Optional[str] = None; timezone: Optional[str] = None; subjects: Optional[List[str]] = None; languages: Optional[List[str]] = None; skills: Optional[List[str]] = None; certificates: Optional[List[Dict[str, Any]]] = None; gallery: Optional[List[str]] = None; social_links: Optional[Dict[str, str]] = None; theme_color: Optional[str] = None

## schemas/tts.py

- **TTSWordRequest** — word: str; voice: str = 'nova'; speed: float = 0.9  _(validadores: validate_word, validate_voice, validate_speed)_
- **TTSWordResponse** — word: str; audio_url: str; voice: str; speed: float
- **TTSBatchRequest** — words: List[str]; voice: str = 'nova'; speed: float = 0.9  _(validadores: validate_words)_
- **TTSBatchResponse** — audio_urls: Dict[str, Optional[str]]; generated: int; cached: int; failed: int

## schemas/user.py

- **UserBase** — username: str; name: str; surname: str; phone_number: str; email: EmailStr; role: str
- **UserResponse** — id: int; avatar: Optional[str] = None; is_active: bool; is_verified: bool; created_at: datetime; phone_number: Optional[str] = None; nationality: Optional[str] = None; onboarding_completed: bool = False; google_id: Optional[str] = Field(default=None, exclude=True)
- **StudentProfileResponse** — id: int; user_id: int; timezone: Optional[str] = None; goal: Optional[str] = None; phone_number: Optional[str] = None; preferred_payment_methods: Optional[List[str]] = []; teacher_username: Optional[str] = None; created_at: datetime
- **UserUpdate** — name: Optional[str] = None; surname: Optional[str] = None; phone_number: Optional[str] = None; email: Optional[EmailStr] = None; nationality: Optional[str] = None; onboarding_completed: Optional[bool] = None
- **StudentProfileUpdate** — timezone: Optional[str] = None; goal: Optional[str] = None; phone_number: Optional[str] = None; preferred_payment_methods: Optional[List[str]] = None; nationality: Optional[str] = None
- **UpdateProfileRequest** — username: Optional[str] = None; email: Optional[EmailStr] = None; name: Optional[str] = None; surname: Optional[str] = None; avatar: Optional[str] = None; phone_number: Optional[str] = None; timezone: Optional[str] = None; nationality: Optional[str] = None; onboarding_completed: Optional[bool] = None
- **ChangePasswordRequest** — current_password: str; new_password: str  _(validadores: validate_password)_
