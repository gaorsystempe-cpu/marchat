import React, { useState } from 'react';
import {
  Check,
  Copy,
  Hash,
  Layers,
  Lock,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  Channel,
  MemberRole,
  OnlineUser,
  Profile,
  getAvatarColor,
  getInitials,
  isDirectMessageChannel,
  isSupabaseConfigured,
  sanitizeChannelName,
} from '../supabaseClient';
import { MarLogo } from './MarLogo';

export type { MemberRole };

export interface WorkspaceTeam {
  id: string;
  name: string;
  description: string;
  channelIds: number[];
  memberIds: string[];
}

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  channels: Channel[];
  profilesMap: Record<string, Profile>;
  onlineUsers: OnlineUser[];
  currentUser: Profile;
  teams: WorkspaceTeam[];
  memberRoles: Record<string, MemberRole>;
  onCreateTeam: (name: string, description: string) => void;
  onUpdateTeam: (team: WorkspaceTeam) => void;
  onDeleteTeam: (teamId: string) => void;
  onCreateChannel: (name: string, isPrivate?: boolean) => Promise<{ error?: string }>;
  onRenameChannel: (channelId: number, newName: string) => Promise<{ error?: string }>;
  onDeleteChannel: (channelId: number) => Promise<{ error?: string }>;
  onAddUser: (payload: {
    name: string;
    credentialLabel: string;
    password?: string;
    role: MemberRole;
    teamId: string;
  }) => Promise<{ error?: string; inviteUrl?: string }>;
  onSetMemberRole: (userId: string, role: MemberRole) => void;
  onUpdateMemberName: (userId: string, newName: string) => Promise<{ error?: string }>;
  onDeleteUser?: (userId: string) => Promise<{ error?: string }>;
}

