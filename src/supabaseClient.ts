import { createClient } from '@supabase/supabase-js';

// ============================================================================
// CONFIGURACIÓN DE SUPABASE
// Reemplaza estos valores con los de tu proyecto en Supabase (Settings -> API)
// o define VITE_SUPABASE_URL y VITE_SUPABASE_KEY en Vercel / Netlify.
// ============================================================================
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://TU_PROYECTO.supabase.co';

export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_KEY || 'TU_SUPABASE_ANON_PUBLIC_KEY';

export const isSupabaseConfigured: boolean =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_KEY) &&
  !SUPABASE_URL.includes('TU_PROYECTO') &&
  !SUPABASE_KEY.includes('TU_SUPABASE_ANON_PUBLIC_KEY');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function createEphemeralAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export type UserAvailability = 'available' | 'meeting' | 'busy' | 'away';
export type MemberRole = 'admin' | 'member';

export interface Profile {
  id: string;
  name: string;
  role?: MemberRole;
  status?: UserAvailability;
}

export interface Channel {
  id: number;
  name: string;
  is_private?: boolean;
  team_id?: number | null;
}

export interface TeamRecord {
  id: number;
  name: string;
  description: string | null;
}

export interface Message {
  id: number;
  channel_id: number;
  user_id: string;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  created_at: string;
  parent_id?: number | null;
}

export interface MessageReaction {
  id?: number;
  message_id: number;
  user_id: string;
  emoji: string;
}

export interface PinnedMessageRecord {
  channel_id: number;
  message_id: number;
  pinned_by?: string | null;
}

export interface OnlineUser {
  user_id: string;
  name: string;
  status?: UserAvailability;
  online_at: string;
}

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const DM_PREFIX = 'dm:';

export function buildDmChannelName(userA: string, userB: string): string {
  const sorted = [userA, userB].sort();
  return `${DM_PREFIX}${sorted[0]}:${sorted[1]}`;
}

export function isDirectMessageChannel(name: string): boolean {
  return name.startsWith(DM_PREFIX);
}

export function getDmOtherUserId(name: string, currentUserId: string): string | null {
  if (!isDirectMessageChannel(name)) return null;
  const parts = name.slice(DM_PREFIX.length).split(':');
  if (parts.length !== 2) return null;
  return parts[0] === currentUserId ? parts[1] : parts[0];
}

const THREAD_MARKER_RE = /^\[\[(?:hilo|thread):(\d+)\]\]\r?\n?/;

export function parseThreadMessage(msg: Message): {
  parentId: number | null;
  cleanBody: string | null;
} {
  let parentId: number | null =
    typeof msg.parent_id === 'number' && Number.isFinite(msg.parent_id)
      ? msg.parent_id
      : null;
  let cleanBody = msg.body;

  if (cleanBody) {
    const match = cleanBody.match(THREAD_MARKER_RE);
    if (match) {
      if (parentId === null) {
        parentId = Number(match[1]);
      }
      const stripped = cleanBody.replace(THREAD_MARKER_RE, '');
      cleanBody = stripped.length > 0 ? stripped : null;
    }
  }

  return { parentId, cleanBody };
}

export function stripThreadMarker(body: string | null | undefined): string {
  if (!body) return '';
  return body.replace(THREAD_MARKER_RE, '');
}

export function encodeThreadMarker(parentId: number, body: string): string {
  return `[[hilo:${parentId}]]\n${body}`;
}

export function usernameToSyntheticEmail(username: string): string {
  const clean = username
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
  return `${clean}@equipo.local`;
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim().replace(/[\s()-]/g, '');
  if (!trimmed) return '';
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

export function sanitizeChannelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_TONES = [
  'bg-[#5B21B6] text-white',
  'bg-[#8B5CF6] text-white',
  'bg-[#4338CA] text-white',
  'bg-[#6D28D9] text-white',
  'bg-[#7C3AED] text-white',
  'bg-[#312E81] text-white',
];

export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function isImageFile(fileName: string | null): boolean {
  if (!fileName) return false;
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(fileName);
}

export function translateAuthError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'Usuario, teléfono o contraseña incorrectos.';
  }
  if (msg.includes('user already registered')) {
    return 'Este usuario o teléfono ya está registrado.';
  }
  if (msg.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (msg.includes('token has expired') || msg.includes('otp')) {
    return 'El código SMS es inválido o ha expirado.';
  }
  if (msg.includes('phone') && msg.includes('invalid')) {
    return 'Ingresa un número válido con código de país (ej. +51999888777).';
  }
  if (msg.includes('email not confirmed')) {
    return 'Desactiva "Confirm email" en Supabase Authentication para acceso sin correo.';
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'No se pudo conectar con Supabase. Verifica SUPABASE_URL y SUPABASE_KEY.';
  }
  return message;
}
