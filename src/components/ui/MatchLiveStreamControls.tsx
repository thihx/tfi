import type { MatchLiveStreamLink } from '@/lib/services/api';

function TvIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="m8 3 4 4 4-4" />
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
            <TvIcon />
            {links.length > 1 ? <span className="match-live-stream-btn__index">{index + 1}</span> : null}
          </button>
        );
      })}
    </div>
  );
}