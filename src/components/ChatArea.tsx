import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AtSign,
  Bell,
  BellOff,
  Bold,
  Check,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  Italic,
  Loader2,
  Lock,
  Menu,
  MessageSquareText,
  Paperclip,
  Pin,
  Reply,
  Search,
  Send,
  Smile,
  SmilePlus,
  Trash2,
  Users,
  X,
  RotateCw,
} from 'lucide-react';
import {
  Channel,
  MAX_FILE_SIZE_BYTES,
  Message,
  MessageReaction,
  OnlineUser,
  PinnedMessageRecord,
  Profile,
  encodeThreadMarker,
  getAvatarColor,
  getDmOtherUserId,
  getInitials,
  isDirectMessageChannel,
  isImageFile,
  isSupabaseConfigured,
  parseThreadMessage,
  supabase,
} from '../supabaseClient';
import { previewFileUrls } from '../previewStore';
import {
  PushPreferences,
  PushStatusSnapshot,
  dispatchRemoteMentionPush,
} from '../utils/pushNotifications';
import { PWAInstallButton } from './PWAInstallButton';
import { NormalizedMessage, ThreadPanel } from './ThreadPanel';

interface ChatAreaProps {
  channel: Channel | null;
  channels?: Channel[];
  currentUser: Profile;
  profilesMap: Record<string, Profile>;
  onlineUsers?: OnlineUser[];
  onlineCount: number;
  pendingMention?: { name: string; seq: number } | null;
  isAdmin?: boolean;
  onSelectChannel?: (channelId: number) => void;
  onOpenSidebar: () => void;
  onProfileNeeded: (userId: string) => void;
  previewMessages?: Message[];
  onSendPreviewMessage?: (msg: Message) => void;
  onDeletePreviewMessage?: (msgId: number) => void;
  pushStatus?: PushStatusSnapshot;
  pushPrefs?: PushPreferences;
  pushFeedback?: string | null;
  onEnablePush?: () => Promise<void>;
  onDisablePush?: () => Promise<void>;
  onToggleMentionsOnly?: (mentionsOnly: boolean) => void;
  onSendTestMentionPush?: () => Promise<void>;
}

interface ReplyContext {
  id: number;
  senderName: string;
  excerpt: string;
}

type ReactionMap = Record<number, Record<string, string[]>>;

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Frecuentes',
    emojis: ['👍', '👏', '🎉', '🚀', '✅', '❤️', '🔥', '👀'],
  },
  {
    label: 'Trabajo',
    emojis: ['💡', '📌', '📎', '📅', '📝', '📊', '⚡', '🎯'],
  },
  {
    label: 'Expresiones',
    emojis: ['😄', '🙌', '🤝', '🙏', '🥳', '🤔', '😅', '💪'],
  },
];

