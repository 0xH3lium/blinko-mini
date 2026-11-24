export type EventType =
  | 'capture.created'
  | 'capture.updated'
  | 'capture.deleted'
  | 'capture.restored'
  | 'capture.bulk'
  | 'edge.updated'
  | 'reminder.updated'
  | 'telemetry.updated'
  | 'sweep.progress';

export interface AppEvent {
  type: EventType;
  data: unknown;
}

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(type: EventType, data: unknown): void {
  const event: AppEvent = { type, data };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[Events] listener failed:', error);
    }
  }
}

export function listenerCount(): number {
  return listeners.size;
}
