/** Three connected nodes; colour comes from `currentColor`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 30" width="36" height="30" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="7" x2="7" y2="23" />
        <line x1="18" y1="7" x2="29" y2="23" />
        <line x1="7" y1="23" x2="29" y2="23" />
      </g>
      <g fill="currentColor">
        <circle cx="18" cy="6.5" r="5.5" />
        <circle cx="6.5" cy="23" r="6" />
        <circle cx="29.5" cy="23" r="6" />
      </g>
    </svg>
  );
}
