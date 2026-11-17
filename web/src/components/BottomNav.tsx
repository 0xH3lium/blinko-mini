import { NotebookPen, Zap } from 'lucide-react';
import { haptic } from '../lib/telegram';
import { cn } from '../lib/utils';

export type Tab = 'blinks' | 'notes';

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof Zap;
}> = [
  { id: 'blinks', label: 'Blinks', icon: Zap },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex items-center gap-1 rounded-[22px] border border-[var(--app-border)] p-1.5',
        'bg-[color-mix(in_srgb,var(--app-surface)_82%,transparent)] shadow-[0_12px_36px_-18px_rgba(25,20,10,0.4)]',
        'backdrop-blur-2xl',
      )}
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (isActive) return;
              haptic('light');
              onChange(id);
            }}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'group relative flex h-11 flex-1 items-center justify-center gap-2 rounded-[16px] text-[13px] font-semibold transition-all duration-300',
              isActive
                ? 'bg-[var(--app-text)] text-[var(--app-bg)]'
                : 'text-[var(--app-hint)] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)]',
            )}
          >
            <Icon
              size={16}
              strokeWidth={isActive ? 2.2 : 1.9}
              className={cn('transition', isActive && 'text-[var(--app-bg)]')}
            />
            <span>{label}</span>
            {isActive ? (
              <span className="absolute right-3 h-1 w-1 rounded-full bg-[var(--app-bg)] opacity-45" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
