/**
 * Reminder System for Claude Telegram Relay
 * Place this file in: src/reminders.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Reminder {
  id?: string;
  message: string;
  next_run: string;
  schedule_type: "once" | "daily" | "weekly" | "monthly";
  schedule_day?: number;
  schedule_time: string;
  timezone: string;
  active: boolean;
  created_at?: string;
}

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

export async function parseReminderWithClaude(
  userMessage: string,
  timezone: string
): Promise<Reminder | null> {
  const lower = userMessage.toLowerCase();

  // --- SCHEDULE TYPE ---
  let schedule_type: "once" | "daily" | "weekly" | "monthly" = "once";
  let schedule_day: number | undefined;

  if (lower.includes("every day") || lower.includes("daily")) {
    schedule_type = "daily";
  } else if (lower.includes("every week") || lower.includes("weekly")) {
    schedule_type = "weekly";
    schedule_day = 1;
  } else if (lower.includes("every month") || lower.includes("monthly")) {
    schedule_type = "monthly";
  } else if (lower.includes("every")) {
    schedule_type = "weekly";
  }

  // --- DAY OF WEEK ---
  const days: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };
  for (const [name, num] of Object.entries(days)) {
    if (lower.includes(name)) {
      schedule_day = num;
      schedule_type = lower.includes("every") ? "weekly" : "once";
      break;
    }
  }

  // --- TIME ---
  let schedule_time = "09:00";
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    schedule_time = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  if (lower.includes("noon") || lower.includes("midday")) schedule_time = "12:00";
  if (lower.includes("midnight")) schedule_time = "00:00";
  if (lower.includes("morning") && !timeMatch) schedule_time = "09:00";
  if (lower.includes("afternoon") && !timeMatch) schedule_time = "14:00";
  if (lower.includes("evening") && !timeMatch) schedule_time = "18:00";

  // --- MESSAGE ---
  let message = userMessage
    .replace(/remind me (every )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)?/gi, "")
    .replace(/every (day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi, "")
    .replace(/at \d{1,2}(:\d{2})?\s*(am|pm)?/gi, "")
    .replace(/in the (morning|afternoon|evening)/gi, "")
    .replace(/(noon|midnight|midday)/gi, "")
    .replace(/^(to|that i|i need to|about)\s*/gi, "")
    .trim();

  if (!message) message = userMessage;

  // --- NEXT RUN ---
  const now = new Date();
  const [h, m] = schedule_time.split(":").map(Number);
  let next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(h, m);

  if (schedule_type === "weekly" && schedule_day !== undefined) {
    const daysUntil = (schedule_day - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + daysUntil);
  } else if (schedule_type === "daily") {
    if (next <= now) next.setDate(next.getDate() + 1);
  } else if (schedule_type === "once") {
    if (next <= now) next.setDate(next.getDate() + 1);
  }

  return {
    message,
    next_run: next.toISOString(),
    schedule_type,
    schedule_day,
    schedule_time,
    timezone,
    active: true,
  };
}

export async function saveReminder(reminder: Reminder): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("reminders")
      .insert(reminder)
      .select("id")
      .single();
    if (error) throw error;
    return data?.id || null;
  } catch (error) {
    console.error("Failed to save reminder:", error);
    return null;
  }
}

export async function getDueReminders(): Promise<Reminder[]> {
  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .eq("active", true)
      .lte("next_run", now);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to get due reminders:", error);
    return [];
  }
}

export function calculateNextRun(reminder: Reminder): string | null {
  const now = new Date();

  switch (reminder.schedule_type) {
    case "once":
      return null;
    case "daily": {
      const [h, m] = reminder.schedule_time.split(":").map(Number);
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(h, m, 0, 0);
      return next.toISOString();
    }
    case "weekly": {
      const [h, m] = reminder.schedule_time.split(":").map(Number);
      const next = new Date(now);
      const targetDay = reminder.schedule_day ?? 0;
      const daysUntil = (targetDay - next.getDay() + 7) % 7 || 7;
      next.setDate(next.getDate() + daysUntil);
      next.setHours(h, m, 0, 0);
      return next.toISOString();
    }
    case "monthly": {
      const [h, m] = reminder.schedule_time.split(":").map(Number);
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      next.setHours(h, m, 0, 0);
      return next.toISOString();
    }
    default:
      return null;
  }
}

export async function markReminderSent(reminder: Reminder): Promise<void> {
  try {
    const supabase = getSupabase();
    const nextRun = calculateNextRun(reminder);
    if (nextRun) {
      await supabase
        .from("reminders")
        .update({ next_run: nextRun })
        .eq("id", reminder.id);
    } else {
      await supabase
        .from("reminders")
        .update({ active: false })
        .eq("id", reminder.id);
    }
  } catch (error) {
    console.error("Failed to update reminder:", error);
  }
}

export async function listReminders(): Promise<Reminder[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .eq("active", true)
      .order("next_run", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to list reminders:", error);
    return [];
  }
}

export async function deleteReminder(id: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("reminders")
      .update({ active: false })
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Failed to delete reminder:", error);
    return false;
  }
}