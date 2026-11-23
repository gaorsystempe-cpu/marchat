import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Bold,
  Check,
  Code,
  Copy,
  ExternalLink,
  FileText,
  Italic,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  Smile,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import {
  Channel,
  MAX_FILE_SIZE_BYTES,
  Message,
  OnlineUser,
  Profile,
  getAvatarColor,
  getInitials,
  isImageFile,
} from '../supabaseClient';
import { previewFileUrls } from '../previewStore';

export interface NormalizedMessage extends Message {
  parentId: number | null;
  cleanBody: string | null;
}

interface ThreadPanelProps {
  channel: Channel;
  channelDisplayName: string;
  isDm: boolean;
  rootMessage: NormalizedMessage;
  replies: NormalizedMessage[];
  currentUser: Profile;
  profilesMap: Record<string, Profile>;
  onlineUsers: OnlineUser[];
  isAdmin: boolean;
  reactionsByMsg: Record<number, Record<string, string[]>>;
  signedUrls: Record<string, string>;
  openingFilePath: string | null;
  emojiGroups: { label: string; emojis: string[] }[];
  quickReactions: string[];
  formatTime: (iso: string) => string;
  formatFileSize: (bytes: number) => string;
  renderMessageBody: (text: string) => React.ReactNode;
  onClose: () => void;
  onToggleReaction: (msgId: number, emoji: string) => void;
  onOpenFile: (filePath: string) => void;
  onDeleteMessage: (msgId: number) => void;
  onSendReply: (params: {
    parentId: number;
    body: string;
    file: File | null;
    alsoSendToChannel: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export const ThreadPanel: React.FC<ThreadPanelProps> = ({
  channelDisplayName,
  isDm,
  rootMessage,
  replies,
  currentUser,
  profilesMap,
  onlineUsers,
  isAdmin,
  reactionsByMsg,
  signedUrls,
  openingFilePath,
  emojiGroups,
  quickReactions,
  formatTime,
  formatFileSize,
  renderMessageBody,
  onClose,
  onToggleReaction,
  onOpenFile,
  onDeleteMessage,
  onSendReply,
}) => {
  const [body, setBody] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactionPickerForMsg, setReactionPickerForMsg] = useState<number | null>(null);
  const [activeActionMsgId, setActiveActionMsgId] = useState<number | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const repliesEndRef = useRef<HTMLDivElement>(null);
  const prevReplyCountRef = useRef<number>(replies.length);

  // Focus composer when opening a new thread and scroll to latest reply
  useEffect(() => {
    setErrorMsg(null);
    setShowEmojiPicker(false);
    setReactionPickerForMsg(null);
    setMentionQuery(null);
    prevReplyCountRef.current = replies.length;
    setTimeout(() => {
      repliesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      textareaRef.current?.focus();
    }, 40);
  }, [rootMessage.id]);

  // Scroll down when new replies arrive
  useEffect(() => {
    if (replies.length > prevReplyCountRef.current) {
      setTimeout(() => {
        repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 30);
    }
    prevReplyCountRef.current = replies.length;
  }, [replies.length]);

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

  const getSenderName = (userId: string) =>
    userId === currentUser.id ? currentUser.name : profilesMap[userId]?.name || 'Compañero';

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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (sending) return;
    const trimmed = body.trim();
    if (!trimmed && !selectedFile) return;

    setSending(true);
    setErrorMsg(null);
    const res = await onSendReply({
      parentId: rootMessage.id,
      body: trimmed,
      file: selectedFile,
      alsoSendToChannel,
    });
    setSending(false);

    if (!res.ok) {
      setErrorMsg(res.error || 'No se pudo enviar la respuesta en el hilo.');
      return;
    }

    setBody('');
    setSelectedFile(null);
    setAlsoSendToChannel(false);
    setShowEmojiPicker(false);
    setMentionQuery(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => {
      repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 30);
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
      void handleSubmit();
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

  const renderMessageItem = (msg: NormalizedMessage, isRoot: boolean) => {
    const senderName = getSenderName(msg.user_id);
    const imagePreviewUrl =
      msg.file_path && isImageFile(msg.file_name)
        ? signedUrls[msg.file_path] || previewFileUrls[msg.file_path]
        : undefined;
    const msgReactions = reactionsByMsg[msg.id] || {};
    const reactionEntries = Object.entries(msgReactions).filter(([, users]) => users.length > 0);

    return (
      <div
        key={msg.id}
        onClick={() => setActiveActionMsgId((cur) => (cur === msg.id ? null : msg.id))}
        className={`group relative flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors ${
          isRoot
            ? 'bg-[#F5F3FF]/80 dark:bg-[#1E1B4B]/80 border border-[#DDD6FE] dark:border-[#312E81]'
            : 'hover:bg-[#F5F3FF]/70 dark:hover:bg-[#1E1B4B]/60'
        }`}
      >
        {/* Barra flotante de acciones del hilo */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`transition-opacity absolute right-2 -top-2.5 z-10 flex items-center gap-0.5 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] px-1 py-0.5 shadow-md ${
            activeActionMsgId === msg.id
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
          }`}
        >
          {quickReactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(msg.id, emoji)}
              className="w-6 h-6 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-xs flex items-center justify-center transition-colors"
              title={`Reaccionar con ${emoji}`}
            >
              {emoji}
            </button>
          ))}

          <div className="relative">
            <button
              type="button"
              onClick={() => setReactionPickerForMsg((cur) => (cur === msg.id ? null : msg.id))}
              className="w-6 h-6 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center"
              title="Más reacciones"
              aria-label="Más reacciones"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>

            {reactionPickerForMsg === msg.id && (
              <div className="absolute right-0 top-7 z-20 w-48 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] p-2 shadow-xl grid grid-cols-6 gap-1">
                {emojiGroups.flatMap((g) => g.emojis).map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      onToggleReaction(msg.id, em);
                      setReactionPickerForMsg(null);
                    }}
                    className="w-6 h-6 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-sm flex items-center justify-center"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(msg.cleanBody || msg.file_name) && (
            <button
              type="button"
              onClick={() => handleCopyMessage(msg)}
              className="w-6 h-6 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-[#5B21B6] dark:text-[#DDD6FE] flex items-center justify-center"
              title="Copiar texto"
              aria-label="Copiar texto"
            >
              {copiedMsgId === msg.id ? (
                <Check className="w-3 h-3 text-[#10B981]" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}

          {!isRoot && (msg.user_id === currentUser.id || isAdmin) && (
            <button
              type="button"
              onClick={() => onDeleteMessage(msg.id)}
              className="w-6 h-6 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-[#5B21B6]/70 dark:text-[#DDD6FE]/70 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center"
              title="Eliminar respuesta"
              aria-label="Eliminar respuesta"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5 ${getAvatarColor(
            msg.user_id
          )}`}
        >
          {getInitials(senderName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                insertAtCursor(`@${senderName} `);
              }}
              className="text-xs sm:text-sm font-semibold text-[#1E1B4B] dark:text-white hover:text-[#5B21B6] dark:hover:text-[#DDD6FE] truncate text-left"
              title={`Mencionar a @${senderName}`}
            >
              {senderName}
            </button>
            <span className="text-[10px] font-mono tabular-nums text-[#1E1B4B]/45 dark:text-[#DDD6FE]/60">
              {formatTime(msg.created_at)}
            </span>
          </div>

          {msg.cleanBody && <div className="mt-0.5">{renderMessageBody(msg.cleanBody)}</div>}

          {msg.file_path && msg.file_name && (
            <div className="mt-1.5 space-y-1.5">
              {imagePreviewUrl && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFile(msg.file_path!);
                  }}
                  className="block rounded-lg overflow-hidden border border-[#DDD6FE] dark:border-[#312E81] max-w-full hover:opacity-95 transition-opacity text-left"
                >
                  <img
                    src={imagePreviewUrl}
                    alt={msg.file_name}
                    referrerPolicy="no-referrer"
                    className="max-h-48 w-auto object-contain bg-[#F5F3FF] dark:bg-[#1E1B4B]"
                  />
                </button>
              )}

              <div className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#1E1B4B] px-2.5 py-1.5 max-w-full">
                <FileText className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                <span className="text-xs font-medium text-[#1E1B4B] dark:text-[#F5F3FF] truncate max-w-[140px]">
                  {msg.file_name}
                </span>
                <button
                  type="button"
                  disabled={openingFilePath === msg.file_path}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFile(msg.file_path!);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-[#5B21B6] hover:bg-[#4C1D95] px-2 py-0.5 text-[11px] font-semibold text-white shrink-0"
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

          {reactionEntries.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {reactionEntries.map(([emoji, users]) => {
                const reactedByMe = users.includes(currentUser.id);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleReaction(msg.id, emoji);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                      reactedByMe
                        ? 'border-[#8B5CF6] bg-[#DDD6FE]/70 dark:bg-[#5B21B6] text-[#5B21B6] dark:text-white'
                        : 'border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF] dark:bg-[#1E1B4B] text-[#1E1B4B] dark:text-[#DDD6FE]'
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="font-mono text-[10px] tabular-nums">{users.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Hilo de conversación"
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        validateAndAttachFile(e.dataTransfer.files?.[0] || null);
      }}
      className={`fixed inset-0 z-30 md:static md:z-auto w-full md:w-80 lg:w-96 flex flex-col h-full bg-white dark:bg-[#151238] border-l border-[#DDD6FE] dark:border-[#312E81] shrink-0 ${
        isDragging ? 'ring-2 ring-inset ring-[#FF8A1F]' : ''
      }`}
    >
      {/* Cabecera del hilo */}
      <div className="flex min-h-14 pt-[env(safe-area-inset-top)] items-center justify-between gap-2 px-4 border-b border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="md:hidden -ml-2 p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Volver al canal"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <MessageSquareText className="w-4 h-4 text-[#FF8A1F] shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm text-[#1E1B4B] dark:text-white leading-tight truncate">
              Hilo
            </h2>
            <p className="text-[11px] text-[#5B21B6] dark:text-[#DDD6FE]/75 truncate">
              {isDm ? channelDisplayName : `#${channelDisplayName}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] min-h-[36px] min-w-[36px] flex items-center justify-center"
          title="Cerrar hilo"
          aria-label="Cerrar hilo"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mensaje original + respuestas */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-3">
        {renderMessageItem(rootMessage, true)}

        <div className="flex items-center gap-2.5 px-1">
          <span className="text-[11px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE]">
            {replies.length === 0
              ? 'Sin respuestas aún'
              : replies.length === 1
              ? '1 respuesta'
              : `${replies.length} respuestas`}
          </span>
          <div className="h-px flex-1 bg-[#DDD6FE] dark:bg-[#312E81]" />
        </div>

        {replies.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[#1E1B4B]/55 dark:text-[#DDD6FE]/65">
            Responde aquí abajo para mantener este tema organizado fuera del chat principal.
          </p>
        ) : (
          <div className="space-y-1.5">{replies.map((reply) => renderMessageItem(reply, false))}</div>
        )}
        <div ref={repliesEndRef} />
      </div>

      {/* Compositor exclusivo del hilo */}
      <div className="relative border-t border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#151238] px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0">
        {errorMsg && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-200"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="p-0.5 text-red-500"
              aria-label="Cerrar error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div
            role="listbox"
            aria-label="Mencionar en hilo"
            className="absolute bottom-full left-3 right-3 mb-2 z-30 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-1.5 space-y-0.5 max-h-44 overflow-y-auto scrollbar-thin"
          >
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
                <span className="text-[10px] opacity-75">@</span>
              </button>
            ))}
          </div>
        )}

        {showEmojiPicker && (
          <div className="absolute bottom-full left-3 mb-2 z-30 w-64 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] shadow-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1E1B4B] dark:text-white">Emojis</span>
              <button
                type="button"
                onClick={() => setShowEmojiPicker(false)}
                className="p-0.5 text-[#5B21B6] dark:text-[#DDD6FE]"
                aria-label="Cerrar emojis"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {emojiGroups.map((group) => (
              <div key={group.label} className="grid grid-cols-8 gap-1">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      insertAtCursor(emoji);
                      setShowEmojiPicker(false);
                    }}
                    className="w-6 h-6 rounded hover:bg-[#F5F3FF] dark:hover:bg-[#292466] text-sm flex items-center justify-center"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/50 dark:bg-[#1E1B4B] focus-within:border-[#8B5CF6] focus-within:ring-2 focus-within:ring-[#8B5CF6]/20"
        >
          {selectedFile && (
            <div className="px-3 pt-2">
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#151238] px-2.5 py-1 text-xs">
                <FileText className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                <span className="truncate max-w-[160px] text-[#1E1B4B] dark:text-white">
                  {selectedFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  aria-label="Quitar archivo"
                >
                  <X className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#DDD6FE]" />
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

          <textarea
            ref={textareaRef}
            rows={2}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={sending}
            placeholder="Responder en el hilo..."
            className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/45 dark:placeholder:text-[#DDD6FE]/45 focus:outline-none min-h-[48px] max-h-32"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 border-t border-[#DDD6FE]/60 dark:border-[#312E81]/80">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Adjuntar archivo"
                aria-label="Adjuntar archivo en hilo"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker((p) => !p);
                  setMentionQuery(null);
                }}
                className="p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Emoji"
                aria-label="Insertar emoji en hilo"
              >
                <Smile className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker(false);
                  const cursor = textareaRef.current?.selectionStart ?? body.length;
                  const needsSpace = cursor > 0 && !/\s$/.test(body.slice(0, cursor));
                  insertAtCursor(needsSpace ? ' @' : '@');
                  setMentionStartIndex(cursor + (needsSpace ? 1 : 0));
                  setMentionQuery('');
                  setMentionActiveIdx(0);
                }}
                className="p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Mencionar (@)"
                aria-label="Mencionar en hilo"
              >
                <AtSign className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection('**', '**', 'negrita')}
                className="hidden sm:flex p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Negrita"
                aria-label="Negrita"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection('_', '_', 'cursiva')}
                className="hidden sm:flex p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Cursiva"
                aria-label="Cursiva"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection('`', '`', 'código')}
                className="hidden sm:flex p-1.5 rounded-lg text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#DDD6FE]/60 dark:hover:bg-[#292466]"
                title="Código"
                aria-label="Código"
              >
                <Code className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="submit"
              disabled={sending || (!body.trim() && !selectedFile)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] disabled:opacity-45 px-3 py-1.5 text-xs font-bold text-[#1E1B4B] shadow-sm transition-colors shrink-0"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Responder</span>
            </button>
          </div>
        </form>

        <label className="mt-2 flex items-center gap-2 text-[11px] text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={alsoSendToChannel}
            onChange={(e) => setAlsoSendToChannel(e.target.checked)}
            className="rounded border-[#5B21B6] accent-[#FF8A1F]"
          />
          <span>También enviar al canal</span>
        </label>
      </div>
    </aside>
  );
};
