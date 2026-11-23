import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import {
  Channel,
  Message,
  OnlineUser,
  Profile,
  TeamRecord,
  buildDmChannelName,
  createEphemeralAuthClient,
  isDirectMessageChannel,
  isSupabaseConfigured,
  normalizePhone,
  parseThreadMessage,
  stripThreadMarker,
  supabase,
  translateAuthError,
  usernameToSyntheticEmail,
} from './supabaseClient';
import {
  accountsToProfilesMap,
  accountsToRolesMap,
  createLocalAccount,
  deleteLocalAccount,
  getLocalOnlineUsers,
  loadActiveLocalSession,
  loadLocalAccounts,
  loadLocalChannels,
  loadLocalMessages,
  saveActiveLocalSession,
  saveLocalChannels,
  saveLocalMessages,
  updateLocalAccountName,
  updateLocalAccountRole,
} from './previewStore';
import { useAutoTheme } from './hooks/useAutoTheme';
import { AuthScreen } from './components/AuthScreen';
import {
  AVAILABILITY_ORDER,
  Sidebar,
  UserAvailability,
} from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import {
  AdminModal,
  MemberRole,
  WorkspaceTeam,
} from './components/AdminModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { MobileInstallBanner } from './components/PWAInstallButton';
import {
  PushPreferences,
  PushStatusSnapshot,
  disableBrowserPushForUser,
  doesMessageMentionUser,
  enableBrowserPushForUser,
  getPushStatusSnapshot,
  loadPushPreferences,
  savePushPreferences,
  showMentionNotification,
} from './utils/pushNotifications';

const DEFAULT_TEAMS: WorkspaceTeam[] = [
  {
    id: 'team-general',
    name: 'Equipo Principal',
    description: 'Espacio principal de coordinación',
    channelIds: [1],
    memberIds: ['root-admin'],
  },
];

