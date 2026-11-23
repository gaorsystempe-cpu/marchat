import {
  Channel,
  MemberRole,
  Message,
  OnlineUser,
  Profile,
  normalizePhone,
} from './supabaseClient';

const STORAGE_SESSION_KEY = 'mar_active_user_v2';
const STORAGE_ACCOUNTS_KEY = 'mar_local_accounts_v2';
const STORAGE_MESSAGES_KEY = 'mar_local_messages_v2';
const STORAGE_CHANNELS_KEY = 'mar_local_channels_v2';
const DEMO_CLEANUP_FLAG = 'mar_demo_cleaned_v2';

export interface LocalAccount {
  id: string;
  name: string;
  username: string;
  phone?: string;
  password: string;
  role: MemberRole;
  status: 'available' | 'meeting' | 'busy' | 'away';
  isRoot?: boolean;
}

export const ROOT_DEFAULT_ACCOUNT: LocalAccount = {
  id: 'root-admin',
  name: 'Root',
  username: 'root',
  password: 'root1234',
  role: 'admin',
  status: 'available',
  isRoot: true,
};

export const INITIAL_CHANNELS: Channel[] = [
  { id: 1, name: 'general', is_private: false },
];

export const INITIAL_MESSAGES: Message[] = [];

export function cleanupLegacyDemoStorage(): void {
  try {
    if (localStorage.getItem(DEMO_CLEANUP_FLAG) === '1') return;
    localStorage.removeItem('equipochat_teams_v1');
    localStorage.removeItem('equipochat_roles_v1');
    localStorage.removeItem('equipochat_reactions_v1');
    localStorage.removeItem('equipochat_pins_v1');
    sessionStorage.removeItem('equipochat_preview_user');
    localStorage.setItem(DEMO_CLEANUP_FLAG, '1');
  } catch {
    // ignore storage errors
  }
}

export function loadLocalAccounts(): LocalAccount[] {
  cleanupLegacyDemoStorage();
  try {
    const raw = localStorage.getItem(STORAGE_ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalAccount[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasRoot = parsed.some((a) => a.id === ROOT_DEFAULT_ACCOUNT.id || a.username === 'root');
        return hasRoot ? parsed : [ROOT_DEFAULT_ACCOUNT, ...parsed];
      }
    }
  } catch {
    // ignore
  }
  const initial = [ROOT_DEFAULT_ACCOUNT];
  saveLocalAccounts(initial);
  return initial;
}

export function saveLocalAccounts(accounts: LocalAccount[]): void {
  try {
    localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore
  }
}

function normalizeUserKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

export function authenticateLocalAccount(
  identifier: string,
  password: string
): LocalAccount | null {
  const accounts = loadLocalAccounts();
  const cleanUser = normalizeUserKey(identifier);
  const cleanPhone = normalizePhone(identifier);

  const found = accounts.find(
    (acc) =>
      (acc.username && normalizeUserKey(acc.username) === cleanUser) ||
      (acc.phone && cleanPhone && normalizePhone(acc.phone) === cleanPhone)
  );
  if (!found) return null;
  return found.password === password ? found : null;
}

export function authenticateLocalPhone(phone: string): LocalAccount | null {
  const accounts = loadLocalAccounts();
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return null;
  return accounts.find((acc) => acc.phone && normalizePhone(acc.phone) === cleanPhone) || null;
}

export function createLocalAccount(params: {
  name: string;
  credential: string;
  password: string;
  role: MemberRole;
}): { account?: LocalAccount; error?: string } {
  const accounts = loadLocalAccounts();
  const trimmedName = params.name.trim();
  const rawCred = params.credential.trim();
  const isPhone = /^\+?[0-9\s()-]{8,}$/.test(rawCred);
  const cleanPhone = isPhone ? normalizePhone(rawCred) : undefined;
  const cleanUser = isPhone
    ? `u${cleanPhone!.replace(/\D/g, '')}`
    : normalizeUserKey(rawCred);

  if (trimmedName.length < 2) {
    return { error: 'Ingresa un nombre válido (mínimo 2 caracteres).' };
  }
  if (!isPhone && cleanUser.length < 3) {
    return { error: 'El usuario debe tener al menos 3 letras o números.' };
  }
  if (!isPhone && params.password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  const duplicate = accounts.some(
    (a) =>
      (cleanUser && normalizeUserKey(a.username) === cleanUser) ||
      (cleanPhone && a.phone && normalizePhone(a.phone) === cleanPhone)
  );
  if (duplicate) {
    return { error: 'Ya existe un usuario registrado con ese identificador.' };
  }

  const newAccount: LocalAccount = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmedName,
    username: cleanUser,
    phone: cleanPhone,
    password: params.password || '123456',
    role: params.role,
    status: 'available',
  };

  saveLocalAccounts([...accounts, newAccount]);
  return { account: newAccount };
}

export function updateLocalAccountRole(userId: string, role: MemberRole): void {
  const accounts = loadLocalAccounts();
  saveLocalAccounts(
    accounts.map((a) => (a.id === userId && !a.isRoot ? { ...a, role } : a))
  );
}

export function updateLocalAccountName(userId: string, name: string): void {
  const accounts = loadLocalAccounts();
  saveLocalAccounts(accounts.map((a) => (a.id === userId ? { ...a, name } : a)));
}

export function deleteLocalAccount(userId: string): { error?: string } {
  const accounts = loadLocalAccounts();
  const target = accounts.find((a) => a.id === userId);
  if (!target) return { error: 'Usuario no encontrado.' };
  if (target.isRoot) return { error: 'La cuenta Root no se puede eliminar.' };
  saveLocalAccounts(accounts.filter((a) => a.id !== userId));
  return {};
}

export function accountsToProfilesMap(accounts: LocalAccount[]): Record<string, Profile> {
  const map: Record<string, Profile> = {};
  accounts.forEach((a) => {
    map[a.id] = {
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
    };
  });
  return map;
}

export function accountsToRolesMap(accounts: LocalAccount[]): Record<string, MemberRole> {
  const map: Record<string, MemberRole> = {};
  accounts.forEach((a) => {
    map[a.id] = a.role;
  });
  return map;
}

export function getLocalOnlineUsers(currentUser: Profile): OnlineUser[] {
  return [
    {
      user_id: currentUser.id,
      name: currentUser.name,
      status: currentUser.status || 'available',
      online_at: new Date().toISOString(),
    },
  ];
}

export function loadActiveLocalSession(): Profile | null {
  cleanupLegacyDemoStorage();
  try {
    const raw = sessionStorage.getItem(STORAGE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveActiveLocalSession(profile: Profile | null): void {
  try {
    if (!profile) {
      sessionStorage.removeItem(STORAGE_SESSION_KEY);
    } else {
      sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(profile));
    }
  } catch {
    // ignore storage errors
  }
}

export function loadLocalMessages(): Message[] {
  cleanupLegacyDemoStorage();
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Message[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return INITIAL_MESSAGES;
}

export function saveLocalMessages(messages: Message[]): void {
  try {
    localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages));
  } catch {
    // ignore
  }
}

export function loadLocalChannels(): Channel[] {
  cleanupLegacyDemoStorage();
  try {
    const raw = localStorage.getItem(STORAGE_CHANNELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Channel[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return INITIAL_CHANNELS;
}

export function saveLocalChannels(channels: Channel[]): void {
  try {
    localStorage.setItem(STORAGE_CHANNELS_KEY, JSON.stringify(channels));
  } catch {
    // ignore
  }
}

// Local object URL registry for files attached in local mode
export const previewFileUrls: Record<string, string> = {};
