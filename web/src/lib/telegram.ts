import WebApp from '@twa-dev/sdk';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning';

function applyTelegramTheme(): void {
  const root = document.documentElement;
  const theme = (WebApp.themeParams ?? {}) as unknown as Record<
    string,
    string | undefined
  >;

  for (const [key, value] of Object.entries(theme)) {
    if (value) {
      root.style.setProperty(`--tg-theme-${key.replaceAll('_', '-')}`, value);
    }
  }

  const hasTelegramContext = Boolean(WebApp.initData);
  const colorScheme = hasTelegramContext
    ? WebApp.colorScheme === 'dark'
      ? 'dark'
      : 'light'
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  root.dataset.theme = colorScheme;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    const background =
      theme.bg_color ?? (colorScheme === 'dark' ? '#131210' : '#f5f1e8');
    meta.content = background;
  }
}

export function initTelegram(): void {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.disableVerticalSwipes?.();
    WebApp.setHeaderColor?.('secondary_bg_color');
    WebApp.BackButton.hide();
    WebApp.onEvent('themeChanged', applyTelegramTheme);
    if (!WebApp.initData) {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', applyTelegramTheme);
    }
    applyTelegramTheme();
  } catch (error) {
    console.warn('[Telegram] Running with browser fallbacks.', error);
    applyTelegramTheme();
  }
}

export function getInitData(): string {
  try {
    return WebApp.initData ?? '';
  } catch {
    return '';
  }
}

export function getTelegramColorScheme(): 'light' | 'dark' {
  try {
    return WebApp.colorScheme === 'dark' ? 'dark' : 'light';
  } catch {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
}

export function haptic(style: HapticStyle = 'light'): void {
  try {
    if (style === 'success' || style === 'error' || style === 'warning') {
      WebApp.HapticFeedback.notificationOccurred(style);
    } else {
      WebApp.HapticFeedback.impactOccurred(style);
    }
  } catch {
    // Haptics are a progressive enhancement.
  }
}

export { WebApp };
