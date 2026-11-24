export type ToastTone = 'success' | 'error' | 'info';
export interface ToastAction { label: string; run: () => void }
export type Notify = (message: string, tone?: ToastTone, action?: ToastAction) => void;
