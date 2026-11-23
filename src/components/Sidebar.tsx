import React, { useState } from 'react';
import {
  AtSign,
  Hash,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Shield,
  Sun,
  X,
} from 'lucide-react';
import {
  Channel,
  OnlineUser,
  Profile,
  UserAvailability,
  getAvatarColor,
  getDmOtherUserId,
  getInitials,
  isDirectMessageChannel,
  sanitizeChannelName,
} from '../supabaseClient';
import { ThemeMode } from '../hooks/useAutoTheme';
import { PWAInstallButton } from './PWAInstallButton';
import { MarLogo } from './MarLogo';

export type { UserAvailability };

const AVAILABILITY_META: Record<
  UserAvailability,
  { label: string; dotClass: string; textClass: string }
> = {
  available: {
    label: 'Disponible',
    dotClass: 'bg-[#10B981]',
    textClass: 'text-[#10B981]',
  },
  meeting: {
    label: 'En reunión',
    dotClass: 'bg-[#8B5CF6]',
    textClass: 'text-[#DDD6FE]',
  },
  busy: {
    label: 'Ocupado',
    dotClass: 'bg-[#FF8A1F]',
    textClass: 'text-[#FF8A1F]',
  },
  away: {
    label: 'Ausente',
    dotClass: 'bg-slate-400',
    textClass: 'text-slate-300',
  },
};

export const AVAILABILITY_ORDER: UserAvailability[] = ['available', 'meeting', 'busy', 'away'];

