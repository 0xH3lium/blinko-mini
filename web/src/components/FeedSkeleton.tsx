import { cn } from '../lib/utils';

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[22px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-12 rounded-full bg-[color-mix(in_srgb,var(--app-text)_8%,transparent)]" />
            <span className="h-2.5 w-10 rounded-full bg-[color-mix(in_srgb,var(--app-text)_6%,transparent)]" />
          </div>
          <div className="mt-3 h-3.5 w-[88%] rounded-full bg-[color-mix(in_srgb,var(--app-text)_8%,transparent)]" />
          <div className="mt-2 h-3.5 w-[64%] rounded-full bg-[color-mix(in_srgb,var(--app-text)_6%,transparent)]" />
          <div className="mt-4 flex gap-1.5">
            <span className="h-5 w-14 rounded-full bg-[color-mix(in_srgb,var(--app-text)_6%,transparent)]" />
            <span className="h-5 w-12 rounded-full bg-[color-mix(in_srgb,var(--app-text)_5%,transparent)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageLoadingLine({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none sticky top-0 z-10 h-[2px] overflow-hidden transition-opacity',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="h-full w-1/3 animate-[loadingline_1.1s_ease-in-out_infinite] rounded-full bg-[var(--app-accent)]" />
    </div>
  );
}
