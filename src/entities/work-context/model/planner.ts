export interface PlannerCategory {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isSystem: boolean;
}

export interface PlannerRoutine {
  id: string;
  title: string;
  categoryId: string | null;
  weekdays: number[];
  reminderTime: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function monthGridDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function parseWeekdays(value: string): number[] {
  return [...new Set(value.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

export function serializeWeekdays(days: number[]): string {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort().join(",");
}
