import { isSupabaseConfigured, supabase } from '../supabaseClient';

export const VAPID_PUBLIC_KEY: string =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

const PREFS_STORAGE_KEY = 'mar_push_prefs_v1';

export interface PushPreferences {
  enabled: boolean;
  mentionsOnly: boolean;
}

export interface PushStatusSnapshot {
  supported: boolean;
  pushManagerSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  swReady: boolean;
  hasSubscription: boolean;
  hasVapidKey: boolean;
}

const DEFAULT_PREFS: PushPreferences = {
  enabled: true,
  mentionsOnly: true,
};

const recentlyNotifiedTags = new Set<string>();

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function loadPushPreferences(): PushPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PushPreferences>;
    return {
      enabled: parsed.enabled ?? DEFAULT_PREFS.enabled,
      mentionsOnly: parsed.mentionsOnly ?? DEFAULT_PREFS.mentionsOnly,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePushPreferences(prefs: PushPreferences): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function isWebPushSupported(): boolean {
  return (
    isBrowserNotificationSupported() &&
    isServiceWorkerSupported() &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

/**
 * Detecta si un mensaje menciona directamente al usuario actual (@Nombre Completo,
 * @PrimerNombre o menciones globales @todos / @canal / @equipo).
 */
export function doesMessageMentionUser(
  body: string | null | undefined,
  userName: string
): boolean {
  if (!body || !userName.trim()) return false;
  const normalizedBody = normalizeText(body);
  if (!normalizedBody.includes('@')) return false;

  if (/(?:^|\s)@(todos|canal|equipo|all|channel)\b/.test(normalizedBody)) {
    return true;
  }

  const normalizedName = normalizeText(userName);
  const fullNamePattern = new RegExp(
    `(?:^|[\\s(>,])@${escapeRegExp(normalizedName)}(?=$|[\\s.,;:!?)"'])`
  );
  if (fullNamePattern.test(normalizedBody)) {
    return true;
  }

  const firstName = normalizedName.split(/\s+/)[0] || '';
  if (firstName.length >= 3) {
    const firstNamePattern = new RegExp(
      `(?:^|[\\s(>,])@${escapeRegExp(firstName)}(?=$|[\\s.,;:!?)"'])`
    );
    if (firstNamePattern.test(normalizedBody)) {
      return true;
    }
  }

  return false;
}

export async function getActiveSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
  } catch {
    return null;
  }
}

export async function getPushStatusSnapshot(): Promise<PushStatusSnapshot> {
  const supported = isBrowserNotificationSupported();
  const pushManagerSupported = isWebPushSupported();
  const permission: NotificationPermission | 'unsupported' = supported
    ? Notification.permission
    : 'unsupported';

  const reg = await getActiveSwRegistration();
  let hasSubscription = false;

  if (reg && 'pushManager' in reg) {
    try {
      const sub = await reg.pushManager.getSubscription();
      hasSubscription = !!sub;
    } catch {
      hasSubscription = false;
    }
  }

  return {
    supported,
    pushManagerSupported,
    permission,
    swReady: !!reg,
    hasSubscription,
    hasVapidKey: Boolean(VAPID_PUBLIC_KEY),
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function syncPushSubscriptionToSupabase(
  userId: string,
  sub: PushSubscription
): Promise<void> {
  if (!isSupabaseConfigured || !userId) return;
  const p256dh = arrayBufferToBase64(sub.getKey('p256dh'));
  const auth = arrayBufferToBase64(sub.getKey('auth'));

  await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 180),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
}

export async function enableBrowserPushForUser(
  userId: string
): Promise<{
  ok: boolean;
  permission: NotificationPermission | 'unsupported';
  hasSubscription: boolean;
  error?: string;
}> {
  if (!isBrowserNotificationSupported()) {
    return {
      ok: false,
      permission: 'unsupported',
      hasSubscription: false,
      error: 'Este navegador no soporta notificaciones.',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      ok: false,
      permission,
      hasSubscription: false,
      error:
        permission === 'denied'
          ? 'Permiso bloqueado. Habilita las notificaciones desde el candado de la barra de direcciones.'
          : 'No se otorgó permiso para notificaciones.',
    };
  }

  let hasSubscription = false;
  const reg = await getActiveSwRegistration();

  if (reg && 'pushManager' in reg) {
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub && VAPID_PUBLIC_KEY) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      if (sub) {
        hasSubscription = true;
        await syncPushSubscriptionToSupabase(userId, sub);
      }
    } catch {
      // Fallback gracefully to ServiceWorkerRegistration.showNotification while open/background
      hasSubscription = false;
    }
  }

  const prefs = loadPushPreferences();
  savePushPreferences({ ...prefs, enabled: true });

  return { ok: true, permission, hasSubscription };
}

export async function disableBrowserPushForUser(userId: string): Promise<void> {
  const prefs = loadPushPreferences();
  savePushPreferences({ ...prefs, enabled: false });

  const reg = await getActiveSwRegistration();
  if (reg && 'pushManager' in reg) {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        if (isSupabaseConfigured && userId) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        await sub.unsubscribe();
      }
    } catch {
      // ignore unsubscribe errors
    }
  }
}

export interface MentionNotificationPayload {
  title: string;
  body: string;
  channelId?: number | null;
  channelName?: string;
  tag?: string;
  onFallbackClick?: () => void;
}

/**
 * Muestra una notificación usando el Service Worker activo (compatible con PWA y
 * clic para abrir el canal correspondiente), con respaldo a Notification API estándar.
 */
export async function showMentionNotification(
  payload: MentionNotificationPayload
): Promise<boolean> {
  if (!isBrowserNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const dedupeKey = payload.tag || `${payload.title}:${payload.body}`;
  if (payload.tag && recentlyNotifiedTags.has(dedupeKey)) {
    return false;
  }
  if (payload.tag) {
    recentlyNotifiedTags.add(dedupeKey);
    if (recentlyNotifiedTags.size > 100) {
      const first = recentlyNotifiedTags.values().next().value;
      if (first) recentlyNotifiedTags.delete(first);
    }
  }

  const targetUrl = payload.channelId
    ? `/?canal=${encodeURIComponent(String(payload.channelId))}`
    : '/';

  const reg = await getActiveSwRegistration();
  if (reg && typeof reg.showNotification === 'function') {
    try {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag || 'mar-mention',
        data: {
          url: targetUrl,
          channelId: payload.channelId ?? null,
          channelName: payload.channelName ?? '',
        },
      });
      return true;
    } catch {
      // Fall through to window Notification fallback
    }
  }

  try {
    const notif = new Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: payload.tag || 'mar-mention',
    });
    notif.onclick = () => {
      window.focus();
      payload.onFallbackClick?.();
      notif.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Envía una solicitud silenciosa a la Edge Function de Supabase (si está configurada
 * con claves VAPID) para despertar navegadores cerrados cuando hay @menciones.
 */
export async function dispatchRemoteMentionPush(params: {
  channelId: number;
  channelName: string;
  senderId: string;
  senderName: string;
  messageBody: string;
  messageId?: number;
}): Promise<void> {
  if (!isSupabaseConfigured || !VAPID_PUBLIC_KEY) return;
  if (!params.messageBody.includes('@')) return;

  try {
    await supabase.functions.invoke('send-mention-push', {
      body: params,
    });
  } catch {
    // Non-blocking: foreground/background SW Realtime alerts still work
  }
}
