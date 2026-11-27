import type { TourStep } from "./Tour";

/** One stop per section of the dashboard, in reading order. */
export const DASHBOARD_TOUR: TourStep[] = [
  {
    title: "Welcome to WikiPulse",
    body: "A quick tour of the dashboard: about a minute. Use Next or the arrow keys, and Skip or Esc to leave any time.",
  },
  {
    target: ".status",
    title: "Connection status",
    body: "Green “Live” means edits are streaming in from Wikipedia right now. If the stream drops, this says so and the app reconnects on its own.",
  },
  {
    target: ".kpis",
    title: "Key numbers",
    body: "Edits per minute, edits in the last few minutes, the share made by bots, how many wikis are active, and how many edits are flagged. They update every second.",
  },
  {
    target: ".wiki-filter",
    title: "Filter by wiki",
    body: "Pick one wiki (for example English or German Wikipedia) and the feed, top pages and charts all narrow to it. Choose “All wikis” to go back.",
  },
  {
    target: ".pulse",
    title: "AI Pulse",
    body: "A short plain-English summary of what is happening across Wikipedia, written by AI every few minutes. Press Refresh for a new one.",
  },
  {
    target: ".heartbeat",
    title: "Live heartbeat",
    body: "Edits per second over the last two minutes. Spikes usually mean a bot run or a breaking news story.",
  },
  {
    target: ".top-pages",
    title: "Top 10 pages",
    body: "The most edited pages in the recent window. A page shooting up here is often in the news.",
  },
  {
    target: ".feed",
    title: "Live feed",
    body: "Recent edits: page, wiki, editor and size change. The feed starts paused and catches up every two minutes, so it stays readable. Press Go live to watch every edit as it arrives, and Pause to stop again.",
  },
  {
    target: ".flagged",
    title: "Possible vandalism",
    body: "Edits that look suspicious, each with a reason. Rules catch them first, then AI reviews them and marks them likely, suspicious or cleared.",
  },
  {
    target: ".chart",
    title: "Edits per minute by wiki",
    body: "How the busiest wikis compare minute by minute. Hover the chart to see exact numbers.",
  },
  {
    target: ".sizes",
    title: "Edit sizes",
    body: "How big edits are: most are small fixes; big additions or removals stand out on the edges.",
  },
  {
    target: ".editors",
    title: "Who is editing",
    body: "The split between registered users, bots and anonymous editors.",
  },
  {
    target: ".wikis",
    title: "Busiest wikis",
    body: "Wikis ranked by activity. Click one to filter the whole dashboard to it.",
  },
  {
    target: ".assistant-fab",
    title: "Ask the AI assistant",
    body: "Have a question? Open the chat and ask in your own words, e.g. “What is trending?” or “Kaun si edits vandalism lagti hain?”. It answers from the live data, for the wiki you have selected.",
  },
  {
    target: ".tour-btn",
    title: "That's it!",
    body: "You can replay this tour any time from the ? button up here.",
  },
];
