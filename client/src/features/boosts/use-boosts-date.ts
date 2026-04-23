import { addDays, subDays } from "date-fns";
import { useMemo, useState } from "react";

const ET_TIME_ZONE = "America/New_York";
const ET_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getEtDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = ET_DATE_PARTS_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);

  return { year, month, day };
}

function getTodayETDateAtNoon(): Date {
  const { year, month, day } = getEtDateParts(new Date());
  // Store date-only state as ET noon to avoid DST/midnight edge cases when adding/subtracting days.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatDateET(date: Date): string {
  const { year, month, day } = getEtDateParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function useBoostsDate() {
  const [selectedDate, setSelectedDate] = useState<Date>(() => getTodayETDateAtNoon());
  const selectedDateKey = useMemo(() => formatDateET(selectedDate), [selectedDate]);

  const goToPreviousDay = () => {
    setSelectedDate((currentDate) => subDays(currentDate, 1));
  };

  const goToNextDay = () => {
    setSelectedDate((currentDate) => addDays(currentDate, 1));
  };

  return {
    selectedDate,
    selectedDateKey,
    setSelectedDate,
    goToPreviousDay,
    goToNextDay,
  };
}
