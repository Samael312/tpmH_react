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
}

const FALLBACK: BusinessRules = {
  min_booking_hours: 1,
  min_cancel_hours: 12,
  min_reschedule_hours_student: 12,
  allowed_class_durations: [30, 60],
  allowed_package_durations: [30, 60],
  low_credit_threshold: 1,
  low_credit_renotify_days: 6,
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