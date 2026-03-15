/**
 * check-reminders.ts
 * Run this every 2 minutes via Windows Task Scheduler
 */

import { getDueReminders, markReminderSent } from "./src/reminders.ts";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: `⏰ Reminder: ${message}`,
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Checking for due reminders...`);

  const dueReminders = await getDueReminders();

  if (dueReminders.length === 0) {
    console.log("No reminders due.");
    return;
  }

  console.log(`Found ${dueReminders.length} due reminder(s)`);

  for (const reminder of dueReminders) {
    console.log(`Sending: ${reminder.message}`);
    const sent = await sendTelegram(reminder.message);
    if (sent) {
      await markReminderSent(reminder);
      console.log(`✓ Sent: ${reminder.id}`);
    } else {
      console.error(`✗ Failed: ${reminder.id}`);
    }
  }
}

main();