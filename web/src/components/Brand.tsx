export function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Blinko Mini">
      <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[11px] bg-[var(--app-text)] font-display text-[21px] italic leading-none text-[var(--app-bg)] shadow-[0_4px_14px_-6px_rgba(0,0,0,0.5)]">
        b
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[var(--app-accent)] opacity-90" />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold tracking-[-0.03em] text-[var(--app-text)]">
          blinko
        </span>
        <span className="rounded-full border border-[var(--app-border)] px-1.5 py-px text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--app-hint)]">
          mini
        </span>
      </span>
    </div>
  );
}