export default function App() {
  const { mode: themeMode, cycleMode: cycleTheme } = useAutoTheme();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelMembersMap, setChannelMembersMap] = useState<Record<number, string[]>>({});
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingMention, setPendingMention] = useState<{ name: string; seq: number } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [userStatus, setUserStatus] = useState<UserAvailability>('available');
  const [hasSupabaseTeamsTable, setHasSupabaseTeamsTable] = useState(false);

  const [mentionBadges, setMentionBadges] = useState<Record<number, number>>({});
  const [pushPrefs, setPushPrefs] = useState<PushPreferences>(() => loadPushPreferences());
  const [pushStatus, setPushStatus] = useState<PushStatusSnapshot>({
    supported: typeof window !== 'undefined' && 'Notification' in window,
    pushManagerSupported:
      typeof window !== 'undefined' && 'Notification' in window && 'PushManager' in window,
    permission:
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported',
    swReady: false,
    hasSubscription: false,
    hasVapidKey: false,
  });
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);

  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const activeChannelIdRef = useRef<number | null>(null);
  const visibleChannelsRef = useRef<Channel[]>([]);
  const profilesMapRef = useRef<Record<string, Profile>>({});
  const pushPrefsRef = useRef<PushPreferences>(pushPrefs);
  const currentProfileRef = useRef<Profile | null>(null);
  const handledUrlCanalRef = useRef(false);

  const [teams, setTeams] = useState<WorkspaceTeam[]>(() => {
    if (isSupabaseConfigured) return [];
    try {
      const raw = localStorage.getItem('mar_teams_v2');
      if (raw) return JSON.parse(raw) as WorkspaceTeam[];
    } catch {
      // ignore
    }
    return DEFAULT_TEAMS;
  });

  const [memberRoles, setMemberRoles] = useState<Record<string, MemberRole>>(() => {
    if (isSupabaseConfigured) return {};
    return accountsToRolesMap(loadLocalAccounts());
  });

  // Estado local cuando aún no se configuran claves de Supabase
  const [previewMessages, setPreviewMessages] = useState<Message[]>(() =>
    isSupabaseConfigured ? [] : loadLocalMessages()
  );

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem('mar_teams_v2', JSON.stringify(teams));
    } catch {
      // ignore
    }
  }, [teams]);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    saveLocalMessages(previewMessages);
  }, [previewMessages]);

  useEffect(() => {
    if (isSupabaseConfigured || channels.length === 0) return;
    saveLocalChannels(channels);
  }, [channels]);

  // 1. Auth session bootstrap + listener
  useEffect(() => {
    if (!isSupabaseConfigured) {
      const accounts = loadLocalAccounts();
      const savedUser = loadActiveLocalSession();
      if (savedUser) {
        const freshAcc = accounts.find((a) => a.id === savedUser.id);
        const resolvedUser: Profile = freshAcc
          ? {
              id: freshAcc.id,
              name: freshAcc.name,
              role: freshAcc.role,
              status: freshAcc.status,
            }
          : savedUser;
        setCurrentProfile(resolvedUser);
        if (resolvedUser.status) {
          setUserStatus(resolvedUser.status);
        }
        setProfilesMap(accountsToProfilesMap(accounts));
        setMemberRoles(accountsToRolesMap(accounts));
        const localChannels = loadLocalChannels();
        setChannels(localChannels);
        setActiveChannelId(localChannels[0]?.id ?? null);
        setOnlineUsers(getLocalOnlineUsers(resolvedUser));
      }
      setAuthReady(true);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) {
        setCurrentProfile(null);
        setNeedsName(false);
        setChannels([]);
        setChannelMembersMap({});
        setActiveChannelId(null);
        setOnlineUsers([]);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // 2. Load current user profile (Supabase mode)
  const loadCurrentUserProfile = useCallback(
    async (sess: Session, preferredName?: string) => {
      const userId = sess.user.id;
      let { data: existing, error: selectErr } = await supabase
        .from('profiles')
        .select('id, name, role, status')
        .eq('id', userId)
        .maybeSingle();

      if (selectErr) {
        const fallback = await supabase
          .from('profiles')
          .select('id, name')
          .eq('id', userId)
          .maybeSingle();
        existing = fallback.data as typeof existing;
      }

      if (existing && existing.name?.trim()) {
        const prof = existing as Profile;
        setCurrentProfile(prof);
        if (prof.status) setUserStatus(prof.status);
        if (prof.role) {
          setMemberRoles((prev) => ({ ...prev, [prof.id]: prof.role! }));
        }
        setProfilesMap((prev) => ({ ...prev, [prof.id]: prof }));
        setNeedsName(false);
        return;
      }

      const metaName =
        preferredName?.trim() ||
        (sess.user.user_metadata?.name as string | undefined)?.trim() ||
        '';

      if (metaName) {
        const { count } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true });
        const initialRole: MemberRole = (count ?? 0) === 0 ? 'admin' : 'member';

        let { data: upserted, error: upsertErr } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            name: metaName,
            role: initialRole,
            status: 'available',
          })
          .select('id, name, role, status')
          .single();

        if (upsertErr) {
          const fallbackUpsert = await supabase
            .from('profiles')
            .upsert({ id: userId, name: metaName })
            .select('id, name')
            .single();
          upserted = fallbackUpsert.data as typeof upserted;
        }

        const prof: Profile = (upserted as Profile) || {
          id: userId,
          name: metaName,
          role: initialRole,
          status: 'available',
        };
        setCurrentProfile(prof);
        if (prof.role) {
          setMemberRoles((prev) => ({ ...prev, [prof.id]: prof.role! }));
        }
        setProfilesMap((prev) => ({ ...prev, [prof.id]: prof }));
        setNeedsName(false);
      } else {
        setNeedsName(true);
      }
    },
    []
  );

  useEffect(() => {
    if (isSupabaseConfigured && session) {
      void loadCurrentUserProfile(session);
    }
  }, [session, loadCurrentUserProfile]);

  const handleSaveMissingName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const trimmed = pendingName.trim();
    if (trimmed.length < 2) {
      setNameError('Ingresa un nombre de al menos 2 caracteres.');
      return;
    }
    setSavingName(true);
    setNameError(null);

    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    const initialRole: MemberRole = (count ?? 0) <= 1 ? 'admin' : 'member';

    let { data, error } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, name: trimmed, role: initialRole, status: 'available' })
      .select('id, name, role, status')
      .single();

    if (error) {
      const fallback = await supabase
        .from('profiles')
        .upsert({ id: session.user.id, name: trimmed })
        .select('id, name')
        .single();
      data = fallback.data as typeof data;
      error = fallback.error;
    }

    setSavingName(false);
    if (error) {
      setNameError('No se pudo guardar tu nombre. Inténtalo de nuevo.');
      return;
    }
    const prof: Profile = (data as Profile) || { id: session.user.id, name: trimmed };
    setCurrentProfile(prof);
    if (prof.role) {
      setMemberRoles((prev) => ({ ...prev, [prof.id]: prof.role! }));
    }
    setProfilesMap((prev) => ({ ...prev, [prof.id]: prof }));
    setNeedsName(false);
  };

  // 3. Load team profiles, channels, teams & Realtime subscriptions (Supabase mode)
  useEffect(() => {
    if (!isSupabaseConfigured || !session || !currentProfile) return;

    const fetchWorkspaceData = async () => {
      let profilesRes = await supabase
        .from('profiles')
        .select('id, name, role, status');
      if (profilesRes.error) {
        profilesRes = (await supabase
          .from('profiles')
          .select('id, name')) as typeof profilesRes;
      }

      let channelsRes = await supabase
        .from('channels')
        .select('id, name, is_private, team_id')
        .order('id', { ascending: true });
      if (channelsRes.error) {
        channelsRes = (await supabase
          .from('channels')
          .select('id, name')
          .order('id', { ascending: true })) as typeof channelsRes;
      }

      const [channelMembersRes, teamsRes, teamMembersRes] = await Promise.all([
        supabase.from('channel_members').select('channel_id, user_id'),
        supabase.from('teams').select('id, name, description').order('id', { ascending: true }),
        supabase.from('team_members').select('team_id, user_id'),
      ]);

      if (profilesRes.data) {
        const map: Record<string, Profile> = {};
        const roles: Record<string, MemberRole> = {};
        (profilesRes.data as Profile[]).forEach((p) => {
          map[p.id] = p;
          if (p.role) roles[p.id] = p.role;
        });
        setProfilesMap((prev) => ({ ...prev, ...map }));
        if (Object.keys(roles).length > 0) {
          setMemberRoles((prev) => ({ ...prev, ...roles }));
        }
      }

      const loadedChannels = (channelsRes.data as Channel[]) || [];
      if (channelsRes.data) {
        setChannels(loadedChannels);
        setActiveChannelId((prev) => {
          if (prev !== null && loadedChannels.some((c) => c.id === prev)) return prev;
          const firstPublic = loadedChannels.find((c) => !isDirectMessageChannel(c.name));
          return firstPublic?.id ?? loadedChannels[0]?.id ?? null;
        });
      }

      if (!channelMembersRes.error && channelMembersRes.data) {
        const cmMap: Record<number, string[]> = {};
        (channelMembersRes.data as { channel_id: number; user_id: string }[]).forEach((row) => {
          if (!cmMap[row.channel_id]) cmMap[row.channel_id] = [];
          cmMap[row.channel_id].push(row.user_id);
        });
        setChannelMembersMap(cmMap);
      }

      if (!teamsRes.error && teamsRes.data) {
        setHasSupabaseTeamsTable(true);
        const tmList = (!teamMembersRes.error && teamMembersRes.data
          ? teamMembersRes.data
          : []) as { team_id: number; user_id: string }[];

        const mappedTeams: WorkspaceTeam[] = (teamsRes.data as TeamRecord[]).map((t) => ({
          id: String(t.id),
          name: t.name,
          description: t.description || '',
          channelIds: loadedChannels
            .filter((c) => c.team_id === t.id && !isDirectMessageChannel(c.name))
            .map((c) => c.id),
          memberIds: tmList.filter((tm) => tm.team_id === t.id).map((tm) => tm.user_id),
        }));
        setTeams(mappedTeams);
      } else {
        setHasSupabaseTeamsTable(false);
        setTeams((prev) => (prev.length > 0 ? prev : DEFAULT_TEAMS));
      }
    };

    void fetchWorkspaceData();

    const channelsSub = supabase
      .channel('workspace-channels')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channels' },
        (payload) => {
          const created = payload.new as Channel;
          if (!created?.id) return;
          setChannels((prev) => {
            if (prev.some((c) => c.id === created.id)) return prev;
            return [...prev, created];
          });
          if (!isDirectMessageChannel(created.name)) {
            setActiveChannelId((prev) => (prev === null ? created.id : prev));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'channels' },
        (payload) => {
          const updated = payload.new as Channel;
          if (!updated?.id) return;
          setChannels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'channels' },
        (payload) => {
          const oldCh = payload.old as { id?: number };
          if (!oldCh?.id) return;
          setChannels((prev) => {
            const next = prev.filter((c) => c.id !== oldCh.id);
            setActiveChannelId((cur) => (cur === oldCh.id ? next[0]?.id ?? null : cur));
            return next;
          });
        }
      )
      .subscribe();

    const profilesSub = supabase
      .channel('workspace-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          const updated = payload.new as Profile;
          if (!updated?.id) return;
          setProfilesMap((prev) => ({ ...prev, [updated.id]: updated }));
          if (updated.role) {
            setMemberRoles((prev) => ({ ...prev, [updated.id]: updated.role! }));
          }
          if (updated.id === currentProfile.id) {
            setCurrentProfile((prev) => (prev ? { ...prev, ...updated } : updated));
          }
        }
      )
      .subscribe();

    const workspaceMetaSub = supabase
      .channel('workspace-teams-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        void fetchWorkspaceData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => {
        void fetchWorkspaceData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, () => {
        void fetchWorkspaceData();
      })
      .subscribe();

    const mentionAlertsSub = supabase
      .channel('workspace-mention-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const incoming = payload.new as Message;
          if (!incoming?.id || !incoming.channel_id) return;
          const me = currentProfileRef.current;
          if (!me || incoming.user_id === me.id) return;

          const targetChannel = visibleChannelsRef.current.find(
            (c) => c.id === incoming.channel_id
          );
          if (!targetChannel) return;

          const isDm = isDirectMessageChannel(targetChannel.name);
          const isMentioned = doesMessageMentionUser(incoming.body, me.name);
          const isDifferentChannel = activeChannelIdRef.current !== incoming.channel_id;

          if (isMentioned && isDifferentChannel) {
            setMentionBadges((prev) => ({
              ...prev,
              [incoming.channel_id]: (prev[incoming.channel_id] || 0) + 1,
            }));
          }

          const prefs = pushPrefsRef.current;
          if (!prefs.enabled) return;

          const shouldNotify = isMentioned
            ? isDifferentChannel || document.hidden
            : !prefs.mentionsOnly && (isDm || document.hidden);

          if (!shouldNotify) return;

          const senderName = profilesMapRef.current[incoming.user_id]?.name || 'Compañero';
          const channelLabel = isDm ? senderName : `#${targetChannel.name}`;
          const title = isMentioned
            ? `${senderName} te mencionó en ${channelLabel}`
            : isDm
            ? `Mensaje directo de ${senderName}`
            : `Nuevo mensaje en #${targetChannel.name}`;

          const cleanNotificationBody = stripThreadMarker(incoming.body);
          void showMentionNotification({
            title,
            body: cleanNotificationBody || incoming.file_name || 'Archivo compartido',
            channelId: incoming.channel_id,
            channelName: targetChannel.name,
            tag: `mar-msg-${incoming.id}`,
            onFallbackClick: () => setActiveChannelId(incoming.channel_id),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelsSub);
      supabase.removeChannel(profilesSub);
      supabase.removeChannel(workspaceMetaSub);
      supabase.removeChannel(mentionAlertsSub);
    };
  }, [session, currentProfile?.id]);

  // 4. Supabase Presence for online team members
  useEffect(() => {
    if (!isSupabaseConfigured || !currentProfile) return;

    const presenceChannel = supabase.channel('workspace-presence', {
      config: {
        presence: {
          key: currentProfile.id,
        },
      },
    });
    presenceChannelRef.current = presenceChannel;

    const syncPresence = () => {
      const state = presenceChannel.presenceState<OnlineUser>();
      const usersMap = new Map<string, OnlineUser>();

      Object.entries(state).forEach(([key, entries]) => {
        const latest = entries[entries.length - 1];
        if (latest) {
          usersMap.set(latest.user_id || key, {
            user_id: latest.user_id || key,
            name: latest.name || 'Usuario',
            status: latest.status || 'available',
            online_at: latest.online_at || new Date().toISOString(),
          });
        }
      });

      const list = Array.from(usersMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'es')
      );
      setOnlineUsers(list);
    };

    presenceChannel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: currentProfile.id,
            name: currentProfile.name,
            status: userStatus,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      presenceChannelRef.current = null;
      void presenceChannel.untrack();
      supabase.removeChannel(presenceChannel);
    };
  }, [currentProfile?.id, currentProfile?.name]);

  // Re-track Presence cleanly whenever status changes
  useEffect(() => {
    if (!isSupabaseConfigured || !currentProfile || !presenceChannelRef.current) return;
    void presenceChannelRef.current.track({
      user_id: currentProfile.id,
      name: currentProfile.name,
      status: userStatus,
      online_at: new Date().toISOString(),
    });
  }, [userStatus, currentProfile?.id, currentProfile?.name]);

  const handlePreviewLogin = (profile: Profile) => {
    const accounts = loadLocalAccounts();
    saveActiveLocalSession(profile);
    setCurrentProfile(profile);
    setUserStatus(profile.status || 'available');
    setProfilesMap(accountsToProfilesMap(accounts));
    setMemberRoles(accountsToRolesMap(accounts));
    const localChannels = loadLocalChannels();
    setChannels((prev) => (prev.length > 0 ? prev : localChannels));
    setActiveChannelId((prev) => prev ?? localChannels[0]?.id ?? null);
    setOnlineUsers(getLocalOnlineUsers(profile));
  };

  const handleProfileNeeded = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return;
    let res = await supabase
      .from('profiles')
      .select('id, name, role, status')
      .eq('id', userId)
      .maybeSingle();
    if (res.error) {
      res = (await supabase
        .from('profiles')
        .select('id, name')
        .eq('id', userId)
        .maybeSingle()) as typeof res;
    }
    if (res.data) {
      const prof = res.data as Profile;
      setProfilesMap((prev) => ({ ...prev, [prof.id]: prof }));
      if (prof.role) {
        setMemberRoles((prev) => ({ ...prev, [prof.id]: prof.role! }));
      }
    }
  }, []);

  const handleCreateChannel = async (
    name: string,
    isPrivate = false
  ): Promise<{ error?: string }> => {
    if (
      channels.some(
        (c) => !isDirectMessageChannel(c.name) && c.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return { error: 'Ya existe un canal con ese nombre.' };
    }

    if (!isSupabaseConfigured) {
      const created: Channel = { id: Date.now(), name, is_private: isPrivate };
      setChannels((prev) => [...prev, created]);
      if (isPrivate && currentProfile) {
        setChannelMembersMap((prev) => ({ ...prev, [created.id]: [currentProfile.id] }));
      }
      setActiveChannelId(created.id);
      return {};
    }

    let insertRes = await supabase
      .from('channels')
      .insert({ name, is_private: isPrivate })
      .select('id, name, is_private, team_id')
      .single();

    if (insertRes.error) {
      insertRes = (await supabase
        .from('channels')
        .insert({ name })
        .select('id, name')
        .single()) as typeof insertRes;
    }

    if (insertRes.error) {
      return { error: 'No se pudo crear el canal.' };
    }
    if (insertRes.data) {
      const created = insertRes.data as Channel;
      if (isPrivate && currentProfile) {
        await supabase
          .from('channel_members')
          .upsert({ channel_id: created.id, user_id: currentProfile.id });
        setChannelMembersMap((prev) => ({
          ...prev,
          [created.id]: [...(prev[created.id] || []), currentProfile.id],
        }));
      }
      setChannels((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setActiveChannelId(created.id);
    }
    return {};
  };

  const handleStartDirectMessage = async (targetUserId: string, _targetName: string) => {
    if (!currentProfile || targetUserId === currentProfile.id) return;
    const dmName = buildDmChannelName(currentProfile.id, targetUserId);
    const existing = channels.find((c) => c.name === dmName);
    if (existing) {
      setActiveChannelId(existing.id);
      return;
    }

    if (!isSupabaseConfigured) {
      const created: Channel = { id: Date.now(), name: dmName, is_private: true };
      setChannels((prev) => [...prev, created]);
      setChannelMembersMap((prev) => ({
        ...prev,
        [created.id]: [currentProfile.id, targetUserId],
      }));
      setActiveChannelId(created.id);
      return;
    }

    const remoteExisting = await supabase
      .from('channels')
      .select('id, name, is_private, team_id')
      .eq('name', dmName)
      .maybeSingle();

    if (remoteExisting.data) {
      const found = remoteExisting.data as Channel;
      setChannels((prev) => (prev.some((c) => c.id === found.id) ? prev : [...prev, found]));
      setActiveChannelId(found.id);
      return;
    }

    let insertRes = await supabase
      .from('channels')
      .insert({ name: dmName, is_private: true })
      .select('id, name, is_private, team_id')
      .single();

    if (insertRes.error) {
      insertRes = (await supabase
        .from('channels')
        .insert({ name: dmName })
        .select('id, name')
        .single()) as typeof insertRes;
    }

    if (insertRes.data) {
      const created = insertRes.data as Channel;
      await supabase.from('channel_members').upsert([
        { channel_id: created.id, user_id: currentProfile.id },
        { channel_id: created.id, user_id: targetUserId },
      ]);
      setChannels((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setActiveChannelId(created.id);
    }
  };

  const handleRenameChannel = async (
    channelId: number,
    newName: string
  ): Promise<{ error?: string }> => {
    if (channels.some((c) => c.id !== channelId && c.name.toLowerCase() === newName.toLowerCase())) {
      return { error: 'Ya existe otro canal con ese nombre.' };
    }
    if (!isSupabaseConfigured) {
      setChannels((prev) =>
        prev.map((c) => (c.id === channelId ? { ...c, name: newName } : c))
      );
      return {};
    }
    const { error } = await supabase
      .from('channels')
      .update({ name: newName })
      .eq('id', channelId);
    if (error) {
      return { error: 'No se pudo renombrar el canal.' };
    }
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, name: newName } : c))
    );
    return {};
  };

  const handleDeleteChannel = async (channelId: number): Promise<{ error?: string }> => {
    if (!isSupabaseConfigured) {
      setChannels((prev) => {
        const next = prev.filter((c) => c.id !== channelId);
        if (activeChannelId === channelId) {
          setActiveChannelId(next[0]?.id ?? null);
        }
        return next;
      });
      return {};
    }
    const { error } = await supabase.from('channels').delete().eq('id', channelId);
    if (error) {
      return { error: 'No se pudo eliminar el canal.' };
    }
    setChannels((prev) => {
      const next = prev.filter((c) => c.id !== channelId);
      if (activeChannelId === channelId) {
        setActiveChannelId(next[0]?.id ?? null);
      }
      return next;
    });
    return {};
  };

  const handleAddUser = async ({
    name,
    credentialLabel,
    password,
    role,
    teamId,
  }: {
    name: string;
    credentialLabel: string;
    password?: string;
    role: MemberRole;
    teamId: string;
  }): Promise<{ error?: string; inviteUrl?: string }> => {
    if (!isSupabaseConfigured) {
      const res = createLocalAccount({
        name,
        credential: credentialLabel,
        password: password || '123456',
        role,
      });
      if (res.error || !res.account) {
        return { error: res.error || 'No se pudo crear la cuenta.' };
      }
      const acc = res.account;
      const createdProfile: Profile = {
        id: acc.id,
        name: acc.name,
        role: acc.role,
        status: acc.status,
      };
      setProfilesMap((prev) => ({ ...prev, [acc.id]: createdProfile }));
      setMemberRoles((prev) => ({ ...prev, [acc.id]: acc.role }));
      if (teamId) {
        setTeams((prev) =>
          prev.map((t) =>
            t.id === teamId && !t.memberIds.includes(acc.id)
              ? { ...t, memberIds: [...t.memberIds, acc.id] }
              : t
          )
        );
      }
      return {};
    }

    const rawCred = credentialLabel.trim();
    const pwd = (password || '').trim();
    if (pwd.length < 6) {
      return { error: 'La contraseña debe tener al menos 6 caracteres.' };
    }

    const isPhone = /^\+?[0-9\s()-]{8,}$/.test(rawCred);
    const ephemeral = createEphemeralAuthClient();

    const signUpRes = isPhone
      ? await ephemeral.auth.signUp({
          phone: normalizePhone(rawCred),
          password: pwd,
          options: { data: { name: name.trim() } },
        })
      : await ephemeral.auth.signUp({
          email: usernameToSyntheticEmail(rawCred),
          password: pwd,
          options: { data: { name: name.trim(), username: rawCred } },
        });

    if (signUpRes.error) {
      return { error: translateAuthError(signUpRes.error.message) };
    }

    const newUserId = signUpRes.data.user?.id;
    if (!newUserId) {
      return { error: 'No se pudo obtener el ID del nuevo usuario en Supabase.' };
    }

    await supabase.from('profiles').upsert({
      id: newUserId,
      name: name.trim(),
      role,
      status: 'available',
    });

    const numericTeamId = Number(teamId);
    if (!Number.isNaN(numericTeamId) && hasSupabaseTeamsTable) {
      await supabase.from('team_members').upsert({
        team_id: numericTeamId,
        user_id: newUserId,
      });
    }

    const createdProfile: Profile = {
      id: newUserId,
      name: name.trim(),
      role,
      status: 'available',
    };
    setProfilesMap((prev) => ({ ...prev, [newUserId]: createdProfile }));
    setMemberRoles((prev) => ({ ...prev, [newUserId]: role }));
    if (teamId) {
      setTeams((prev) =>
        prev.map((t) =>
          t.id === teamId && !t.memberIds.includes(newUserId)
            ? { ...t, memberIds: [...t.memberIds, newUserId] }
            : t
        )
      );
    }

    const inviteUrl = `${window.location.origin}/?equipo=${encodeURIComponent(
      teamId || 'general'
    )}`;
    return { inviteUrl };
  };

  const handleDeleteUser = async (userId: string): Promise<{ error?: string }> => {
    if (!isSupabaseConfigured) {
      const res = deleteLocalAccount(userId);
      if (res.error) return res;
      setProfilesMap((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setMemberRoles((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setTeams((prev) =>
        prev.map((t) => ({
          ...t,
          memberIds: t.memberIds.filter((id) => id !== userId),
        }))
      );
      return {};
    }

    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) {
      return { error: 'No se pudo eliminar el usuario.' };
    }
    setProfilesMap((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setMemberRoles((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        memberIds: t.memberIds.filter((id) => id !== userId),
      }))
    );
    return {};
  };

  const handleUpdateMemberName = async (
    userId: string,
    newName: string
  ): Promise<{ error?: string }> => {
    if (!isSupabaseConfigured) {
      updateLocalAccountName(userId, newName);
      setProfilesMap((prev) =>
        prev[userId] ? { ...prev, [userId]: { ...prev[userId], name: newName } } : prev
      );
      setOnlineUsers((prev) =>
        prev.map((u) => (u.user_id === userId ? { ...u, name: newName } : u))
      );
      if (currentProfile?.id === userId) {
        const updated = { ...currentProfile, name: newName };
        setCurrentProfile(updated);
        saveActiveLocalSession(updated);
      }
      return {};
    }

    const { error } = await supabase
      .from('profiles')
      .update({ name: newName })
      .eq('id', userId);
    if (error) {
      return { error: 'No se pudo actualizar el nombre.' };
    }
    setProfilesMap((prev) =>
      prev[userId] ? { ...prev, [userId]: { ...prev[userId], name: newName } } : prev
    );
    if (currentProfile?.id === userId) {
      setCurrentProfile({ ...currentProfile, name: newName });
    }
    return {};
  };

  const handleCycleUserStatus = async () => {
    const idx = AVAILABILITY_ORDER.indexOf(userStatus);
    const nextStatus = AVAILABILITY_ORDER[(idx + 1) % AVAILABILITY_ORDER.length];
    setUserStatus(nextStatus);

    if (!currentProfile) return;

    const updatedProfile = { ...currentProfile, status: nextStatus };
    setCurrentProfile(updatedProfile);
    setProfilesMap((prev) => ({ ...prev, [currentProfile.id]: updatedProfile }));

    if (!isSupabaseConfigured) {
      saveActiveLocalSession(updatedProfile);
      setOnlineUsers((prev) =>
        prev.map((u) =>
          u.user_id === currentProfile.id ? { ...u, status: nextStatus } : u
        )
      );
      return;
    }

    await supabase
      .from('profiles')
      .update({ status: nextStatus })
      .eq('id', currentProfile.id);
  };

  const handleCreateTeam = async (name: string, description: string) => {
    if (!currentProfile) return;
    if (isSupabaseConfigured && hasSupabaseTeamsTable) {
      const { data, error } = await supabase
        .from('teams')
        .insert({ name, description: description || null })
        .select('id, name, description')
        .single();

      if (!error && data) {
        const createdTeam = data as TeamRecord;
        await supabase
          .from('team_members')
          .upsert({ team_id: createdTeam.id, user_id: currentProfile.id });

        setTeams((prev) => [
          ...prev,
          {
            id: String(createdTeam.id),
            name: createdTeam.name,
            description: createdTeam.description || '',
            channelIds: [],
            memberIds: [currentProfile.id],
          },
        ]);
      }
      return;
    }

    setTeams((prev) => [
      ...prev,
      {
        id: `team-${Date.now()}`,
        name,
        description,
        channelIds: activeChannelId ? [activeChannelId] : [],
        memberIds: [currentProfile.id],
      },
    ]);
  };

  const handleUpdateTeam = async (updated: WorkspaceTeam) => {
    const prevTeam = teams.find((t) => t.id === updated.id);
    setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

    if (!isSupabaseConfigured || !hasSupabaseTeamsTable || !prevTeam) return;
    const numericTeamId = Number(updated.id);
    if (Number.isNaN(numericTeamId)) return;

    const addedChannels = updated.channelIds.filter((id) => !prevTeam.channelIds.includes(id));
    const removedChannels = prevTeam.channelIds.filter((id) => !updated.channelIds.includes(id));
    const addedMembers = updated.memberIds.filter((id) => !prevTeam.memberIds.includes(id));
    const removedMembers = prevTeam.memberIds.filter((id) => !updated.memberIds.includes(id));

    if (addedChannels.length > 0) {
      await supabase
        .from('channels')
        .update({ team_id: numericTeamId })
        .in('id', addedChannels);
    }
    if (removedChannels.length > 0) {
      await supabase
        .from('channels')
        .update({ team_id: null })
        .in('id', removedChannels)
        .eq('team_id', numericTeamId);
    }
    if (addedMembers.length > 0) {
      await supabase
        .from('team_members')
        .upsert(addedMembers.map((uid) => ({ team_id: numericTeamId, user_id: uid })));
    }
    if (removedMembers.length > 0) {
      await supabase
        .from('team_members')
        .delete()
        .eq('team_id', numericTeamId)
        .in('user_id', removedMembers);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    if (isSupabaseConfigured && hasSupabaseTeamsTable) {
      const numericId = Number(teamId);
      if (!Number.isNaN(numericId)) {
        await supabase.from('teams').delete().eq('id', numericId);
      }
    }
  };

  const handleSetMemberRole = async (userId: string, role: MemberRole) => {
    if (userId === 'root-admin' || userId === currentProfile?.id) return;
    setMemberRoles((prev) => ({ ...prev, [userId]: role }));
    setProfilesMap((prev) =>
      prev[userId] ? { ...prev, [userId]: { ...prev[userId], role } } : prev
    );
    if (!isSupabaseConfigured) {
      updateLocalAccountRole(userId, role);
      return;
    }
    await supabase.from('profiles').update({ role }).eq('id', userId);
  };

  const handleSignOut = async () => {
    if (!isSupabaseConfigured) {
      saveActiveLocalSession(null);
      setCurrentProfile(null);
      setChannels([]);
      setChannelMembersMap({});
      setActiveChannelId(null);
      setOnlineUsers([]);
      return;
    }
    await supabase.auth.signOut();
  };

  const hasExplicitAdmin = useMemo(
    () => Object.values(memberRoles).some((r) => r === 'admin'),
    [memberRoles]
  );

  const isCurrentUserAdmin = useMemo(() => {
    if (!currentProfile) return false;
    const role =
      currentProfile.role ||
      memberRoles[currentProfile.id] ||
      (!isSupabaseConfigured || !hasExplicitAdmin ? 'admin' : 'member');
    return role === 'admin';
  }, [currentProfile, memberRoles, hasExplicitAdmin]);

  const visibleChannels = useMemo(() => {
    if (!currentProfile) return channels;
    return channels.filter((ch) => {
      if (isDirectMessageChannel(ch.name)) {
        const parts = ch.name.slice(3).split(':');
        return parts.includes(currentProfile.id);
      }
      if (!ch.is_private) return true;
      if (isCurrentUserAdmin) return true;
      const members = channelMembersMap[ch.id];
      if (!members || members.length === 0) return true;
      return members.includes(currentProfile.id);
    });
  }, [channels, currentProfile, isCurrentUserAdmin, channelMembersMap]);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
    if (activeChannelId !== null) {
      setMentionBadges((prev) => {
        if (!prev[activeChannelId]) return prev;
        const next = { ...prev };
        delete next[activeChannelId];
        return next;
      });
    }
  }, [activeChannelId]);

  useEffect(() => {
    visibleChannelsRef.current = visibleChannels;
    if (!handledUrlCanalRef.current && visibleChannels.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const canalParam = params.get('canal');
      if (canalParam) {
        const targetId = Number(canalParam);
        if (!Number.isNaN(targetId) && visibleChannels.some((c) => c.id === targetId)) {
          setActiveChannelId(targetId);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
      handledUrlCanalRef.current = true;
    }
  }, [visibleChannels]);

  useEffect(() => {
    profilesMapRef.current = profilesMap;
  }, [profilesMap]);

  useEffect(() => {
    pushPrefsRef.current = pushPrefs;
  }, [pushPrefs]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);

  useEffect(() => {
    void getPushStatusSnapshot().then(setPushStatus);
    if (
      currentProfile &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      pushPrefs.enabled &&
      isSupabaseConfigured
    ) {
      void enableBrowserPushForUser(currentProfile.id).then(() => {
        void getPushStatusSnapshot().then(setPushStatus);
      });
    }
  }, [currentProfile?.id]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; channelId?: number | string | null }
        | undefined;
      if (!data?.type) return;
      if (data.type === 'MAR_OPEN_CHANNEL' && data.channelId) {
        const targetId = Number(data.channelId);
        if (!Number.isNaN(targetId)) {
          setActiveChannelId(targetId);
        }
      } else if (
        data.type === 'MAR_PUSH_SUBSCRIPTION_CHANGED' &&
        currentProfileRef.current
      ) {
        void enableBrowserPushForUser(currentProfileRef.current.id).then(() => {
          void getPushStatusSnapshot().then(setPushStatus);
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  const handleEnablePush = async () => {
    if (!currentProfile) return;
    setPushFeedback(null);
    const res = await enableBrowserPushForUser(currentProfile.id);
    if (!res.ok) {
      setPushFeedback(res.error || 'No se pudieron activar las alertas.');
    } else {
      const nextPrefs = { ...pushPrefs, enabled: true };
      setPushPrefs(nextPrefs);
      savePushPreferences(nextPrefs);
      setPushFeedback('Alertas de mención activadas vía Service Worker.');
    }
    const snap = await getPushStatusSnapshot();
    setPushStatus(snap);
  };

  const handleDisablePush = async () => {
    if (!currentProfile) return;
    setPushFeedback(null);
    await disableBrowserPushForUser(currentProfile.id);
    const nextPrefs = { ...pushPrefs, enabled: false };
    setPushPrefs(nextPrefs);
    savePushPreferences(nextPrefs);
    const snap = await getPushStatusSnapshot();
    setPushStatus(snap);
  };

  const handleToggleMentionsOnly = (mentionsOnly: boolean) => {
    const nextPrefs = { ...pushPrefs, mentionsOnly };
    setPushPrefs(nextPrefs);
    savePushPreferences(nextPrefs);
  };

  const handleSendTestMentionPush = async () => {
    if (!currentProfile) return;
    setPushFeedback(null);
    const active = visibleChannels.find((c) => c.id === activeChannelId) || visibleChannels[0];
    const roomName = active
      ? isDirectMessageChannel(active.name)
        ? 'Mensaje directo'
        : `#${active.name}`
      : '#general';

    const ok = await showMentionNotification({
      title: `Prueba MAR · Mención en ${roomName}`,
      body: `@${currentProfile.name}, así verás las alertas cuando alguien te mencione en el equipo.`,
      channelId: active?.id ?? null,
      channelName: active?.name ?? 'general',
      tag: `mar-test-${Date.now()}`,
      onFallbackClick: () => {
        if (active?.id) setActiveChannelId(active.id);
      },
    });
    setPushFeedback(
      ok
        ? 'Alerta enviada a través del Service Worker.'
        : 'Activa el permiso del navegador para ver la alerta.'
    );
  };

  if (!authReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F3FF] dark:bg-[#1E1B4B] text-[#5B21B6] dark:text-[#DDD6FE]">
        <Loader2 className="w-6 h-6 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  const isAuthenticated = isSupabaseConfigured ? !!session : !!currentProfile;

  if (!isAuthenticated) {
    return (
      <>
        <AuthScreen
          onPreviewLogin={handlePreviewLogin}
          onAuthenticated={(name) => {
            void supabase.auth.getSession().then(({ data }) => {
              if (data.session) {
                setSession(data.session);
                void loadCurrentUserProfile(data.session, name);
              }
            });
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  if (needsName || !currentProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F3FF] dark:bg-[#1E1B4B] p-4 text-[#1E1B4B] dark:text-[#F5F3FF]">
        {needsName ? (
          <form
            onSubmit={handleSaveMissingName}
            className="w-full max-w-sm rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238] p-6 shadow-sm space-y-4"
          >
            <h1 className="text-lg font-bold font-display">¿Cómo te llamas?</h1>
            <p className="text-xs text-[#1E1B4B]/70 dark:text-[#DDD6FE]/80">
              Este nombre aparecerá junto a tus mensajes y en la lista de personas en línea.
            </p>
            <input
              type="text"
              required
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="Ej. Sofía Torres"
              className="w-full rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#1E1B4B] px-3.5 py-2.5 text-base sm:text-sm focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
            />
            {nameError && <p className="text-xs text-red-600 dark:text-red-300">{nameError}</p>}
            <button
              type="submit"
              disabled={savingName}
              className="w-full rounded-lg bg-[#5B21B6] hover:bg-[#4C1D95] disabled:opacity-60 py-2.5 text-sm font-semibold text-white min-h-[44px]"
            >
              {savingName ? 'Guardando...' : 'Continuar al chat'}
            </button>
          </form>
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-[#8B5CF6]" />
        )}
        <OfflineIndicator />
      </div>
    );
  }

  const activeChannel = visibleChannels.find((c) => c.id === activeChannelId) || null;

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-white dark:bg-[#151238]">
      <MobileInstallBanner />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          channels={visibleChannels}
          activeChannelId={activeChannelId}
          onSelectChannel={(id) => setActiveChannelId(id)}
          onCreateChannel={handleCreateChannel}
          onlineUsers={onlineUsers}
          profilesMap={profilesMap}
          currentUser={currentProfile}
          userStatus={userStatus}
          onCycleUserStatus={handleCycleUserStatus}
          onOpenAdmin={isCurrentUserAdmin ? () => setAdminOpen(true) : undefined}
          onMentionUser={(name) =>
            setPendingMention((prev) => ({ name, seq: (prev?.seq ?? 0) + 1 }))
          }
          onStartDirectMessage={handleStartDirectMessage}
          mentionBadges={mentionBadges}
          onSignOut={handleSignOut}
          themeMode={themeMode}
          onCycleTheme={cycleTheme}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <ChatArea
          channel={activeChannel}
          channels={visibleChannels}
          currentUser={currentProfile}
          profilesMap={profilesMap}
          onlineUsers={onlineUsers}
          onlineCount={onlineUsers.length}
          pendingMention={pendingMention}
          isAdmin={isCurrentUserAdmin}
          onSelectChannel={(id) => setActiveChannelId(id)}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onProfileNeeded={handleProfileNeeded}
          previewMessages={previewMessages}
          onSendPreviewMessage={(msg) => setPreviewMessages((prev) => [...prev, msg])}
          onDeletePreviewMessage={(msgId) =>
            setPreviewMessages((prev) =>
              prev.filter((m) => m.id !== msgId && parseThreadMessage(m).parentId !== msgId)
            )
          }
          pushStatus={pushStatus}
          pushPrefs={pushPrefs}
          pushFeedback={pushFeedback}
          onEnablePush={handleEnablePush}
          onDisablePush={handleDisablePush}
          onToggleMentionsOnly={handleToggleMentionsOnly}
          onSendTestMentionPush={handleSendTestMentionPush}
        />
      </div>

      <AdminModal
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        channels={visibleChannels}
        profilesMap={profilesMap}
        onlineUsers={onlineUsers}
        currentUser={currentProfile}
        teams={teams}
        memberRoles={memberRoles}
        onCreateTeam={handleCreateTeam}
        onUpdateTeam={handleUpdateTeam}
        onDeleteTeam={handleDeleteTeam}
        onCreateChannel={handleCreateChannel}
        onRenameChannel={handleRenameChannel}
        onDeleteChannel={handleDeleteChannel}
        onAddUser={handleAddUser}
        onSetMemberRole={handleSetMemberRole}
        onUpdateMemberName={handleUpdateMemberName}
        onDeleteUser={handleDeleteUser}
      />

      <OfflineIndicator />
    </div>
  );
}
