/**
 * daily-financial-summary.ts
 *
 * Fetches today's economic calendar events and sends a summary to Telegram.
 * Schedule this to run daily at 12pm via Windows Task Scheduler.
 *
 * Run manually: bun run daily-financial-summary.ts
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const TIMEZONE = process.env.USER_TIMEZONE || "Asia/Nicosia";

// ============================================================
// FETCH ECONOMIC CALENDAR
// Uses tradingeconomics calendar API (free, no key needed)
// ============================================================

interface EconomicEvent {
  country: string;
  event: string;
  date: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  importance: string;
}

async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  try {
    // Use investing.com calendar via a public proxy
    const today = new Date().toISOString().split("T")[0];

    const response = await fetch(
      `https://economic-calendar.tradingview.com/events?from=${today}T00%3A00%3A00.000Z&to=${today}T23%3A59%3A59.000Z&countries=US,EU,GB,JP,CN`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // Map to our format
    return (data.result || []).map((e: any) => ({
      country: e.country || "",
      event: e.title || e.event || "",
      date: e.date || e.time || "",
      actual: e.actual || "",
      forecast: e.forecast || "",
      previous: e.previous || "",
      importance: e.importance === 3 ? "🔴 High" : e.importance === 2 ? "🟡 Medium" : "⚪ Low",
    }));
  } catch (error) {
    console.error("Calendar fetch error:", error);
    return [];
  }
}

// ============================================================
// FALLBACK: Use Claude web search if calendar fetch fails
// ============================================================

async function fetchCalendarWithClaude(): Promise<string> {
  const { spawn } = await import("bun");

  const today = new Date().toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prompt = `Today is ${today}. 

Search for today's economic calendar events. Focus on:
- US economic releases (CPI, PPI, GDP, NFP, Fed decisions, FOMC, unemployment)
- Major EU/ECB announcements
- Any other high-impact global events

Format your response as a clean summary with:
1. The event name
2. Expected/forecast value if available
3. Why it matters in one sentence

Keep it concise and practical. If no major events today, say so clearly.`;

  try {
    const proc = spawn(
      [CLAUDE_PATH, "-p", prompt, "--output-format", "text"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) return "";
    return output.trim();
  } catch (error) {
    console.error("Claude fetch error:", error);
    return "";
  }
}

// ============================================================
// FORMAT EVENTS INTO MESSAGE
// ============================================================

function formatEvents(events: EconomicEvent[]): string {
  if (events.length === 0) return "";

  // Filter to medium and high importance only
  const important = events.filter(
    (e) => e.importance.includes("High") || e.importance.includes("Medium")
  );

  if (important.length === 0) return "No high or medium impact events today.";

  const lines = important.map((e) => {
    const time = e.date
      ? new Date(e.date).toLocaleTimeString("en-US", {
          timeZone: TIMEZONE,
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    let line = `${e.importance} ${e.country} — ${e.event}`;
    if (time) line += ` (${time})`;
    if (e.forecast) line += `\n   Forecast: ${e.forecast}`;
    if (e.previous) line += ` | Previous: ${e.previous}`;
    if (e.actual) line += `\n   ✅ Actual: ${e.actual}`;
    return line;
  });

  return lines.join("\n\n");
}

// ============================================================
// SEND TELEGRAM MESSAGE
// ============================================================

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Fetching economic calendar...`);

  const today = new Date().toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let messageBody = "";

  // Try TradingView calendar first
  const events = await fetchEconomicCalendar();

  if (events.length > 0) {
    messageBody = formatEvents(events);
  } else {
    // Fallback to Claude web search
    console.log("Calendar API unavailable, using Claude...");
    messageBody = await fetchCalendarWithClaude();
  }

  if (!messageBody) {
    messageBody = "Could not fetch economic calendar today. Check manually at investing.com/economic-calendar";
  }

  const message =
    `📊 <b>Economic Calendar — ${today}</b>\n\n` +
    messageBody +
    `\n\n<i>Times shown in Cyprus time (${TIMEZONE})</i>`;

  console.log("Sending summary to Telegram...");
  const sent = await sendTelegram(message);

  if (sent) {
    console.log("✓ Summary sent!");
  } else {
    console.error("✗ Failed to send summary");
  }
}

main();