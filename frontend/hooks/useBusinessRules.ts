import { useState, useEffect } from "react";
import api from "@/lib/api";


export interface BusinessRules {
  min_booking_hours: number;
  min_cancel_hours: number;
  min_reschedule_hours_student: number;
  allowed_class_durations: number[];
  allowed_package_durations: number[];
  low_credit_threshold: number;
  low_credit_renotify_days: number;
  // Duración única de la clase de prueba (minutos) y márgenes de
  // preparación por tipo de clase — ver backend core/class_logic.py.
  trial_duration_minutes: number;
  buffer_trial_minutes: number;
  buffer_regular_minutes: number;
  buffer_group_minutes: number;
  // Minutos antes del inicio de la clase en los que se auto-genera el
  // Meet link si todavía no tiene uno — ver backend core/scheduler.py.
  meet_link_autogen_minutes: number;
}

// Pool fijo del que se eligen las duraciones de clase (regulares/paquetes)
// y la duración de la clase de prueba. No es editable como texto libre.
export const CLASS_DURATION_OPTIONS = [25, 50, 80, 110] as const;

const FALLBACK: BusinessRules = {
  min_booking_hours: 1,
  min_cancel_hours: 12,
  min_reschedule_hours_student: 12,
  allowed_class_durations: [50, 80, 110],
  allowed_package_durations: [50, 80, 110],
  low_credit_threshold: 1,
  low_credit_renotify_days: 6,
  trial_duration_minutes: 25,
  buffer_trial_minutes: 5,
  buffer_regular_minutes: 10,
  buffer_group_minutes: 10,
  meet_link_autogen_minutes: 30,
};

let cache: BusinessRules | null = null;

export function useBusinessRules() {
  const [rules, setRules] = useState<BusinessRules>(cache ?? FALLBACK);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) { setLoading(false); return; }
    api.get("/system-catalogs/business-rules")
      .then(res => { cache = res.data; setRules(res.data); })
      .catch(() => setRules(FALLBACK))
      .finally(() => setLoading(false));
  }, []);

  return { rules, loading };
}