interface SidebarProps {
  channels: Channel[];
  activeChannelId: number | null;
  onSelectChannel: (channelId: number) => void;
  onCreateChannel: (name: string, isPrivate?: boolean) => Promise<{ error?: string }>;
  onlineUsers: OnlineUser[];
  profilesMap: Record<string, Profile>;
  currentUser: Profile;
  userStatus?: UserAvailability;
  onCycleUserStatus?: () => void;
  onOpenAdmin?: () => void;
  onMentionUser?: (name: string) => void;
  onStartDirectMessage?: (userId: string, name: string) => void;
  mentionBadges?: Record<number, number>;
  onSignOut: () => void;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  channels,
  activeChannelId,
  onSelectChannel,
  onCreateChannel,
  onlineUsers,
  profilesMap,
  currentUser,
  userStatus = 'available',
  onCycleUserStatus,
  onOpenAdmin,
  onMentionUser,
  onStartDirectMessage,
  mentionBadges = {},
  onSignOut,
  themeMode,
  onCycleTheme,
  isOpenMobile,
  onCloseMobile,
}) => {
  const [creating, setCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const regularChannels = channels.filter((c) => !isDirectMessageChannel(c.name));
  const dmChannels = channels.filter((c) => isDirectMessageChannel(c.name));

  const onlineStatusMap = new Map<string, UserAvailability>(
    onlineUsers.map((u) => [u.user_id, u.status || 'available'])
  );

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const slug = sanitizeChannelName(newChannelName);
    if (slug.length < 2) {
      setCreateError('Usa al menos 2 letras o números.');
      return;
    }
    setSubmitting(true);
    const res = await onCreateChannel(slug, newChannelPrivate);
    setSubmitting(false);
    if (res.error) {
      setCreateError(res.error);
      return;
    }
    setNewChannelName('');
    setNewChannelPrivate(false);
    setCreating(false);
  };

  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeLabel =
    themeMode === 'light' ? 'Tema: Claro' : themeMode === 'dark' ? 'Tema: Oscuro' : 'Tema: Automático';

  const sidebarContent = (
    <aside
      aria-label="Barra lateral del equipo"
      className="flex h-full w-72 md:w-64 lg:w-72 flex-col bg-[#1E1B4B] text-[#F5F3FF] border-r border-[#312E81] select-none"
    >
      {/* Workspace header */}
      <div className="flex min-h-[3.5rem] pt-[env(safe-area-inset-top)] items-center justify-between px-4 border-b border-[#312E81] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <MarLogo size={30} className="shrink-0 shadow-sm" />
          <span className="font-display font-bold text-base tracking-tight text-white truncate">
            MAR
          </span>
        </div>

        <button
          type="button"
          onClick={onCloseMobile}
          className="md:hidden p-2 -mr-2 rounded-lg text-[#DDD6FE] hover:text-white hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Cerrar menú"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable channels, DMs & online presence */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-6">
        {/* Canales */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-xs font-semibold tracking-wide text-[#DDD6FE]/75">
              Canales
            </span>
            <button
              type="button"
              onClick={() => {
                setCreating((prev) => !prev);
                setCreateError(null);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[#DDD6FE] hover:bg-[#5B21B6]/60 hover:text-white transition-colors min-h-[32px]"
              title="Crear canal nuevo"
            >
              <Plus className="w-3.5 h-3.5 text-[#FF8A1F]" />
              <span>Nuevo</span>
            </button>
          </div>

          {creating && (
            <form
              onSubmit={handleCreateSubmit}
              className="mb-2.5 rounded-lg bg-[#151238] border border-[#312E81] p-2.5 space-y-2"
            >
              <div className="flex items-center gap-1 rounded-md bg-[#1E1B4B] border border-[#5B21B6]/60 px-2.5 py-1.5">
                {newChannelPrivate ? (
                  <Lock className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                ) : (
                  <Hash className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                )}
                <input
                  type="text"
                  autoFocus
                  maxLength={32}
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="nombre-del-canal"
                  className="w-full bg-transparent text-xs text-white placeholder:text-[#DDD6FE]/45 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[#DDD6FE]/85 cursor-pointer px-0.5">
                <input
                  type="checkbox"
                  checked={newChannelPrivate}
                  onChange={(e) => setNewChannelPrivate(e.target.checked)}
                  className="rounded border-[#5B21B6] accent-[#8B5CF6]"
                />
                <span>Canal privado</span>
              </label>

              {createError && (
                <p className="text-[11px] text-amber-300 leading-tight">{createError}</p>
              )}
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewChannelName('');
                    setNewChannelPrivate(false);
                    setCreateError(null);
                  }}
                  className="rounded-md px-2.5 py-1 text-xs text-[#DDD6FE] hover:text-white hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[#5B21B6] hover:bg-[#6D28D9] disabled:opacity-60 px-2.5 py-1 text-xs font-semibold text-white transition-colors"
                >
                  {submitting ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </form>
          )}

          <nav aria-label="Lista de canales" className="space-y-0.5">
            {regularChannels.length === 0 ? (
              <p className="px-2 py-2 text-xs text-[#DDD6FE]/70">
                No hay canales aún. Crea el primero.
              </p>
            ) : (
              regularChannels.map((ch) => {
                const isActive = ch.id === activeChannelId;
                const IconComp = ch.is_private ? Lock : Hash;
                const mentionCount = mentionBadges[ch.id] || 0;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      onSelectChannel(ch.id);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors min-h-[40px] ${
                      isActive
                        ? 'bg-[#5B21B6] border-l-[3px] border-[#FF8A1F] text-white font-semibold shadow-sm'
                        : 'text-[#DDD6FE]/85 hover:bg-[#8B5CF6]/15 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <IconComp
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-[#DDD6FE]' : 'text-[#8B5CF6]'
                        }`}
                      />
                      <span className="truncate">{ch.name}</span>
                    </span>
                    {mentionCount > 0 && !isActive && (
                      <span className="inline-flex items-center justify-center rounded-md bg-[#FF8A1F] px-1.5 py-0.5 text-[10px] font-bold font-mono tabular-nums text-[#1E1B4B] shrink-0">
                        @{mentionCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </nav>
        </div>

        {/* Mensajes directos */}
        {dmChannels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-xs font-semibold tracking-wide text-[#DDD6FE]/75">
                Mensajes directos
              </span>
            </div>

            <nav aria-label="Mensajes directos" className="space-y-0.5">
              {dmChannels.map((dm) => {
                const otherId = getDmOtherUserId(dm.name, currentUser.id);
                const otherName =
                  (otherId && profilesMap[otherId]?.name) || 'Compañero';
                const otherStatus = otherId ? onlineStatusMap.get(otherId) : undefined;
                const isActive = dm.id === activeChannelId;
                const mentionCount = mentionBadges[dm.id] || 0;

                return (
                  <button
                    key={dm.id}
                    type="button"
                    onClick={() => {
                      onSelectChannel(dm.id);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors min-h-[38px] ${
                      isActive
                        ? 'bg-[#5B21B6] border-l-[3px] border-[#FF8A1F] text-white font-semibold shadow-sm'
                        : 'text-[#DDD6FE]/85 hover:bg-[#8B5CF6]/15 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <div className="relative shrink-0">
                        <div
                          className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${getAvatarColor(
                            otherId || dm.name
                          )}`}
                        >
                          {getInitials(otherName)}
                        </div>
                        {otherStatus && (
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-[#1E1B4B] ${
                              AVAILABILITY_META[otherStatus]?.dotClass || 'bg-[#10B981]'
                            }`}
                          />
                        )}
                      </div>
                      <span className="truncate">{otherName}</span>
                    </span>
                    {mentionCount > 0 && !isActive && (
                      <span className="inline-flex items-center justify-center rounded-md bg-[#FF8A1F] px-1.5 py-0.5 text-[10px] font-bold font-mono tabular-nums text-[#1E1B4B] shrink-0">
                        @{mentionCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* En línea (Supabase Presence) */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-xs font-semibold tracking-wide text-[#DDD6FE]/75">
              En línea
            </span>
            <span className="text-xs font-mono tabular-nums text-[#DDD6FE]/75">
              {onlineUsers.length}
            </span>
          </div>

          <ul className="space-y-0.5">
            {onlineUsers.map((person) => {
              const isSelf = person.user_id === currentUser.id;
              const status: UserAvailability = isSelf
                ? userStatus
                : person.status || profilesMap[person.user_id]?.status || 'available';
              const meta = AVAILABILITY_META[status] || AVAILABILITY_META.available;

              return (
                <li
                  key={person.user_id}
                  className="group flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 hover:bg-[#8B5CF6]/15 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSelf && onStartDirectMessage) {
                        onStartDirectMessage(person.user_id, person.name);
                        onCloseMobile();
                      } else if (onMentionUser) {
                        onMentionUser(person.name);
                        onCloseMobile();
                      }
                    }}
                    title={
                      isSelf
                        ? `${person.name} (${meta.label})`
                        : `Abrir mensaje directo con ${person.name}`
                    }
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left text-sm text-[#F5F3FF]"
                  >
                    <div className="relative shrink-0">
                      <div
                        className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold ${getAvatarColor(
                          person.user_id
                        )}`}
                      >
                        {getInitials(person.name)}
                      </div>
                      <span
                        aria-label={meta.label}
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#1E1B4B] ${meta.dotClass}`}
                      />
                    </div>
                    <span className="truncate text-xs font-medium">
                      {person.name}
                      {isSelf && (
                        <span className="ml-1 text-[#DDD6FE]/65 font-normal">(tú)</span>
                      )}
                    </span>
                  </button>

                  {onMentionUser && (
                    <button
                      type="button"
                      onClick={() => {
                        onMentionUser(person.name);
                        onCloseMobile();
                      }}
                      title={`Mencionar a @${person.name}`}
                      aria-label={`Mencionar a ${person.name}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-[#DDD6FE] hover:text-white hover:bg-[#5B21B6] transition-opacity shrink-0"
                    >
                      <AtSign className="w-3 h-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Sidebar footer: Install PWA, Admin, Theme, User & Sign out */}
      <div className="border-t border-[#312E81] px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-1.5 shrink-0 bg-[#151238]">
        <PWAInstallButton variant="sidebar" />

        {onOpenAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdmin();
              onCloseMobile();
            }}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[#DDD6FE] hover:text-white hover:bg-[#5B21B6]/50 transition-colors min-h-[38px]"
          >
            <Shield className="w-3.5 h-3.5 text-[#FF8A1F] shrink-0" />
            <span className="truncate">Equipos y usuarios</span>
          </button>
        )}

        <button
          type="button"
          onClick={onCycleTheme}
          className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-[#DDD6FE]/85 hover:text-white hover:bg-[#8B5CF6]/15 transition-colors min-h-[38px]"
        >
          <ThemeIcon className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
          <span className="truncate">{themeLabel}</span>
        </button>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#312E81]">
          <button
            type="button"
            onClick={onCycleUserStatus}
            title="Cambiar tu estado"
            className="flex items-center gap-2.5 min-w-0 text-left rounded-lg px-1 py-1 hover:bg-[#8B5CF6]/15 transition-colors flex-1"
          >
            <div className="relative shrink-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${getAvatarColor(
                  currentUser.id
                )}`}
              >
                {getInitials(currentUser.name)}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#151238] ${
                  AVAILABILITY_META[userStatus]?.dotClass || AVAILABILITY_META.available.dotClass
                }`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {currentUser.name}
              </p>
              <p
                className={`text-[11px] truncate ${
                  AVAILABILITY_META[userStatus]?.textClass || AVAILABILITY_META.available.textClass
                }`}
              >
                {AVAILABILITY_META[userStatus]?.label || AVAILABILITY_META.available.label}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="p-2 rounded-lg text-[#DDD6FE] hover:text-white hover:bg-[#8B5CF6]/20 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:flex h-full shrink-0">{sidebarContent}</div>

      {isOpenMobile && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-[#151238]/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
