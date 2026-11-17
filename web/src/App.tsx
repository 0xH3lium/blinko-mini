import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomNav, type Tab } from './components/BottomNav';
import { QuickCapture } from './components/QuickCapture';
import { Toast } from './components/Toast';
import { BlinksPage } from './pages/BlinksPage';
import { EditorPage } from './pages/EditorPage';
import { NotesPage } from './pages/NotesPage';
import { haptic } from './lib/telegram';
import type { Item, ItemType } from './types/item';
import type { ToastTone } from './types/ui';

interface EditorState {
  item: Item | null;
  initialType: ItemType;
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('blinks');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  useEffect(() => {
    if (editor) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  function openItem(item: Item): void {
    haptic('light');
    setEditor({ item, initialType: item.type });
  }

  function openNewNote(): void {
    setEditor({ item: null, initialType: 'note' });
  }

  function handleSaved(item: Item, options?: { keepOpen?: boolean }): void {
    setRefreshKey((value) => value + 1);
    if (options?.keepOpen) {
      setEditor((current) =>
        current ? { item, initialType: current.initialType } : current,
      );
    } else {
      setEditor(null);
    }
  }

  function handleDeleted(): void {
    setRefreshKey((value) => value + 1);
    setEditor(null);
  }

  function handleCaptured(): void {
    setRefreshKey((value) => value + 1);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const showQuickCapture = tab === 'blinks' && !editor;

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-[760px] flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="no-scrollbar app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        aria-hidden={editor ? true : undefined}
      >
        {tab === 'blinks' ? (
          <BlinksPage
            notify={notify}
            onOpenEditor={openItem}
            refreshKey={refreshKey}
          />
        ) : (
          <NotesPage
            notify={notify}
            onOpenEditor={openItem}
            onNewNote={openNewNote}
            refreshKey={refreshKey}
          />
        )}
      </div>

      <div className="relative z-30 shrink-0 px-3 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="pointer-events-none absolute inset-x-0 -top-7 h-7 bg-gradient-to-t from-[var(--app-bg)] to-transparent" />
        {showQuickCapture ? (
          <QuickCapture notify={notify} onCaptured={handleCaptured} />
        ) : null}
        <BottomNav active={tab} onChange={setTab} />
      </div>

      {editor ? (
        <EditorPage
          item={editor.item}
          initialType={editor.initialType}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : null}

      {toast ? (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={dismissToast}
        />
      ) : null}
    </div>
  );
}