type AdminTab = 'teams' | 'users' | 'channels';

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  channels,
  profilesMap,
  onlineUsers,
  currentUser,
  teams,
  memberRoles,
  onCreateTeam,
  onUpdateTeam,
  onDeleteTeam,
  onCreateChannel,
  onRenameChannel,
  onDeleteChannel,
  onAddUser,
  onSetMemberRole,
  onUpdateMemberName,
  onDeleteUser,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Teams tab state
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');

  // Users tab state
  const [newUserName, setNewUserName] = useState('');
  const [newUserCredential, setNewUserCredential] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<MemberRole>('member');
  const [newUserTeamId, setNewUserTeamId] = useState<string>(teams[0]?.id || '');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserName, setEditingUserName] = useState('');

  // Channels tab state
  const [newChannelInput, setNewChannelInput] = useState('');
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [channelFeedback, setChannelFeedback] = useState<string | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [editingChannelName, setEditingChannelName] = useState('');
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<number | null>(null);

  if (!isOpen) return null;

  const regularChannels = channels.filter((c) => !isDirectMessageChannel(c.name));
  const onlineSet = new Set(onlineUsers.map((u) => u.user_id));
  const membersList = Object.values(profilesMap).sort((a, b) => {
    const aOnline = onlineSet.has(a.id);
    const bOnline = onlineSet.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });

  const handleTeamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (teamName.trim().length < 2) return;
    onCreateTeam(teamName.trim(), teamDesc.trim());
    setTeamName('');
    setTeamDesc('');
  };

  const toggleChannelInTeam = (team: WorkspaceTeam, channelId: number) => {
    const exists = team.channelIds.includes(channelId);
    onUpdateTeam({
      ...team,
      channelIds: exists
        ? team.channelIds.filter((id) => id !== channelId)
        : [...team.channelIds, channelId],
    });
  };

  const toggleMemberInTeam = (team: WorkspaceTeam, memberId: string) => {
    const exists = team.memberIds.includes(memberId);
    onUpdateTeam({
      ...team,
      memberIds: exists
        ? team.memberIds.filter((id) => id !== memberId)
        : [...team.memberIds, memberId],
    });
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMessage(null);
    setInviteLink(null);
    if (newUserName.trim().length < 2) {
      setUserMessage('Ingresa el nombre completo de la persona.');
      return;
    }
    if (newUserCredential.trim().length < 3) {
      setUserMessage('Ingresa un usuario o número de teléfono válido.');
      return;
    }
    if (newUserPassword.trim().length < 6) {
      setUserMessage('Define una contraseña de al menos 6 caracteres para esta cuenta.');
      return;
    }

    setCreatingUser(true);
    const res = await onAddUser({
      name: newUserName.trim(),
      credentialLabel: newUserCredential.trim(),
      password: newUserPassword.trim(),
      role: newUserRole,
      teamId: newUserTeamId || teams[0]?.id || '',
    });
    setCreatingUser(false);

    if (res.error) {
      setUserMessage(res.error);
      return;
    }
    const createdUserCred = newUserCredential.trim();
    setNewUserName('');
    setNewUserCredential('');
    setNewUserPassword('');
    if (res.inviteUrl) {
      setInviteLink(res.inviteUrl);
    }
    setUserMessage(
      isSupabaseConfigured
        ? `Usuario "${createdUserCred}" creado con rol ${newUserRole === 'admin' ? 'Administrador' : 'Miembro'}.`
        : `Cuenta creada (${createdUserCred}) con rol ${newUserRole === 'admin' ? 'Administrador' : 'Miembro'}. Ya puede iniciar sesión.`
    );
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleChannelCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setChannelFeedback(null);
    const slug = sanitizeChannelName(newChannelInput);
    if (slug.length < 2) {
      setChannelFeedback('Usa al menos 2 letras o números para el canal.');
      return;
    }
    const res = await onCreateChannel(slug, newChannelPrivate);
    if (res.error) {
      setChannelFeedback(res.error);
      return;
    }
    setNewChannelInput('');
    setNewChannelPrivate(false);
    setChannelFeedback(`Canal ${newChannelPrivate ? 'privado ' : ''}#${slug} creado.`);
  };

  const handleSaveChannelRename = async (channelId: number) => {
    setChannelFeedback(null);
    const slug = sanitizeChannelName(editingChannelName);
    if (slug.length < 2) {
      setChannelFeedback('El nombre del canal debe tener al menos 2 caracteres.');
      return;
    }
    const res = await onRenameChannel(channelId, slug);
    if (res.error) {
      setChannelFeedback(res.error);
      return;
    }
    setEditingChannelId(null);
    setEditingChannelName('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#151238]/75 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] text-[#1E1B4B] dark:text-[#F5F3FF] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#151238] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <MarLogo size={36} className="shrink-0 shadow-sm" />
            <div className="min-w-0">
              <h2
                id="admin-modal-title"
                className="font-display font-bold text-base sm:text-lg text-[#1E1B4B] dark:text-white truncate"
              >
                Administración de MAR
              </h2>
              <p className="text-xs text-[#1E1B4B]/65 dark:text-[#DDD6FE]/75 truncate">
                Gestiona equipos, miembros, roles y canales
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/50 dark:hover:bg-[#292466] min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
            aria-label="Cerrar administración"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 sm:px-6 pt-3 border-b border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('teams')}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'teams'
                ? 'border-[#5B21B6] dark:border-[#8B5CF6] text-[#5B21B6] dark:text-white'
                : 'border-transparent text-[#1E1B4B]/65 dark:text-[#DDD6FE]/70 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>Equipos ({teams.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'users'
                ? 'border-[#5B21B6] dark:border-[#8B5CF6] text-[#5B21B6] dark:text-white'
                : 'border-transparent text-[#1E1B4B]/65 dark:text-[#DDD6FE]/70 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Usuarios ({membersList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('channels')}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'channels'
                ? 'border-[#5B21B6] dark:border-[#8B5CF6] text-[#5B21B6] dark:text-white'
                : 'border-transparent text-[#1E1B4B]/65 dark:text-[#DDD6FE]/70 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            <Hash className="w-4 h-4 shrink-0" />
            <span>Canales ({regularChannels.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 sm:p-6 space-y-6 bg-white dark:bg-[#1E1B4B]">
          {activeTab === 'teams' && (
            <div className="space-y-6">
              {/* Crear equipo */}
              <form
                onSubmit={handleTeamSubmit}
                className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] p-4 space-y-3"
              >
                <div className="text-xs font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                  Crear nuevo equipo
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <input
                    type="text"
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="Nombre del equipo (ej. Ventas, Producto)"
                    className="sm:col-span-5 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:border-[#8B5CF6] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={teamDesc}
                    onChange={(e) => setTeamDesc(e.target.value)}
                    placeholder="Descripción corta (opcional)"
                    className="sm:col-span-5 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:border-[#8B5CF6] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#5B21B6] hover:bg-[#4C1D95] px-3 py-2 text-xs sm:text-sm font-semibold text-white transition-colors whitespace-nowrap min-h-[40px]"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Crear</span>
                  </button>
                </div>
              </form>

              {/* Lista de equipos */}
              <div className="space-y-4">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238]/60 p-4 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display font-bold text-sm sm:text-base text-[#1E1B4B] dark:text-white">
                          {team.name}
                        </h3>
                        {team.description && (
                          <p className="text-xs text-[#1E1B4B]/65 dark:text-[#DDD6FE]/75 mt-0.5">
                            {team.description}
                          </p>
                        )}
                      </div>
                      {teams.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteTeam(team.id)}
                          className="p-1.5 rounded-lg text-[#5B21B6]/70 dark:text-[#DDD6FE]/70 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          title="Eliminar equipo"
                          aria-label={`Eliminar equipo ${team.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#DDD6FE]/60 dark:border-[#312E81]/60">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#5B21B6] dark:text-[#DDD6FE]/75 mb-2">
                          Canales asignados
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {regularChannels.map((ch) => {
                            const active = team.channelIds.includes(ch.id);
                            return (
                              <button
                                key={ch.id}
                                type="button"
                                onClick={() => toggleChannelInTeam(team, ch.id)}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                  active
                                    ? 'border-[#5B21B6] bg-[#5B21B6] text-white'
                                    : 'border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#1E1B4B] text-[#1E1B4B] dark:text-[#DDD6FE] hover:border-[#8B5CF6]'
                                }`}
                              >
                                {ch.is_private ? (
                                  <Lock className="w-3 h-3" />
                                ) : (
                                  <Hash className="w-3 h-3" />
                                )}
                                <span>{ch.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#5B21B6] dark:text-[#DDD6FE]/75 mb-2">
                          Integrantes
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {membersList.map((member) => {
                            const active = team.memberIds.includes(member.id);
                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => toggleMemberInTeam(team, member.id)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                  active
                                    ? 'border-[#8B5CF6] bg-[#DDD6FE] dark:bg-[#5B21B6] text-[#1E1B4B] dark:text-white'
                                    : 'border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#1E1B4B] text-[#1E1B4B]/75 dark:text-[#DDD6FE]/80 hover:border-[#8B5CF6]'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    onlineSet.has(member.id)
                                      ? 'bg-[#10B981]'
                                      : 'bg-[#8B5CF6]/40'
                                  }`}
                                />
                                <span>{member.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-6">
              {/* Crear / invitar usuario */}
              <form
                onSubmit={handleUserSubmit}
                className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] p-4 space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                  <UserPlus className="w-4 h-4 text-[#FF8A1F]" />
                  <span>Crear usuario y asignar rol</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  <input
                    type="text"
                    required
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Nombre completo"
                    className="lg:col-span-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:border-[#8B5CF6] focus:outline-none"
                  />

                  <input
                    type="text"
                    required
                    value={newUserCredential}
                    onChange={(e) => setNewUserCredential(e.target.value)}
                    placeholder="Usuario o teléfono"
                    className="lg:col-span-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:border-[#8B5CF6] focus:outline-none"
                  />

                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Contraseña (mín. 6)"
                    className="lg:col-span-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:border-[#8B5CF6] focus:outline-none"
                  />

                  <select
                    value={newUserTeamId}
                    onChange={(e) => setNewUserTeamId(e.target.value)}
                    aria-label="Equipo inicial"
                    className="lg:col-span-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2 text-sm text-[#1E1B4B] dark:text-white focus:border-[#8B5CF6] focus:outline-none"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        Equipo: {t.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as MemberRole)}
                    aria-label="Rol"
                    className="lg:col-span-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-2.5 py-2 text-sm text-[#1E1B4B] dark:text-white focus:border-[#8B5CF6] focus:outline-none"
                  >
                    <option value="member">Rol: Miembro</option>
                    <option value="admin">Rol: Admin</option>
                  </select>

                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="lg:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] disabled:opacity-60 px-4 py-2 text-xs sm:text-sm font-bold text-[#1E1B4B] transition-colors whitespace-nowrap min-h-[40px]"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>{creatingUser ? 'Creando...' : 'Crear usuario'}</span>
                  </button>
                </div>

                {userMessage && (
                  <p className="text-xs font-medium text-[#5B21B6] dark:text-[#DDD6FE]">
                    {userMessage}
                  </p>
                )}

                {inviteLink && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/50 bg-white dark:bg-[#1E1B4B] px-3 py-2 text-xs">
                    <span className="font-mono truncate text-[#1E1B4B] dark:text-[#DDD6FE]">
                      {inviteLink}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="inline-flex items-center gap-1 rounded-md bg-[#5B21B6] px-2.5 py-1 text-[11px] font-semibold text-white shrink-0"
                    >
                      {copiedInvite ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copiar enlace</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </form>

              {/* Directorio de usuarios */}
              <div className="space-y-2">
                {membersList.map((member) => {
                  const role = memberRoles[member.id] || (member.id === currentUser.id ? 'admin' : 'member');
                  const isOnline = onlineSet.has(member.id);
                  const memberTeams = teams.filter((t) => t.memberIds.includes(member.id));
                  const isEditing = editingUserId === member.id;

                  return (
                    <div
                      key={member.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238]/60 px-4 py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold ${getAvatarColor(
                              member.id
                            )}`}
                          >
                            {getInitials(member.name)}
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#1E1B4B] ${
                              isOnline ? 'bg-[#10B981]' : 'bg-neutral-300 dark:bg-[#312E81]'
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                autoFocus
                                value={editingUserName}
                                onChange={(e) => setEditingUserName(e.target.value)}
                                className="rounded-md border border-[#8B5CF6] bg-[#F5F3FF] dark:bg-[#1E1B4B] px-2 py-1 text-xs text-[#1E1B4B] dark:text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (editingUserName.trim().length >= 2) {
                                    await onUpdateMemberName(member.id, editingUserName.trim());
                                  }
                                  setEditingUserId(null);
                                }}
                                className="rounded bg-[#5B21B6] px-2 py-1 text-[11px] font-semibold text-white"
                              >
                                Guardar
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[#1E1B4B] dark:text-white truncate">
                                {member.name}
                              </span>
                              {member.id === currentUser.id && (
                                <span className="text-[11px] text-[#8B5CF6] font-medium">(tú)</span>
                              )}
                            </div>
                          )}

                          <div className="text-xs text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70 truncate">
                            {isOnline ? 'En línea' : 'Desconectado'}
                            {memberTeams.length > 0
                              ? ` · ${memberTeams.map((t) => t.name).join(', ')}`
                              : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUserId(member.id);
                            setEditingUserName(member.name);
                          }}
                          className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] transition-colors"
                          title="Editar nombre"
                          aria-label={`Editar nombre de ${member.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        <select
                          value={role}
                          disabled={member.id === currentUser.id || member.id === 'root-admin'}
                          onChange={(e) => onSetMemberRole(member.id, e.target.value as MemberRole)}
                          aria-label={`Rol de ${member.name}`}
                          className="rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#1E1B4B] px-2.5 py-1.5 text-xs font-semibold text-[#5B21B6] dark:text-[#DDD6FE] disabled:opacity-60 focus:border-[#8B5CF6] focus:outline-none"
                        >
                          <option value="member">Miembro</option>
                          <option value="admin">Administrador</option>
                        </select>

                        {onDeleteUser && member.id !== currentUser.id && member.id !== 'root-admin' && (
                          <button
                            type="button"
                            onClick={() => onDeleteUser(member.id)}
                            className="p-2 rounded-lg text-[#5B21B6]/70 dark:text-[#DDD6FE]/70 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            title="Eliminar usuario"
                            aria-label={`Eliminar a ${member.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'channels' && (
            <div className="space-y-5">
              <form
                onSubmit={handleChannelCreate}
                className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] p-4 space-y-3"
              >
                <div className="text-xs font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                  Crear nuevo canal
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-2 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] px-3 py-2">
                    {newChannelPrivate ? (
                      <Lock className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                    ) : (
                      <Hash className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                    )}
                    <input
                      type="text"
                      required
                      maxLength={32}
                      value={newChannelInput}
                      onChange={(e) => setNewChannelInput(e.target.value)}
                      placeholder="ej. anuncios-equipo"
                      className="w-full bg-transparent text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:outline-none"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#1E1B4B] dark:text-[#DDD6FE] cursor-pointer px-1">
                    <input
                      type="checkbox"
                      checked={newChannelPrivate}
                      onChange={(e) => setNewChannelPrivate(e.target.checked)}
                      className="rounded border-[#5B21B6] accent-[#5B21B6]"
                    />
                    <span>Privado</span>
                  </label>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#5B21B6] hover:bg-[#4C1D95] px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-colors whitespace-nowrap min-h-[40px]"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Crear canal</span>
                  </button>
                </div>
                {channelFeedback && (
                  <p className="text-xs font-medium text-[#5B21B6] dark:text-[#DDD6FE]">
                    {channelFeedback}
                  </p>
                )}
              </form>

              <div className="space-y-2">
                {regularChannels.map((ch) => {
                  const isEditing = editingChannelId === ch.id;
                  const isConfirmDelete = confirmDeleteChannelId === ch.id;

                  return (
                    <div
                      key={ch.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238]/60 px-4 py-3"
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                          <Hash className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                          <input
                            type="text"
                            autoFocus
                            value={editingChannelName}
                            onChange={(e) => setEditingChannelName(e.target.value)}
                            className="flex-1 rounded-md border border-[#8B5CF6] bg-[#F5F3FF] dark:bg-[#1E1B4B] px-2.5 py-1.5 text-sm text-[#1E1B4B] dark:text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveChannelRename(ch.id)}
                            className="rounded-lg bg-[#5B21B6] px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingChannelId(null)}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-[#1E1B4B]/70 dark:text-[#DDD6FE]/70"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0">
                            {ch.is_private ? (
                              <Lock className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                            ) : (
                              <Hash className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                            )}
                            <span className="text-sm font-semibold text-[#1E1B4B] dark:text-white truncate">
                              {ch.name}
                            </span>
                            {ch.is_private && (
                              <span className="text-[11px] text-[#8B5CF6] font-medium">
                                Privado
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingChannelId(ch.id);
                                setEditingChannelName(ch.name);
                                setConfirmDeleteChannelId(null);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] px-2.5 py-1.5 text-xs font-medium text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466]"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Renombrar</span>
                            </button>

                            {regularChannels.length > 1 &&
                              (isConfirmDelete ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onDeleteChannel(ch.id);
                                      setConfirmDeleteChannelId(null);
                                    }}
                                    className="rounded-lg bg-red-600 hover:bg-red-700 px-2.5 py-1.5 text-xs font-semibold text-white"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteChannelId(null)}
                                    className="rounded-lg px-2 py-1.5 text-xs text-[#1E1B4B]/70 dark:text-[#DDD6FE]/70"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteChannelId(ch.id)}
                                  className="p-2 rounded-lg text-[#5B21B6]/70 dark:text-[#DDD6FE]/70 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                                  title="Eliminar canal"
                                  aria-label={`Eliminar canal ${ch.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
