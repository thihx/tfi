import type { MatchLiveStreamLink } from '@/lib/services/api';

function LiveStreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
      <path d="M5.5 8.5c1.8-2.2 4.4-3.5 6.5-3.5s4.7 1.3 6.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M3.5 11.5c2.6-3.2 6.1-5 8.5-5s5.9 1.8 8.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M1.5 14.5c3.4-4.2 7.8-6.5 10.5-6.5s7.1 2.3 10.5 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function getLiveStreamTooltip(link: MatchLiveStreamLink, index: number, total: number): string {
  const label = total > 1 ? `Live ${index + 1}` : 'Live';
  const source = link.sourceName?.trim();
  return source ? `${label} · ${source}` : label;
}

interface MatchLiveStreamControlsProps {
  links: MatchLiveStreamLink[];
  onOpen: (link: MatchLiveStreamLink) => void;
  className?: string;
}

export function MatchLiveStreamControls({ links, onOpen, className }: MatchLiveStreamControlsProps) {
  if (links.length === 0) return null;

  return (
    <div className={['match-live-stream-controls', className].filter(Boolean).join(' ')} onClick={(event) => event.stopPropagation()}>
      {links.map((link, index) => {
        const tooltip = getLiveStreamTooltip(link, index, links.length);
        return (
          <button key={link.url} type="button" className="match-live-stream-btn" onClick={() => onOpen(link)} aria-label={tooltip} title={tooltip}>
            <LiveStreamIcon />
            {links.length > 1 ? <span className="match-live-stream-btn__index">{index + 1}</span> : null}
          </button>
        );
      })}
    </div>
  );
}