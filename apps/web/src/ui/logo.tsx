export function BernouLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="hsl(var(--panel-raised))" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" />
      <circle cx="16" cy="16" r="2.5" fill="hsl(var(--primary))" />
    </svg>
  );
}
