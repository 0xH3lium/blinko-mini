export type ToastTone = 'success' | 'error' | 'info';

export interface Notify {
  (message: string, tone?: ToastTone): void;
}
