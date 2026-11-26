import { EditorMix } from "./charts/EditorMix";
import { EditSizeChart } from "./charts/EditSizeChart";
import { EditsPerMinuteChart } from "./charts/EditsPerMinuteChart";
import { LiveHeartbeat } from "./charts/LiveHeartbeat";
import { BusiestWikis } from "./components/BusiestWikis";
import { FlaggedEdits } from "./components/FlaggedEdits";
import { Header } from "./components/Header";
import { LiveFeed } from "./components/LiveFeed";
import { PulseCard } from "./components/PulseCard";
import { TopPages } from "./components/TopPages";
import { AssistantChat } from "./features/assistant/AssistantChat";
import { DASHBOARD_TOUR } from "./features/tour/steps";
import { Tour } from "./features/tour/Tour";
import { useTour } from "./features/tour/useTour";
import { useNow } from "./hooks/useNow";
import type { Theme } from "./hooks/useTheme";
import { useWikiPulse } from "./hooks/useWikiPulse";

// Stable empty values, so memoised charts don't re-render before data arrives.
const EMPTY_EDITORS = { registered: 0, bot: 0, anonymous: 0 };
const EMPTY_MINUTES = { keys: [], points: [] };

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** Signed-in user; null when the server has login turned off. */
  user: string | null;
  onLogout?: () => void;
  onUnauthorized?: () => void;
}

export function Dashboard({ theme, onToggleTheme, user, onLogout, onUnauthorized }: Props) {
  const { state, setWiki, togglePause, refreshPulse } = useWikiPulse(undefined, onUnauthorized);
  const now = useNow();
  const tour = useTour();
  const { snapshot } = state;
  const flaggedCount = state.flagged.filter((e) => e.flag?.status === "flagged").length;
  const windowSeconds = snapshot?.window_seconds ?? 300;

  return (
    <div className="app">
      <Header
        connection={state.connection}
        source={state.source}
        wiki={state.wiki}
        wikis={snapshot?.wikis ?? []}
        onWikiChange={setWiki}
        snapshot={snapshot}
        flaggedCount={flaggedCount}
        theme={theme}
        onToggleTheme={onToggleTheme}
        user={user}
        onLogout={onLogout}
        onStartTour={tour.start}
      />
      {state.lastError && (
        <p className="banner" role="alert">
          {state.lastError}
        </p>
      )}
      {/* Command-center grid (see .board in styles/layout.css): what is happening now
          on the first screen, the deeper charts below. */}
      <main className="board">
        <PulseCard pulse={state.pulse} ai={state.ai} now={now} onRefresh={refreshPulse} />
        <LiveHeartbeat series={snapshot?.per_second ?? []} />
        <TopPages pages={snapshot?.top_pages ?? []} windowSeconds={windowSeconds} />
        <LiveFeed
          edits={state.edits}
          feedVersion={state.feedVersion}
          paused={state.paused}
          pendingCount={state.pending.length}
          onTogglePause={togglePause}
        />
        <FlaggedEdits edits={state.flagged} ai={state.ai} />
        <EditsPerMinuteChart data={snapshot?.wiki_minutes ?? EMPTY_MINUTES} />
        <EditSizeChart bins={snapshot?.size_histogram ?? []} windowSeconds={windowSeconds} />
        <EditorMix editors={snapshot?.editors ?? EMPTY_EDITORS} windowSeconds={windowSeconds} />
        <BusiestWikis wikis={snapshot?.wikis ?? []} selected={state.wiki} onSelect={setWiki} />
      </main>
      <footer className="footer muted small">
        Data: Wikimedia EventStreams (recentchange). Edit summaries are written by the public and shown as plain text.
      </footer>
      <AssistantChat wiki={state.wiki} onUnauthorized={onUnauthorized} />
      {tour.open && <Tour steps={DASHBOARD_TOUR} onClose={tour.close} />}
    </div>
  );
}
