"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_HEAD = ['L','M','X','J','V','S','D'];

function toDateStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CalendarPickerProps {
  mode: "single" | "range";
  value?: string;
  onChange?: (d: string) => void;
  rangeStart?: string;
  rangeEnd?: string;
  onRangeChange?: (start: string, end: string) => void;
}

export default function CalendarPicker({
  mode,
  value,
  onChange,
  rangeStart,
  rangeEnd,
  onRangeChange,
}: CalendarPickerProps) {
  const today = new Date();
  const initial = value
    ? new Date(value + 'T00:00:00')
    : rangeStart
      ? new Date(rangeStart + 'T00:00:00')
      : today;

  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());

  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) => (i < offset ? null : i - offset + 1));

  const todayStr = toDateStr(today);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  };

  const select = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (mode === "single") {
      onChange?.(dateStr);
      return;
    }

    if (!rangeStart || (rangeStart && rangeEnd)) {
      onRangeChange?.(dateStr, "");
    } else {
      if (dateStr < rangeStart) {
        onRangeChange?.(dateStr, rangeStart);
      } else {
        onRangeChange?.(rangeStart, dateStr);
      }
    }
  };

  const isInRange = (dateStr: string) => {
    if (mode !== "range" || !rangeStart) return false;
    const end = rangeEnd || rangeStart;
    return dateStr >= rangeStart && dateStr <= end;
  };

  const isRangeEdge = (dateStr: string) => {
    if (mode !== "range") return false;
    return dateStr === rangeStart || dateStr === rangeEnd;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-sm max-w-md mx-auto">
      {/* Cabecera compacta */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={prevMonth}
          className="w-6 h-6 rounded-md bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
        </button>
        <span className="text-xs font-bold text-slate-800">{MONTHS[month]} {year}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="w-6 h-6 rounded-md bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        </button>
      </div>

      {/* Días de la semana */}
      <div className="grid grid-cols-7 mb-1 text-center">
        {DAYS_HEAD.map(d => (
          <div key={d} className="text-[10px] font-bold text-slate-400 py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Grilla de días ajustada */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = mode === "single" ? dateStr === value : isRangeEdge(dateStr);
          const inRange = mode === "range" && isInRange(dateStr) && !isRangeEdge(dateStr);
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;

          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => select(day)}
              className={`
                h-7 w-full rounded-md text-[11px] font-semibold flex items-center justify-center transition-all duration-150
                ${isSelected
                  ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white font-bold shadow-xs'
                  : inRange
                    ? 'bg-pink-100/70 text-pink-700 font-semibold'
                    : isPast
                      ? 'text-slate-300 cursor-not-allowed'
                      : isToday
                        ? 'bg-pink-50 text-pink-600 font-bold border border-pink-200'
                        : 'text-slate-700 hover:bg-pink-50 hover:text-pink-600'
                }
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}