const QUICK_REACTIONS = ['👍', '✅', '🎉', '❤️'];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  channel,
  channels = [],
  currentUser,
  profilesMap,
  onlineUsers = [],
  onlineCount,
  pendingMention,
  isAdmin = false,
  onSelectChannel,
  onOpenSidebar,
  onProfileNeeded,
  previewMessages = [],
  onSendPreviewMessage,
  onDeletePreviewMessage,
  pushStatus,
  pushPrefs = { enabled: true, mentionsOnly: true },
  pushFeedback,
  onEnablePush,
  onDisablePush,
  onToggleMentionsOnly,
  onSendTestMentionPush,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [body, setBody] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Mattermost / Slack chat tools state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactionPickerForMsg, setReactionPickerForMsg] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  // Header tools: search, threads list, pinned messages, online members popover
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showThreadsPanel, setShowThreadsPanel] = useState(false);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showOnlinePanel, setShowOnlinePanel] = useState(false);
  const [showPushPanel, setShowPushPanel] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [activeActionMsgId, setActiveActionMsgId] = useState<number | null>(null);

  // @Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);

  // Reactions & pinned messages persisted locally per channel
  const [reactionsByChannel, setReactionsByChannel] = useState<Record<number, ReactionMap>>(() => {
    try {
      const saved = localStorage.getItem('mar_reactions_v2');
      if (saved) return JSON.parse(saved) as Record<number, ReactionMap>;
    } catch {
      // ignore storage errors
    }
    return {};
  });

  const [pinsByChannel, setPinsByChannel] = useState<Record<number, number[]>>(() => {
    try {
      const saved = localStorage.getItem('mar_pins_v2');
      if (saved) return JSON.parse(saved) as Record<number, number[]>;
    } catch {
      // ignore storage errors
    }
    return {};
  });

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [openingFilePath, setOpeningFilePath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supportsParentIdRef = useRef<boolean | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mar_reactions_v2', JSON.stringify(reactionsByChannel));
    } catch {
      // ignore
    }
  }, [reactionsByChannel]);

  useEffect(() => {
    try {
      localStorage.setItem('mar_pins_v2', JSON.stringify(pinsByChannel));
    } catch {
      // ignore
    }
  }, [pinsByChannel]);

  const isDm = channel ? isDirectMessageChannel(channel.name) : false;
  const dmPartnerId = channel && isDm ? getDmOtherUserId(channel.name, currentUser.id) : null;
  const dmPartnerName = dmPartnerId ? profilesMap[dmPartnerId]?.name || 'Compañero' : '';
  const channelDisplayName = channel
    ? isDm
      ? dmPartnerName
      : channel.name
    : '';

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  const allChannelMessages = useMemo(
    () =>
      isSupabaseConfigured
        ? messages
        : previewMessages.filter((m) => m.channel_id === channel?.id),
    [channel?.id, messages, previewMessages]
  );

  const allNormalizedMessages = useMemo<NormalizedMessage[]>(
    () =>
      allChannelMessages.map((m) => {
        const { parentId, cleanBody } = parseThreadMessage(m);
        return {
          ...m,
          parentId,
          cleanBody,
        };
      }),
    [allChannelMessages]
  );

  const messageById = useMemo(() => {
    const map: Record<number, NormalizedMessage> = {};
    allNormalizedMessages.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [allNormalizedMessages]);

  const repliesByParentId = useMemo(() => {
    const map: Record<number, NormalizedMessage[]> = {};
    allNormalizedMessages.forEach((m) => {
      if (m.parentId !== null) {
        if (!map[m.parentId]) map[m.parentId] = [];
        map[m.parentId].push(m);
      }
    });
    return map;
  }, [allNormalizedMessages]);

  const topLevelMessages = useMemo(
    () => allNormalizedMessages.filter((m) => m.parentId === null),
    [allNormalizedMessages]
  );

  const activeThreadsList = useMemo(() => {
    return topLevelMessages
      .map((root) => {
        const replies = repliesByParentId[root.id] || [];
        return replies.length > 0
          ? { root, replies, lastReply: replies[replies.length - 1] }
          : null;
      })
      .filter(
        (item): item is { root: NormalizedMessage; replies: NormalizedMessage[]; lastReply: NormalizedMessage } =>
          item !== null
      )
      .sort(
        (a, b) =>
          new Date(b.lastReply.created_at).getTime() - new Date(a.lastReply.created_at).getTime()
      );
  }, [repliesByParentId, topLevelMessages]);

  const activeThreadRoot = useMemo(
    () => (activeThreadId !== null ? messageById[activeThreadId] || null : null),
    [activeThreadId, messageById]
  );

  const activeThreadReplies = useMemo(
    () => (activeThreadRoot ? repliesByParentId[activeThreadRoot.id] || [] : []),
    [activeThreadRoot, repliesByParentId]
  );

  const displayedMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return topLevelMessages;

    return allNormalizedMessages.filter((m) => {
      const sender =
        m.user_id === currentUser.id
          ? currentUser.name
          : profilesMap[m.user_id]?.name || '';
      return (
        (m.cleanBody || '').toLowerCase().includes(q) ||
        (m.file_name || '').toLowerCase().includes(q) ||
        sender.toLowerCase().includes(q)
      );
    });
  }, [
    allNormalizedMessages,
    currentUser.id,
    currentUser.name,
    profilesMap,
    searchQuery,
    topLevelMessages,
  ]);

  const pinnedIds = channel ? pinsByChannel[channel.id] || [] : [];
  const pinnedMessages = useMemo(
    () => allNormalizedMessages.filter((m) => pinnedIds.includes(m.id)),
    [allNormalizedMessages, pinnedIds]
  );

  const mentionCandidates = useMemo(() => {
    const map = new Map<string, { id: string; name: string; online: boolean }>();
    const onlineSet = new Set(onlineUsers.map((u) => u.user_id));

    onlineUsers.forEach((u) => {
      map.set(u.user_id, { id: u.user_id, name: u.name, online: true });
    });

    Object.values(profilesMap).forEach((p) => {
      if (!map.has(p.id)) {
        map.set(p.id, { id: p.id, name: p.name, online: onlineSet.has(p.id) });
      }
    });

    if (!map.has(currentUser.id)) {
      map.set(currentUser.id, { id: currentUser.id, name: currentUser.name, online: true });
    }

    const list = Array.from(map.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name, 'es');
    });

    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    return list.filter((item) => item.name.toLowerCase().includes(q));
  }, [currentUser.id, currentUser.name, mentionQuery, onlineUsers, profilesMap]);

  // Reset UI popovers when switching channel
  useEffect(() => {
    setShowEmojiPicker(false);
    setReactionPickerForMsg(null);
    setMentionQuery(null);
    setMentionStartIndex(null);
    setReplyTo(null);
    setActiveThreadId(null);
    setShowThreadsPanel(false);
    setShowPinnedPanel(false);
    setShowOnlinePanel(false);
    setSearchQuery('');
    setSearchOpen(false);
  }, [channel?.id]);

  // Handle clicking a user in Sidebar to @mention them
  useEffect(() => {
    if (!pendingMention?.name) return;
    const tag = `@${pendingMention.name} `;
    setBody((prev) => {
      const separator = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return `${prev}${separator}${tag}`;
    });
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, [pendingMention?.seq]);

  useEffect(() => {
    if (!isSupabaseConfigured && channel && !searchQuery) {
      setTimeout(scrollToBottom, 30);
    }
  }, [channel?.id, previewMessages.length, searchQuery, scrollToBottom]);

  const getOrCreateSignedUrl = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (!isSupabaseConfigured) {
        return previewFileUrls[filePath] || null;
      }
      if (signedUrls[filePath]) return signedUrls[filePath];
      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUrl(filePath, 3600);
      if (error || !data?.signedUrl) {
        return null;
      }
      setSignedUrls((prev) => ({ ...prev, [filePath]: data.signedUrl }));
      return data.signedUrl;
    },
    [signedUrls]
  );

  // Fetch initial messages + subscribe to Realtime inserts for active channel
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    if (!channel) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setErrorMsg(null);

    const loadMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: true })
        .limit(300);

      if (cancelled) return;
      if (error) {
        setErrorMsg('No se pudieron cargar los mensajes del canal.');
        setLoadingMessages(false);
        return;
      }

      const rows = (data as Message[]) || [];
      setMessages(rows);
      setLoadingMessages(false);

      rows.forEach((m) => {
        if (m.user_id && !profilesMap[m.user_id]) {
          onProfileNeeded(m.user_id);
        }
      });

      // Sincronizar reacciones y fijados desde Supabase si existen las tablas
      if (rows.length > 0) {
        const msgIds = rows.map((r) => r.id);
        const [reactionsRes, pinsRes] = await Promise.all([
          supabase
            .from('message_reactions')
            .select('message_id, user_id, emoji')
            .in('message_id', msgIds),
          supabase
            .from('pinned_messages')
            .select('channel_id, message_id')
            .eq('channel_id', channel.id),
        ]);

        if (!cancelled && reactionsRes.data) {
          const map: ReactionMap = {};
          (reactionsRes.data as MessageReaction[]).forEach((r) => {
            if (!map[r.message_id]) map[r.message_id] = {};
            if (!map[r.message_id][r.emoji]) map[r.message_id][r.emoji] = [];
            if (!map[r.message_id][r.emoji].includes(r.user_id)) {
              map[r.message_id][r.emoji].push(r.user_id);
            }
          });
          setReactionsByChannel((prev) => ({ ...prev, [channel.id]: map }));
        }

        if (!cancelled && pinsRes.data) {
          const ids = (pinsRes.data as PinnedMessageRecord[]).map((p) => p.message_id);
          setPinsByChannel((prev) => ({ ...prev, [channel.id]: ids }));
        }
      }

      setTimeout(scrollToBottom, 40);
    };

    loadMessages();

    const realtimeChannel = supabase
      .channel(`messages-room-${channel.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          if (!incoming || incoming.channel_id !== channel.id) return;
          if (incoming.user_id && !profilesMap[incoming.user_id]) {
            onProfileNeeded(incoming.user_id);
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          if (parseThreadMessage(incoming).parentId === null) {
            setTimeout(scrollToBottom, 30);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const oldMsg = payload.old as { id?: number };
          if (!oldMsg?.id) return;
          setMessages((prev) =>
            prev.filter((m) => m.id !== oldMsg.id && parseThreadMessage(m).parentId !== oldMsg.id)
          );
          setActiveThreadId((cur) => (cur === oldMsg.id ? null : cur));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          if (!row?.message_id) return;
          setReactionsByChannel((prev) => {
            const chMap = { ...(prev[channel.id] || {}) };
            const msgMap = { ...(chMap[row.message_id] || {}) };
            const users = [...(msgMap[row.emoji] || [])];
            if (!users.includes(row.user_id)) users.push(row.user_id);
            msgMap[row.emoji] = users;
            chMap[row.message_id] = msgMap;
            return { ...prev, [channel.id]: chMap };
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          const row = payload.old as Partial<MessageReaction>;
          if (!row?.message_id || !row?.emoji || !row?.user_id) return;
          setReactionsByChannel((prev) => {
            const chMap = { ...(prev[channel.id] || {}) };
            const msgMap = { ...(chMap[row.message_id!] || {}) };
            const users = (msgMap[row.emoji!] || []).filter((u) => u !== row.user_id);
            if (users.length === 0) delete msgMap[row.emoji!];
            else msgMap[row.emoji!] = users;
            chMap[row.message_id!] = msgMap;
            return { ...prev, [channel.id]: chMap };
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pinned_messages',
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as PinnedMessageRecord;
            if (!row?.message_id) return;
            setPinsByChannel((prev) => {
              const cur = prev[channel.id] || [];
              if (cur.includes(row.message_id)) return prev;
              return { ...prev, [channel.id]: [...cur, row.message_id] };
            });
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as Partial<PinnedMessageRecord>;
            if (!row?.message_id) return;
            setPinsByChannel((prev) => ({
              ...prev,
              [channel.id]: (prev[channel.id] || []).filter((id) => id !== row.message_id),
            }));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(realtimeChannel);
    };
  }, [channel?.id]);

  // Pre-fetch signed URLs for image attachments (including thread replies)
  useEffect(() => {
    allNormalizedMessages.forEach((m) => {
      if (m.file_path && isImageFile(m.file_name) && !signedUrls[m.file_path]) {
        void getOrCreateSignedUrl(m.file_path).then((url) => {
          if (url && !isSupabaseConfigured) {
            setSignedUrls((prev) => ({ ...prev, [m.file_path!]: url }));
          }
        });
      }
    });
  }, [allNormalizedMessages, signedUrls, getOrCreateSignedUrl]);

  const validateAndAttachFile = (file: File | null) => {
    setErrorMsg(null);
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg(
        `El archivo "${file.name}" supera el límite de 20 MB (${formatFileSize(file.size)}).`
      );
      return;
    }
    setSelectedFile(file);
  };

  const handleOpenSignedFile = async (filePath: string) => {
    setErrorMsg(null);
    setOpeningFilePath(filePath);
    try {
      let targetUrl: string | null = null;
      if (!isSupabaseConfigured) {
        targetUrl = previewFileUrls[filePath] || null;
      } else {
        const { data, error } = await supabase.storage
          .from('files')
          .createSignedUrl(filePath, 3600);
        if (error || !data?.signedUrl) {
          setErrorMsg('No se pudo generar el enlace firmado para este archivo.');
          return;
        }
        targetUrl = data.signedUrl;
        setSignedUrls((prev) => ({ ...prev, [filePath]: targetUrl! }));
      }
      if (!targetUrl) {
        setErrorMsg('El archivo ya no está disponible en la sesión actual.');
        return;
      }
      const link = document.createElement('a');
      link.href = targetUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setOpeningFilePath(null);
    }
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => prev + snippet);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    setTimeout(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const wrapSelection = (prefix: string, suffix: string, fallbackText: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => `${prev}${prefix}${fallbackText}${suffix}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const inner = selected || fallbackText;
    const next = body.slice(0, start) + prefix + inner + suffix + body.slice(end);
    setBody(next);
    setTimeout(() => {
      el.focus();
      const selectStart = start + prefix.length;
      const selectEnd = selectStart + inner.length;
      el.setSelectionRange(selectStart, selectEnd);
    }, 0);
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    setBody(nextVal);

    const cursor = e.target.selectionStart ?? nextVal.length;
    const beforeCursor = nextVal.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
    if (match) {
      const atPos = beforeCursor.lastIndexOf('@');
      setMentionStartIndex(atPos);
      setMentionQuery(match[2]);
      setMentionActiveIdx(0);
    } else {
      setMentionQuery(null);
      setMentionStartIndex(null);
    }
  };

  const selectMention = (name: string) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? body.length;
    const start = mentionStartIndex ?? body.lastIndexOf('@', cursor);
    if (start >= 0) {
      const next = body.slice(0, start) + `@${name} ` + body.slice(cursor);
      setBody(next);
      setTimeout(() => {
        if (el) {
          el.focus();
          const nextPos = start + name.length + 2;
          el.setSelectionRange(nextPos, nextPos);
        }
      }, 0);
    } else {
      insertAtCursor(`@${name} `);
    }
    setMentionQuery(null);
    setMentionStartIndex(null);
  };

  const handleToggleReaction = async (msgId: number, emoji: string) => {
    if (!channel) return;
    const currentUsers = reactionsByChannel[channel.id]?.[msgId]?.[emoji] || [];
    const alreadyReacted = currentUsers.includes(currentUser.id);

    setReactionsByChannel((prev) => {
      const chReactions = { ...(prev[channel.id] || {}) };
      const msgReactions = { ...(chReactions[msgId] || {}) };
      const users = [...(msgReactions[emoji] || [])];
      const existingIdx = users.indexOf(currentUser.id);
      if (existingIdx >= 0) {
        users.splice(existingIdx, 1);
      } else {
        users.push(currentUser.id);
      }
      if (users.length === 0) {
        delete msgReactions[emoji];
      } else {
        msgReactions[emoji] = users;
      }
      chReactions[msgId] = msgReactions;
      return { ...prev, [channel.id]: chReactions };
    });
    setReactionPickerForMsg(null);

    if (isSupabaseConfigured) {
      if (alreadyReacted) {
        await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', msgId)
          .eq('user_id', currentUser.id)
          .eq('emoji', emoji);
      } else {
        await supabase.from('message_reactions').insert({
          message_id: msgId,
          user_id: currentUser.id,
          emoji,
        });
      }
    }
  };

  const handleTogglePin = async (msgId: number) => {
    if (!channel) return;
    const alreadyPinned = (pinsByChannel[channel.id] || []).includes(msgId);

    setPinsByChannel((prev) => {
      const current = prev[channel.id] || [];
      const exists = current.includes(msgId);
      const next = exists ? current.filter((id) => id !== msgId) : [...current, msgId];
      return { ...prev, [channel.id]: next };
    });

    if (isSupabaseConfigured) {
      if (alreadyPinned) {
        await supabase
          .from('pinned_messages')
          .delete()
          .eq('channel_id', channel.id)
          .eq('message_id', msgId);
      } else {
        await supabase.from('pinned_messages').insert({
          channel_id: channel.id,
          message_id: msgId,
          pinned_by: currentUser.id,
        });
      }
    }
  };

  const handleCopyMessage = async (msg: NormalizedMessage) => {
    const textToCopy = msg.cleanBody || msg.file_name || '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedMsgId(msg.id);
      setTimeout(() => {
        setCopiedMsgId((cur) => (cur === msg.id ? null : cur));
      }, 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!isSupabaseConfigured) {
      onDeletePreviewMessage?.(msgId);
      setActiveThreadId((cur) => (cur === msgId ? null : cur));
      return;
    }
    const childIds = allNormalizedMessages
      .filter((m) => m.parentId === msgId)
      .map((m) => m.id);
    if (childIds.length > 0 && supportsParentIdRef.current === false) {
      await supabase.from('messages').delete().in('id', childIds);
    }
    const { error } = await supabase.from('messages').delete().eq('id', msgId);
    if (error) {
      setErrorMsg('No se pudo eliminar el mensaje.');
      return;
    }
    setMessages((prev) =>
      prev.filter((m) => m.id !== msgId && parseThreadMessage(m).parentId !== msgId)
    );
    setActiveThreadId((cur) => (cur === msgId ? null : cur));
  };

  const pushActive =
    pushStatus?.permission === 'granted' && Boolean(pushPrefs?.enabled);

  const sendMessageCore = async ({
    bodyText,
    file,
    parentId = null,
    alsoSendToChannel = false,
  }: {
    bodyText: string;
    file: File | null;
    parentId?: number | null;
    alsoSendToChannel?: boolean;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!channel) return { ok: false, error: 'Selecciona un canal primero.' };
    const cleanText = bodyText.trim();
    if (!cleanText && !file) return { ok: false };

    if (!isSupabaseConfigured) {
      let localPath: string | null = null;
      let localName: string | null = null;
      if (file) {
        localPath = `preview/${channel.id}/${Date.now()}_${file.name}`;
        localName = file.name;
        previewFileUrls[localPath] = URL.createObjectURL(file);
      }
      const newMsg: Message = {
        id: Date.now() + Math.floor(Math.random() * 100),
        channel_id: channel.id,
        user_id: currentUser.id,
        body: cleanText || null,
        file_path: localPath,
        file_name: localName,
        created_at: new Date().toISOString(),
        parent_id: parentId,
      };
      onSendPreviewMessage?.(newMsg);

      if (parentId !== null && alsoSendToChannel) {
        const root = messageById[parentId];
        const rootAuthor = root
          ? root.user_id === currentUser.id
            ? currentUser.name
            : profilesMap[root.user_id]?.name || 'Compañero'
          : 'Compañero';
        const rootExcerpt = (root?.cleanBody || root?.file_name || '').slice(0, 70);
        onSendPreviewMessage?.({
          id: Date.now() + Math.floor(Math.random() * 100) + 101,
          channel_id: channel.id,
          user_id: currentUser.id,
          body: `> Hilo de ${rootAuthor}${rootExcerpt ? `: ${rootExcerpt}` : ''}\n${cleanText || localName || ''}`,
          file_path: null,
          file_name: null,
          created_at: new Date(Date.now() + 20).toISOString(),
          parent_id: null,
        });
      }

      if (parentId === null) {
        setTimeout(scrollToBottom, 30);
      }
      return { ok: true };
    }

    try {
      let uploadedPath: string | null = null;
      let uploadedName: string | null = null;

      if (file) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error('El archivo supera el máximo permitido de 20 MB.');
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${channel.id}/${currentUser.id}/${Date.now()}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from('files')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadErr) {
          throw new Error(`Error al subir archivo: ${uploadErr.message}`);
        }
        uploadedPath = storagePath;
        uploadedName = file.name;
      }

      let insertedData: Message | null = null;

      if (parentId !== null && supportsParentIdRef.current !== false) {
        const attempt = await supabase
          .from('messages')
          .insert({
            channel_id: channel.id,
            user_id: currentUser.id,
            body: cleanText || null,
            file_path: uploadedPath,
            file_name: uploadedName,
            parent_id: parentId,
          })
          .select('*')
          .single();

        if (!attempt.error && attempt.data) {
          supportsParentIdRef.current = true;
          insertedData = attempt.data as Message;
        } else if (
          attempt.error &&
          /parent_id|column|schema cache/i.test(attempt.error.message)
        ) {
          supportsParentIdRef.current = false;
        } else if (attempt.error) {
          throw new Error(`No se pudo enviar el mensaje: ${attempt.error.message}`);
        }
      }

      if (!insertedData) {
        const bodyPayload =
          parentId !== null ? encodeThreadMarker(parentId, cleanText) : cleanText || null;

        const { data: inserted, error: insertErr } = await supabase
          .from('messages')
          .insert({
            channel_id: channel.id,
            user_id: currentUser.id,
            body: bodyPayload,
            file_path: uploadedPath,
            file_name: uploadedName,
          })
          .select('*')
          .single();

        if (insertErr) {
          throw new Error(`No se pudo enviar el mensaje: ${insertErr.message}`);
        }
        insertedData = inserted as Message;
      }

      if (insertedData) {
        const msg = insertedData;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (parentId === null) {
          setTimeout(scrollToBottom, 30);
        }
        if (cleanText && cleanText.includes('@')) {
          void dispatchRemoteMentionPush({
            channelId: channel.id,
            channelName: channel.name,
            senderId: currentUser.id,
            senderName: currentUser.name,
            messageBody: cleanText,
            messageId: msg.id,
          });
        }
      }

      if (parentId !== null && alsoSendToChannel) {
        const root = messageById[parentId];
        const rootAuthor = root
          ? root.user_id === currentUser.id
            ? currentUser.name
            : profilesMap[root.user_id]?.name || 'Compañero'
          : 'Compañero';
        const rootExcerpt = (root?.cleanBody || root?.file_name || '').slice(0, 70);
        const broadcastBody = `> Hilo de ${rootAuthor}${rootExcerpt ? `: ${rootExcerpt}` : ''}\n${cleanText || uploadedName || ''}`;
        const { data: broadcastInserted } = await supabase
          .from('messages')
          .insert({
            channel_id: channel.id,
            user_id: currentUser.id,
            body: broadcastBody,
            file_path: null,
            file_name: null,
          })
          .select('*')
          .single();
        if (broadcastInserted) {
          const bMsg = broadcastInserted as Message;
          setMessages((prev) => (prev.some((m) => m.id === bMsg.id) ? prev : [...prev, bMsg]));
          setTimeout(scrollToBottom, 30);
        }
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al enviar el mensaje.',
      };
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!channel || sending) return;

    const rawTrimmed = body.trim();
    if (!rawTrimmed && !selectedFile) return;

    const finalBody = replyTo
      ? `> ${replyTo.senderName}: ${replyTo.excerpt}\n${rawTrimmed}`
      : rawTrimmed;

    setSending(true);
    setErrorMsg(null);
    const res = await sendMessageCore({
      bodyText: finalBody,
      file: selectedFile,
      parentId: null,
    });
    setSending(false);

    if (!res.ok) {
      if (res.error) setErrorMsg(res.error);
      return;
    }

    setBody('');
    setSelectedFile(null);
    setReplyTo(null);
    setShowEmojiPicker(false);
    setMentionQuery(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendThreadReply = async ({
    parentId,
    body: replyBody,
    file,
    alsoSendToChannel,
  }: {
    parentId: number;
    body: string;
    file: File | null;
    alsoSendToChannel: boolean;
  }) => {
    return sendMessageCore({
      bodyText: replyBody,
      file,
      parentId,
      alsoSendToChannel,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIdx((prev) => (prev + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIdx((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = mentionCandidates[mentionActiveIdx] || mentionCandidates[0];
        if (picked) selectMention(picked.name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          validateAndAttachFile(file);
          break;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0] || null;
    validateAndAttachFile(dropped);
  };

  const renderInlineTokens = (text: string): React.ReactNode[] => {
    const knownNames = Array.from(
      new Set([
        currentUser.name,
        ...onlineUsers.map((u) => u.name),
        ...Object.values(profilesMap).map((p) => p.name),
      ])
    )
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    const mentionPattern =
      knownNames.length > 0
        ? `@(?:${knownNames.join('|')}|[A-Za-zÁÉÍÓÚáéíóúÑñ0-9._-]+)`
        : '@[A-Za-zÁÉÍÓÚáéíóúÑñ0-9._-]+';

    const tokenRegex = new RegExp(
      `(\`[^\`]+\`|\\*\\*[^*]+\\*\\*|_[\\s\\S]+?_|${mentionPattern}|#[a-z0-9-_]+)`,
      'g'
    );

    const parts = text.split(tokenRegex);
    return parts.map((part, idx) => {
      if (!part) return null;

      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={idx}
            className="rounded bg-[#F5F3FF] dark:bg-[#292466] border border-[#DDD6FE] dark:border-[#5B21B6]/50 px-1.5 py-0.5 text-[12px] font-mono text-[#5B21B6] dark:text-[#DDD6FE]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={idx} className="font-semibold text-[#1E1B4B] dark:text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }

      if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
        return (
          <em key={idx} className="italic">
            {part.slice(1, -1)}
          </em>
        );
      }

      if (part.startsWith('@')) {
        const isSelf = part.slice(1).toLowerCase() === currentUser.name.toLowerCase();
        return (
          <span
            key={idx}
            className={`inline-block rounded px-1.5 py-0.5 font-semibold ${
              isSelf
                ? 'bg-[#FF8A1F]/20 text-[#9A3412] dark:bg-[#FF8A1F] dark:text-[#1E1B4B] ring-1 ring-[#FF8A1F]/40'
                : 'bg-[#DDD6FE]/70 dark:bg-[#5B21B6]/45 text-[#5B21B6] dark:text-[#DDD6FE]'
            }`}
          >
            {part}
          </span>
        );
      }

      if (part.startsWith('#')) {
        const slug = part.slice(1);
        const matchedChannel = channels.find((c) => c.name.toLowerCase() === slug.toLowerCase());
        if (matchedChannel && onSelectChannel) {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectChannel(matchedChannel.id)}
              className="inline-block rounded bg-[#F5F3FF] dark:bg-[#292466] px-1 py-0.5 font-semibold text-[#5B21B6] dark:text-[#DDD6FE] hover:underline"
            >
              {part}
            </button>
          );
        }
      }

      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const renderMessageBody = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-1 text-sm text-[#1E1B4B] dark:text-[#F5F3FF]/95 break-words leading-relaxed">
        {lines.map((line, i) => {
          if (line.startsWith('> ')) {
            return (
              <blockquote
                key={i}
                className="border-l-2 border-[#8B5CF6] bg-[#F5F3FF] dark:bg-[#292466]/70 rounded-r-lg px-3 py-1.5 text-xs text-[#1E1B4B]/80 dark:text-[#DDD6FE]"
              >
                {renderInlineTokens(line.slice(2))}
              </blockquote>
            );
          }
          return (
            <p key={i} className="whitespace-pre-wrap">
              {renderInlineTokens(line)}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <main
      className={`relative flex-1 flex min-w-0 h-full bg-white dark:bg-[#151238] text-[#1E1B4B] dark:text-[#F5F3FF] ${
        isDragging ? 'ring-2 ring-inset ring-[#8B5CF6]' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative flex-1 flex flex-col min-w-0 h-full">
      {/* Top channel header */}
      <header className="relative z-20 flex min-h-14 pt-[env(safe-area-inset-top)] items-center justify-between gap-2 sm:gap-3 px-3 sm:px-6 border-b border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="md:hidden -ml-2 p-2 rounded-lg text-[#1E1B4B] dark:text-[#F5F3FF] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Abrir canales y usuarios"
          >
            <Menu className="w-5 h-5" />
          </button>

          {channel ? (
            <div className="flex items-center gap-2 min-w-0">
              {isDm && dmPartnerId ? (
                <div
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${getAvatarColor(
                    dmPartnerId
                  )}`}
                >
                  {getInitials(channelDisplayName)}
                </div>
              ) : channel.is_private ? (
                <Lock className="w-4 h-4 text-[#8B5CF6] shrink-0" />
              ) : (
                <Hash className="w-5 h-5 text-[#8B5CF6] shrink-0" />
              )}
              <h1 className="font-display font-semibold text-base sm:text-lg truncate text-[#1E1B4B] dark:text-white">
                {channelDisplayName}
              </h1>
              {isDm && (
                <span className="hidden sm:inline text-xs text-[#5B21B6] dark:text-[#DDD6FE]/75">
                  Mensaje directo
                </span>
              )}
            </div>
          ) : (
            <h1 className="font-display font-semibold text-base text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70">
              Selecciona o crea un canal
            </h1>
          )}
        </div>

        {/* Herramientas de cabecera estilo Slack / Mattermost */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {channel && (
            <>
              {searchOpen ? (
                <div className="flex items-center gap-1 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-[#F5F3FF] dark:bg-[#151238] px-2.5 py-1.5">
                  <Search className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar en el canal..."
                    className="w-28 sm:w-44 bg-transparent text-xs text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/45 dark:placeholder:text-[#DDD6FE]/45 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchOpen(false);
                    }}
                    className="p-0.5 text-[#5B21B6] dark:text-[#DDD6FE] hover:text-[#1E1B4B] dark:hover:text-white"
                    aria-label="Cerrar búsqueda"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(true);
                    setShowThreadsPanel(false);
                    setShowPinnedPanel(false);
                    setShowOnlinePanel(false);
                    setShowPushPanel(false);
                  }}
                  className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] transition-colors min-h-[38px] min-w-[38px] flex items-center justify-center"
                  title="Buscar mensajes en este canal"
                  aria-label="Buscar mensajes"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowThreadsPanel((p) => !p);
                  setShowPinnedPanel(false);
                  setShowOnlinePanel(false);
                  setShowPushPanel(false);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[38px] ${
                  showThreadsPanel
                    ? 'bg-[#5B21B6] text-white'
                    : 'text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466]'
                }`}
                title="Hilos activos en este canal"
                aria-label="Hilos activos"
              >
                <MessageSquareText
                  className={`w-3.5 h-3.5 shrink-0 ${
                    !showThreadsPanel && activeThreadsList.length > 0 ? 'text-[#FF8A1F]' : ''
                  }`}
                />
                <span className="hidden sm:inline">Hilos</span>
                <span className="font-mono tabular-nums">{activeThreadsList.length}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPinnedPanel((p) => !p);
                  setShowThreadsPanel(false);
                  setShowOnlinePanel(false);
                  setShowPushPanel(false);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[38px] ${
                  showPinnedPanel
                    ? 'bg-[#5B21B6] text-white'
                    : 'text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466]'
                }`}
                title="Mensajes fijados"
                aria-label="Mensajes fijados"
              >
                <Pin
                  className={`w-3.5 h-3.5 shrink-0 ${
                    !showPinnedPanel && pinnedMessages.length > 0 ? 'text-[#FF8A1F]' : ''
                  }`}
                />
                <span className="font-mono tabular-nums">{pinnedMessages.length}</span>
              </button>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] transition-colors min-h-[38px] min-w-[38px] flex items-center justify-center"
                title="Actualizar / Recargar la ventana"
                aria-label="Actualizar ventana"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setShowPushPanel((p) => !p);
              setShowThreadsPanel(false);
              setShowPinnedPanel(false);
              setShowOnlinePanel(false);
            }}
            className={`relative p-2 rounded-lg transition-colors min-h-[38px] min-w-[38px] flex items-center justify-center ${
              showPushPanel
                ? 'bg-[#5B21B6] text-white'
                : pushActive
                ? 'text-[#5B21B6] dark:text-[#DDD6FE] bg-[#F5F3FF] dark:bg-[#292466]'
                : 'text-[#1E1B4B]/60 dark:text-[#DDD6FE]/65 hover:bg-[#F5F3FF] dark:hover:bg-[#292466]'
            }`}
            title="Notificaciones push de menciones (@)"
            aria-label="Notificaciones push de menciones"
          >
            {pushActive ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            {pushActive && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FF8A1F] ring-2 ring-white dark:ring-[#1E1B4B]"
                aria-hidden="true"
              />
            )}
          </button>

          <PWAInstallButton variant="compact" />

          <button
            type="button"
            onClick={() => {
              setShowOnlinePanel((p) => !p);
              setShowThreadsPanel(false);
              setShowPinnedPanel(false);
              setShowPushPanel(false);
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums min-h-[38px] ${
              showOnlinePanel
                ? 'bg-[#5B21B6] text-white'
                : 'text-[#1E1B4B] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466]'
            }`}
            title="Ver personas conectadas"
          >
            <Users className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
            <span className="w-2 h-2 rounded-full bg-[#10B981]" aria-hidden="true" />
            <span>{onlineCount} en línea</span>
          </button>
        </div>

        {/* Popover de hilos activos */}
        {showThreadsPanel && channel && (
          <div className="absolute right-4 sm:right-6 top-16 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1E1B4B] dark:text-white">
                <MessageSquareText className="w-3.5 h-3.5 text-[#FF8A1F]" />
                <span>Hilos activos en {isDm ? channelDisplayName : `#${channel.name}`}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowThreadsPanel(false)}
                className="p-1 text-[#5B21B6] dark:text-[#DDD6FE]"
                aria-label="Cerrar hilos"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {activeThreadsList.length === 0 ? (
              <p className="text-xs text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70">
                Aún no hay hilos abiertos en esta sala. Toca cualquier mensaje y elige{' '}
                <strong>Responder en hilo</strong>.
              </p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
                {activeThreadsList.map(({ root, replies, lastReply }) => {
                  const rootSender =
                    root.user_id === currentUser.id
                      ? currentUser.name
                      : profilesMap[root.user_id]?.name || 'Compañero';
                  return (
                    <li key={root.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(root.id);
                          setShowThreadsPanel(false);
                        }}
                        className="w-full text-left rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/70 dark:bg-[#151238] hover:border-[#8B5CF6] p-2.5 text-xs space-y-1 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#5B21B6] dark:text-[#DDD6FE] truncate">
                            {rootSender}
                          </span>
                          <span className="text-[11px] font-bold text-[#EA580C] dark:text-[#FF8A1F] shrink-0">
                            {replies.length} {replies.length === 1 ? 'resp.' : 'resps.'}
                          </span>
                        </div>
                        <p className="text-[#1E1B4B] dark:text-[#F5F3FF] line-clamp-2">
                          {root.cleanBody || root.file_name}
                        </p>
                        <p className="text-[10px] text-[#1E1B4B]/55 dark:text-[#DDD6FE]/60">
                          Última respuesta a las {formatTime(lastReply.created_at)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Popover de mensajes fijados */}
        {showPinnedPanel && channel && (
          <div className="absolute right-4 sm:right-6 top-16 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1E1B4B] dark:text-white">
                <Pin className="w-3.5 h-3.5 text-[#FF8A1F]" />
                <span>Mensajes fijados en #{channel.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPinnedPanel(false)}
                className="p-1 text-[#5B21B6] dark:text-[#DDD6FE]"
                aria-label="Cerrar fijados"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {pinnedMessages.length === 0 ? (
              <p className="text-xs text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70">
                Aún no hay mensajes fijados. Pasa el cursor sobre cualquier mensaje para fijarlo.
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                {pinnedMessages.map((pm) => {
                  const sender =
                    pm.user_id === currentUser.id
                      ? currentUser.name
                      : profilesMap[pm.user_id]?.name || 'Compañero';
                  return (
                    <li
                      key={pm.id}
                      className="rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/70 dark:bg-[#151238] p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                          {sender}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(pm.id)}
                          className="text-[11px] text-[#8B5CF6] hover:underline"
                        >
                          Desfijar
                        </button>
                      </div>
                      <p className="text-[#1E1B4B] dark:text-[#F5F3FF] line-clamp-3">
                        {pm.cleanBody || pm.file_name}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Popover de personas en línea */}
        {showOnlinePanel && (
          <div className="absolute right-4 sm:right-6 top-16 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1E1B4B] dark:text-white">
                Conectados ahora ({onlineUsers.length})
              </span>
              <button
                type="button"
                onClick={() => setShowOnlinePanel(false)}
                className="p-1 text-[#5B21B6] dark:text-[#DDD6FE]"
                aria-label="Cerrar lista"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ul className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-thin">
              {onlineUsers.map((person) => (
                <li key={person.user_id} className="flex items-center justify-between gap-2 py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                    <span className="text-xs font-medium text-[#1E1B4B] dark:text-[#F5F3FF] truncate">
                      {person.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      insertAtCursor(`@${person.name} `);
                      setShowOnlinePanel(false);
                    }}
                    className="text-[11px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE] hover:underline shrink-0"
                  >
                    @mencionar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Popover de notificaciones push por @mención */}
        {showPushPanel && (
          <div className="absolute right-4 sm:right-6 top-16 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1E1B4B] dark:text-white">
                <Bell className="w-3.5 h-3.5 text-[#FF8A1F]" />
                <span>Notificaciones push (@menciones)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPushPanel(false)}
                className="p-1 text-[#5B21B6] dark:text-[#DDD6FE]"
                aria-label="Cerrar notificaciones"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/70 dark:bg-[#151238] p-2.5 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75">Service Worker</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#1E1B4B] dark:text-white">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      pushStatus?.swReady ? 'bg-[#10B981]' : 'bg-amber-400'
                    }`}
                  />
                  {pushStatus?.swReady ? 'Compatible y activo' : 'En espera'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75">Permiso navegador</span>
                <span className="font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                  {pushStatus?.permission === 'granted'
                    ? 'Permitido'
                    : pushStatus?.permission === 'denied'
                    ? 'Bloqueado'
                    : pushStatus?.permission === 'unsupported'
                    ? 'No disponible'
                    : 'Sin solicitar'}
                </span>
              </div>
              {pushStatus?.hasSubscription && (
                <div className="flex items-center justify-between">
                  <span className="text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75">Suscripción Push</span>
                  <span className="font-semibold text-[#10B981]">Conectada</span>
                </div>
              )}
            </div>

            {pushActive ? (
              <label className="flex items-center justify-between gap-2 text-xs text-[#1E1B4B] dark:text-[#DDD6FE] cursor-pointer">
                <span>Solo cuando me @mencionen</span>
                <input
                  type="checkbox"
                  checked={pushPrefs?.mentionsOnly ?? true}
                  onChange={(e) => onToggleMentionsOnly?.(e.target.checked)}
                  className="rounded border-[#5B21B6] accent-[#FF8A1F]"
                />
              </label>
            ) : (
              <p className="text-xs text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 leading-relaxed">
                Recibe alertas push del navegador cuando alguien te mencione con{' '}
                <strong className="text-[#5B21B6] dark:text-white">@{currentUser.name}</strong> en
                cualquier canal.
              </p>
            )}

            {pushFeedback && (
              <p className="text-[11px] font-medium text-[#EA580C] dark:text-[#FF8A1F]">
                {pushFeedback}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {pushActive ? (
                <>
                  {onSendTestMentionPush && (
                    <button
                      type="button"
                      disabled={pushBusy}
                      onClick={async () => {
                        setPushBusy(true);
                        await onSendTestMentionPush();
                        setPushBusy(false);
                      }}
                      className="w-full rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] disabled:opacity-50 py-2 px-3 text-xs font-bold text-[#1E1B4B] transition-colors"
                    >
                      Probar alerta de mención
                    </button>
                  )}
                  {onDisablePush && (
                    <button
                      type="button"
                      disabled={pushBusy}
                      onClick={async () => {
                        setPushBusy(true);
                        await onDisablePush();
                        setPushBusy(false);
                      }}
                      className="w-full rounded-lg border border-[#DDD6FE] dark:border-[#312E81] py-1.5 px-3 text-xs font-medium text-[#1E1B4B]/75 dark:text-[#DDD6FE]/80 hover:bg-[#F5F3FF] dark:hover:bg-[#292466] transition-colors"
                    >
                      Pausar alertas en este equipo
                    </button>
                  )}
                </>
              ) : (
                onEnablePush && (
                  <button
                    type="button"
                    disabled={pushBusy || pushStatus?.permission === 'unsupported'}
                    onClick={async () => {
                      setPushBusy(true);
                      await onEnablePush();
                      setPushBusy(false);
                    }}
                    className="w-full rounded-lg bg-[#5B21B6] hover:bg-[#4C1D95] disabled:opacity-50 py-2 px-3 text-xs font-semibold text-white transition-colors"
                  >
                    {pushBusy ? 'Activando...' : 'Activar alertas push'}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </header>

      {/* Drag & drop overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#F5F3FF]/90 dark:bg-[#1E1B4B]/90">
          <div className="rounded-xl border-2 border-dashed border-[#8B5CF6] bg-white dark:bg-[#151238] px-6 py-4 text-sm font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
            Suelta el archivo aquí para compartirlo (máx. 20 MB)
          </div>
        </div>
      )}

      {/* Search active bar notice */}
      {searchQuery.trim() && (
        <div className="px-4 sm:px-6 py-2 bg-[#F5F3FF] dark:bg-[#1E1B4B]/80 border-b border-[#DDD6FE] dark:border-[#312E81] flex items-center justify-between text-xs">
          <span className="text-[#5B21B6] dark:text-[#DDD6FE]">
            {displayedMessages.length} resultado(s) para "{searchQuery.trim()}"
          </span>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="font-semibold text-[#5B21B6] dark:text-[#8B5CF6] hover:underline"
          >
            Ver todo el canal
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-4">
        {!channel ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <Hash className="w-10 h-10 text-[#DDD6FE] dark:text-[#312E81] mb-3" />
            <p className="text-sm font-medium text-[#1E1B4B] dark:text-[#F5F3FF]">
              No hay ningún canal seleccionado
            </p>
            <p className="mt-1 text-xs text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70">
              Elige un canal en la barra lateral o crea uno nuevo para empezar a conversar.
            </p>
          </div>
        ) : loadingMessages ? (
          <div className="space-y-4 py-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#F5F3FF] dark:bg-[#1E1B4B] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 rounded bg-[#F5F3FF] dark:bg-[#1E1B4B]" />
                  <div className="h-4 w-3/4 rounded bg-[#F5F3FF] dark:bg-[#1E1B4B]" />
                </div>
              </div>
            ))}
          </div>
        ) : displayedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="w-11 h-11 rounded-xl bg-[#F5F3FF] dark:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center mb-3 border border-[#DDD6FE] dark:border-[#5B21B6]/50">
              <Hash className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-[#1E1B4B] dark:text-white">
              {searchQuery.trim()
                ? 'Sin coincidencias en esta sala'
                : isDm
                ? `Conversación directa con ${channelDisplayName}`
                : `Bienvenido a #${channel.name}`}
            </p>
            <p className="mt-1 text-xs text-[#1E1B4B]/60 dark:text-[#DDD6FE]/70">
              {searchQuery.trim()
                ? 'Prueba con otra palabra o limpia el filtro.'
                : 'Aún no hay mensajes. Escribe, menciona con @ o comparte un archivo de hasta 20 MB.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {displayedMessages.map((msg, idx) => {
              const prev = idx > 0 ? displayedMessages[idx - 1] : null;
              const currentDateLabel = formatDateLabel(msg.created_at);
              const prevDateLabel = prev ? formatDateLabel(prev.created_at) : null;
              const showDateDivider = currentDateLabel !== prevDateLabel;

              const sameSender =
                prev &&
                !showDateDivider &&
                msg.parentId === null &&
                prev.parentId === null &&
                (repliesByParentId[prev.id]?.length || 0) === 0 &&
                prev.user_id === msg.user_id &&
                new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() <
                  5 * 60 * 1000;

              const senderName =
                msg.user_id === currentUser.id
                  ? currentUser.name
                  : profilesMap[msg.user_id]?.name || 'Compañero';

              const imagePreviewUrl =
                msg.file_path && isImageFile(msg.file_name)
                  ? signedUrls[msg.file_path] || previewFileUrls[msg.file_path]
                  : undefined;

              const msgReactions = (channel && reactionsByChannel[channel.id]?.[msg.id]) || {};
              const reactionEntries = Object.entries(msgReactions).filter(
                ([, users]) => users.length > 0
              );
              const isPinned = pinnedIds.includes(msg.id);
              const threadReplies = repliesByParentId[msg.id] || [];
              const threadParticipants = Array.from(
                new Set(threadReplies.map((r) => r.user_id))
              ).slice(0, 3);
              const lastThreadReply =
                threadReplies.length > 0 ? threadReplies[threadReplies.length - 1] : null;
              const parentSearchRoot =
                msg.parentId !== null ? messageById[msg.parentId] || null : null;
              const isThreadSelected = activeThreadId === msg.id;

              return (
                <React.Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="flex items-center gap-3 py-4">
                      <div className="h-px flex-1 bg-[#DDD6FE] dark:bg-[#312E81]" />
                      <span className="text-[11px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
                        {currentDateLabel}
                      </span>
                      <div className="h-px flex-1 bg-[#DDD6FE] dark:bg-[#312E81]" />
                    </div>
                  )}

                  <div
                    onClick={() =>
                      setActiveActionMsgId((cur) => (cur === msg.id ? null : msg.id))
                    }
                    className={`group relative flex items-start gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[#F5F3FF]/80 dark:hover:bg-[#1E1B4B]/70 ${
                      sameSender ? '' : 'mt-2.5 pt-1.5'
                    } ${isPinned ? 'bg-[#F5F3FF]/70 dark:bg-[#1E1B4B]/50 border-l-2 border-[#FF8A1F]' : ''} ${
                      isThreadSelected
                        ? 'bg-[#F5F3FF] dark:bg-[#1E1B4B]/90 ring-1 ring-[#8B5CF6]/40'
                        : ''
                    }`}
                  >
                    {/* Barra de acciones estilo Slack / Mattermost al pasar el cursor o tocar en móvil */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`transition-opacity absolute right-2 -top-3 z-10 flex items-center gap-0.5 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] px-1 py-0.5 shadow-md ${
                        activeActionMsgId === msg.id
                          ? 'opacity-100 pointer-events-auto'
                          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                      }`}
                    >
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleToggleReaction(msg.id, emoji)}
                          className="w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-sm flex items-center justify-center transition-colors"
                          title={`Reaccionar con ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setReactionPickerForMsg((cur) => (cur === msg.id ? null : msg.id))
                          }
                          className="w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center transition-colors"
                          title="Más reacciones"
                          aria-label="Más reacciones"
                        >
                          <SmilePlus className="w-3.5 h-3.5" />
                        </button>

                        {reactionPickerForMsg === msg.id && (
                          <div className="absolute right-0 top-8 z-20 w-52 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] p-2 shadow-xl grid grid-cols-6 gap-1">
                            {EMOJI_GROUPS.flatMap((g) => g.emojis).map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => handleToggleReaction(msg.id, em)}
                                className="w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-base flex items-center justify-center"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-[#DDD6FE] dark:bg-[#312E81] mx-0.5" />

                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(msg.parentId ?? msg.id);
                          setActiveActionMsgId(null);
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 h-7 hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] text-[11px] font-semibold transition-colors"
                        title="Responder en hilo"
                        aria-label="Responder en hilo"
                      >
                        <MessageSquareText className="w-3.5 h-3.5 text-[#FF8A1F]" />
                        <span className="hidden sm:inline">Hilo</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const raw = msg.cleanBody || msg.file_name || '';
                          const cleanExcerpt = raw.replace(/^>.*\n?/, '').trim().slice(0, 90);
                          setReplyTo({
                            id: msg.id,
                            senderName,
                            excerpt: cleanExcerpt || 'Archivo adjunto',
                          });
                          textareaRef.current?.focus();
                        }}
                        className="w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center transition-colors"
                        title="Citar en el canal"
                        aria-label="Citar en el canal"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTogglePin(msg.id)}
                        className={`w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] flex items-center justify-center transition-colors ${
                          isPinned
                            ? 'text-[#FF8A1F]'
                            : 'text-[#5B21B6] dark:text-[#DDD6FE]'
                        }`}
                        title={isPinned ? 'Desfijar mensaje' : 'Fijar mensaje en el canal'}
                        aria-label={isPinned ? 'Desfijar mensaje' : 'Fijar mensaje'}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>

                      {(msg.cleanBody || msg.file_name) && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg)}
                          className="w-7 h-7 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center transition-colors"
                          title="Copiar texto"
                          aria-label="Copiar texto"
                        >
                          {copiedMsgId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-[#10B981]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {(msg.user_id === currentUser.id || isAdmin) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="w-7 h-7 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-[#5B21B6]/70 dark:text-[#DDD6FE]/70 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center transition-colors"
                          title="Eliminar mensaje"
                          aria-label="Eliminar mensaje"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {sameSender ? (
                      <div className="w-9 shrink-0 pt-0.5 text-right">
                        <span className="hidden group-hover:inline text-[10px] font-mono tabular-nums text-[#8B5CF6]">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    ) : (
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 ${getAvatarColor(
                          msg.user_id
                        )}`}
                      >
                        {getInitials(senderName)}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      {!sameSender && (
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              insertAtCursor(`@${senderName} `);
                            }}
                            className="text-sm font-semibold text-[#1E1B4B] dark:text-white hover:text-[#5B21B6] dark:hover:text-[#DDD6FE] truncate text-left"
                            title={`Mencionar a @${senderName}`}
                          >
                            {senderName}
                          </button>
                          <span className="text-[11px] font-mono tabular-nums text-[#1E1B4B]/45 dark:text-[#DDD6FE]/60">
                            {formatTime(msg.created_at)}
                          </span>
                          {isPinned && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#EA580C] dark:text-[#FF8A1F]">
                              <Pin className="w-3 h-3" />
                              Fijado
                            </span>
                          )}
                          {parentSearchRoot && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveThreadId(parentSearchRoot.id);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-[#F5F3FF] dark:bg-[#292466] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE] hover:underline"
                            >
                              <MessageSquareText className="w-3 h-3 text-[#FF8A1F]" />
                              <span>
                                En hilo de{' '}
                                {parentSearchRoot.user_id === currentUser.id
                                  ? currentUser.name
                                  : profilesMap[parentSearchRoot.user_id]?.name || 'Compañero'}
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      {msg.cleanBody && renderMessageBody(msg.cleanBody)}

                      {msg.file_path && msg.file_name && (
                        <div className="mt-1.5 space-y-1.5">
                          {imagePreviewUrl && (
                            <button
                              type="button"
                              onClick={() => handleOpenSignedFile(msg.file_path!)}
                              className="block rounded-lg overflow-hidden border border-[#DDD6FE] dark:border-[#312E81] max-w-xs sm:max-w-sm hover:opacity-95 transition-opacity text-left"
                              title="Abrir imagen en tamaño completo"
                            >
                              <img
                                src={imagePreviewUrl}
                                alt={msg.file_name}
                                referrerPolicy="no-referrer"
                                className="max-h-64 w-auto object-contain bg-[#F5F3FF] dark:bg-[#1E1B4B]"
                              />
                            </button>
                          )}

                          <div className="inline-flex items-center gap-3 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#1E1B4B] px-3 py-2 max-w-full">
                            <FileText className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                            <span className="text-xs font-medium text-[#1E1B4B] dark:text-[#F5F3FF] truncate max-w-[180px] sm:max-w-xs">
                              {msg.file_name}
                            </span>
                            <button
                              type="button"
                              disabled={openingFilePath === msg.file_path}
                              onClick={() => handleOpenSignedFile(msg.file_path!)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#5B21B6] hover:bg-[#4C1D95] disabled:opacity-60 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors whitespace-nowrap shrink-0"
                            >
                              {openingFilePath === msg.file_path ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ExternalLink className="w-3 h-3" />
                              )}
                              <span>Abrir</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Chips de reacciones con emoji */}
                      {reactionEntries.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {reactionEntries.map(([emoji, users]) => {
                            const reactedByMe = users.includes(currentUser.id);
                            return (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleToggleReaction(msg.id, emoji)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                                  reactedByMe
                                    ? 'border-[#8B5CF6] bg-[#DDD6FE]/70 dark:bg-[#5B21B6] text-[#5B21B6] dark:text-white'
                                    : 'border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#1E1B4B] text-[#1E1B4B] dark:text-[#DDD6FE] hover:border-[#8B5CF6]'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span className="font-mono text-[11px] tabular-nums">
                                  {users.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Barra de resumen de hilo (estilo Slack / Mattermost) */}
                      {msg.parentId === null && threadReplies.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveThreadId(msg.id);
                          }}
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/70 dark:bg-[#1E1B4B]/80 hover:border-[#8B5CF6] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] px-2.5 py-1.5 text-xs transition-colors max-w-full"
                        >
                          <div className="flex -space-x-1.5 shrink-0">
                            {threadParticipants.map((uid) => {
                              const pName =
                                uid === currentUser.id
                                  ? currentUser.name
                                  : profilesMap[uid]?.name || 'Compañero';
                              return (
                                <span
                                  key={uid}
                                  className={`w-5 h-5 rounded-md ring-2 ring-white dark:ring-[#151238] flex items-center justify-center text-[9px] font-bold ${getAvatarColor(
                                    uid
                                  )}`}
                                >
                                  {getInitials(pName)}
                                </span>
                              );
                            })}
                          </div>
                          <span className="font-semibold text-[#5B21B6] dark:text-[#FF8A1F] whitespace-nowrap">
                            {threadReplies.length === 1
                              ? '1 respuesta'
                              : `${threadReplies.length} respuestas`}
                          </span>
                          {lastThreadReply && (
                            <span className="hidden sm:inline text-[11px] text-[#1E1B4B]/55 dark:text-[#DDD6FE]/65 truncate">
                              Última resp. {formatTime(lastThreadReply.created_at)}
                            </span>
                          )}
                          <ChevronRight className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                        </button>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer profesional estilo Slack / Mattermost */}
      {channel && (
        <div className="relative border-t border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238] px-3 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0">
          {errorMsg && (
            <div
              role="alert"
              className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-700 dark:text-red-200"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="p-1 text-red-500 hover:text-red-700"
                aria-label="Cerrar error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Autocompletado de @Menciones */}
          {mentionQuery !== null && mentionCandidates.length > 0 && (
            <div
              role="listbox"
              aria-label="Mencionar compañero"
              className="absolute bottom-full left-4 sm:left-6 mb-2 z-30 w-64 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto scrollbar-thin"
            >
              <div className="px-2 py-1 text-[11px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE]/80">
                Mencionar a alguien
              </div>
              {mentionCandidates.map((cand, index) => (
                <button
                  key={cand.id}
                  type="button"
                  role="option"
                  aria-selected={index === mentionActiveIdx}
                  onClick={() => selectMention(cand.name)}
                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    index === mentionActiveIdx
                      ? 'bg-[#5B21B6] text-white'
                      : 'text-[#1E1B4B] dark:text-[#F5F3FF] hover:bg-[#F5F3FF] dark:hover:bg-[#292466]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        cand.online ? 'bg-[#10B981]' : 'bg-[#DDD6FE] dark:bg-[#312E81]'
                      }`}
                    />
                    <span className="font-medium truncate">{cand.name}</span>
                  </div>
                  <span
                    className={`text-[10px] ${
                      index === mentionActiveIdx ? 'text-[#DDD6FE]' : 'text-[#8B5CF6]'
                    }`}
                  >
                    @
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Selector de Emojis flotante */}
          {showEmojiPicker && (
            <div className="absolute bottom-full left-4 sm:left-6 mb-2 z-30 w-72 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#1E1B4B] dark:text-white">
                  Emojis
                </span>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(false)}
                  className="p-0.5 text-[#5B21B6] dark:text-[#DDD6FE]"
                  aria-label="Cerrar emojis"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="space-y-1">
                  <div className="text-[11px] font-medium text-[#5B21B6] dark:text-[#DDD6FE]/75">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          insertAtCursor(emoji);
                          setShowEmojiPicker(false);
                        }}
                        className="w-7 h-7 rounded-md hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-base flex items-center justify-center transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSend}
            className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/50 dark:bg-[#1E1B4B] focus-within:border-[#8B5CF6] focus-within:ring-2 focus-within:ring-[#8B5CF6]/20 transition-shadow"
          >
            {/* Banner de cita / respuesta */}
            {replyTo && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#151238]/70 rounded-t-xl text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Reply className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                  <span className="font-semibold text-[#5B21B6] dark:text-[#DDD6FE] shrink-0">
                    {replyTo.senderName}:
                  </span>
                  <span className="truncate text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75">
                    {replyTo.excerpt}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="p-0.5 text-[#5B21B6] dark:text-[#DDD6FE] hover:text-[#1E1B4B]"
                  aria-label="Cancelar respuesta"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Chip de archivo adjunto */}
            {selectedFile && (
              <div className="px-3.5 pt-2.5">
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#151238] px-3 py-1.5 text-xs">
                  <FileText className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                  <span className="font-medium text-[#1E1B4B] dark:text-white truncate max-w-[200px] sm:max-w-sm">
                    {selectedFile.name}
                  </span>
                  <span className="text-[#5B21B6] dark:text-[#DDD6FE]/75 font-mono tabular-nums">
                    {formatFileSize(selectedFile.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="p-0.5 text-[#5B21B6] hover:text-[#1E1B4B] dark:text-[#DDD6FE] dark:hover:text-white"
                    aria-label="Quitar archivo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => validateAndAttachFile(e.target.files?.[0] || null)}
            />

            {/* Caja de texto */}
            <textarea
              ref={textareaRef}
              rows={2}
              value={body}
              onChange={handleBodyChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={sending}
              placeholder={
                isDm
                  ? `Mensaje directo para ${channelDisplayName}...`
                  : `Escribe en #${channel.name}... (usa @ para mencionar o pega imágenes)`
              }
              className="w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1.5 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/45 dark:placeholder:text-[#DDD6FE]/45 focus:outline-none min-h-[52px] max-h-36"
            />

            {/* Barra de herramientas inferior estilo Mattermost / Slack */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1 border-t border-[#DDD6FE]/60 dark:border-[#312E81]/80">
              <div className="flex items-center gap-0.5 sm:gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466] transition-colors"
                  title="Adjuntar o compartir archivo (máx. 20 MB)"
                  aria-label="Adjuntar archivo"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker((p) => !p);
                    setMentionQuery(null);
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    showEmojiPicker
                      ? 'bg-[#5B21B6] text-white'
                      : 'text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]'
                  }`}
                  title="Insertar emoji"
                  aria-label="Insertar emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(false);
                    if (mentionQuery !== null) {
                      setMentionQuery(null);
                    } else {
                      const cursor = textareaRef.current?.selectionStart ?? body.length;
                      const needsSpace = cursor > 0 && !/\s$/.test(body.slice(0, cursor));
                      const prefix = needsSpace ? ' @' : '@';
                      insertAtCursor(prefix);
                      setMentionStartIndex(cursor + (needsSpace ? 1 : 0));
                      setMentionQuery('');
                      setMentionActiveIdx(0);
                    }
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    mentionQuery !== null
                      ? 'bg-[#5B21B6] text-white'
                      : 'text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]'
                  }`}
                  title="Mencionar compañero (@)"
                  aria-label="Mencionar compañero"
                >
                  <AtSign className="w-4 h-4" />
                </button>

                <span className="hidden sm:block h-4 w-px bg-[#DDD6FE] dark:bg-[#312E81] mx-1" />

                <button
                  type="button"
                  onClick={() => wrapSelection('**', '**', 'negrita')}
                  className="hidden sm:flex p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466] transition-colors"
                  title="Negrita (**texto**)"
                  aria-label="Negrita"
                >
                  <Bold className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => wrapSelection('_', '_', 'cursiva')}
                  className="hidden sm:flex p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466] transition-colors"
                  title="Cursiva (_texto_)"
                  aria-label="Cursiva"
                >
                  <Italic className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => wrapSelection('`', '`', 'código')}
                  className="hidden sm:flex p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466] transition-colors"
                  title="Código (`código`)"
                  aria-label="Código"
                >
                  <Code className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="hidden lg:inline text-[11px] text-[#1E1B4B]/50 dark:text-[#DDD6FE]/55">
                  Enter para enviar
                </span>

                <button
                  type="submit"
                  disabled={sending || (!body.trim() && !selectedFile)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] disabled:opacity-45 px-3.5 py-2 text-xs sm:text-sm font-bold text-[#1E1B4B] shadow-sm transition-colors min-h-[38px] shrink-0"
                  aria-label="Enviar mensaje"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>Enviar</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      </div>

      {/* Panel lateral / móvil de hilo de conversación */}
      {channel && activeThreadRoot && (
        <ThreadPanel
          channel={channel}
          channelDisplayName={channelDisplayName}
          isDm={isDm}
          rootMessage={activeThreadRoot}
          replies={activeThreadReplies}
          currentUser={currentUser}
          profilesMap={profilesMap}
          onlineUsers={onlineUsers}
          isAdmin={isAdmin}
          reactionsByMsg={reactionsByChannel[channel.id] || {}}
          signedUrls={signedUrls}
          openingFilePath={openingFilePath}
          emojiGroups={EMOJI_GROUPS}
          quickReactions={QUICK_REACTIONS}
          formatTime={formatTime}
          formatFileSize={formatFileSize}
          renderMessageBody={renderMessageBody}
          onClose={() => setActiveThreadId(null)}
          onToggleReaction={handleToggleReaction}
          onOpenFile={handleOpenSignedFile}
          onDeleteMessage={handleDeleteMessage}
          onSendReply={handleSendThreadReply}
        />
      )}
    </main>
  );
};
