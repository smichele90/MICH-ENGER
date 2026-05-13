import React, { useState, useEffect, useRef } from 'react'
import { Send, Paperclip, Image, Mic, Clock, CheckSquare, User, Users, Share2, X, Square } from 'lucide-react'
import MessageToTask from './MessageToTask'
import ScheduleMessageModal from './ScheduleMessageModal'
import MediaPreview from './MediaPreview'
import MessageBody from './MessageBody'
import AvatarImage from './AvatarImage'
import SenderAvatar from './SenderAvatar'
import ForwardModal from './ForwardModal'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function AckIndicator({ ack }) {
  if (ack == null || ack === 0) return <span className="ack ack--pending" title="In attesa">🕐</span>
  if (ack === 1) return <span className="ack ack--sent" title="Inviato">✓</span>
  if (ack === 2) return <span className="ack ack--delivered" title="Consegnato">✓✓</span>
  return <span className="ack ack--read" title="Letto">✓✓</span>
}

function ReactionsBar({ reactions }) {
  if (!reactions || reactions.length === 0) return null
  const counts = {}
  for (const r of reactions) counts[r.emoji] = (counts[r.emoji] || 0) + 1
  return (
    <div className="reactions-bar">
      {Object.entries(counts).map(([emoji, count]) => (
        <span key={emoji} className="reactions-bar__chip">
          {emoji}{count > 1 && <span className="reactions-bar__count">{count}</span>}
        </span>
      ))}
    </div>
  )
}

function ReactionPicker({ onReact, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className="reaction-picker">
      {QUICK_EMOJIS.map(e => (
        <button key={e} className="reaction-picker__btn" onClick={() => onReact(e)}>{e}</button>
      ))}
    </div>
  )
}

function MentionSuggestions({ suggestions, activeIndex, onSelect }) {
  return (
    <div className="mention-suggestions">
      {suggestions.map((m, i) => (
        <div
          key={m.id}
          className={`mention-suggestions__item ${i === activeIndex ? 'mention-suggestions__item--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(m) }}
        >
          <span className="mention-suggestions__name">{m.name || m.push_name || m.phone_number}</span>
          {m.phone_number && <span className="mention-suggestions__phone">{m.phone_number}</span>}
        </div>
      ))}
    </div>
  )
}

export default function ChatView({ contact, accountId, highlightMessageId, onHighlightDone }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskPopover, setTaskPopover] = useState(null) // { message, rect }
  const [showSchedule, setShowSchedule] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [downloadingMedia, setDownloadingMedia] = useState(new Set())
  const [selectedFiles, setSelectedFiles] = useState([])
  const [recording, setRecording] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState('')
  const [reactionsMap, setReactionsMap] = useState(new Map())
  const [showReactionPicker, setShowReactionPicker] = useState(null)
  const [showForwardModal, setShowForwardModal] = useState(null)
  const [chatError, setChatError] = useState('')
  const [groupMembers, setGroupMembers] = useState([])
  const [sendersMap, setSendersMap] = useState({})
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const recordingCanceledRef = useRef(false)
  const recordingTimerRef = useRef(null)

  useEffect(() => {
    if (!chatError) return
    const t = setTimeout(() => setChatError(''), 4000)
    return () => clearTimeout(t)
  }, [chatError])

  // Risolve info mittenti (nome + profile pic) per messaggi di gruppo
  useEffect(() => {
    if (!contact?.is_group || !accountId) return
    const missing = new Set()
    for (const m of messages) {
      if (m.is_from_me) continue
      const wid = m.sender_wa_id
      if (wid && !sendersMap[wid]) missing.add(wid)
    }
    if (missing.size === 0) return
    let cancelled = false
    window.api.resolveSenders(accountId, Array.from(missing))
      .then(map => {
        if (cancelled || !map) return
        setSendersMap(prev => ({ ...prev, ...map }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [messages, contact?.is_group, accountId, sendersMap])

  // Scarica media on-demand
  const handleDownloadMedia = async (msgId) => {
    if (downloadingMedia.has(msgId)) return
    setDownloadingMedia(prev => new Set(prev).add(msgId))
    try {
      const r = await window.api.downloadMedia(accountId, msgId)
      if (r?.success) {
        setMessages(prev => prev.map(m => m.id === msgId
          ? { ...m, media_path: r.media_path, media_mime: r.media_mime, media_filename: r.media_filename }
          : m))
      }
    } finally {
      setDownloadingMedia(prev => { const n = new Set(prev); n.delete(msgId); return n })
    }
  }
  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)
  const pendingMentionIdsRef = useRef([])

  // Reset sendersMap quando cambia contatto
  useEffect(() => { setSendersMap({}) }, [contact?.id])

  // Carica messaggi
  useEffect(() => {
    if (!contact?.id) return
    async function load() {
      setLoading(true)
      const msgs = await window.api.getMessages(contact.id, 100, 0)
      setMessages(msgs.reverse())
      setLoading(false)

      // Segna come letto all'apertura
      window.api.markAsRead(accountId, contact.id).catch(() => {})

      // Carica partecipanti gruppo per @mention autocomplete
      if (contact.is_group && contact.whatsapp_id) {
        window.api.getGroupParticipants(accountId, contact.whatsapp_id)
          .then(members => setGroupMembers(members || []))
          .catch(() => {})
      } else {
        setGroupMembers([])
      }

      // Carica reazioni per questa chat
      try {
        const rawReactions = await window.api.getReactions(contact.id)
        const rMap = new Map()
        for (const r of rawReactions) {
          const list = rMap.get(r.wa_serialized_id) || []
          list.push(r)
          rMap.set(r.wa_serialized_id, list)
        }
        setReactionsMap(rMap)
      } catch {}
    }
    load()

    const removeMsgListener = window.api.onWhatsAppEvent('wa:message', ({ accountId: msgAccountId, message }) => {
      if (msgAccountId === accountId && message.contact_id === contact.id) {
        setMessages(prev => {
          if (prev.some(m =>
            (message.wa_message_id && m.wa_message_id === message.wa_message_id) ||
            (message.wa_serialized_id && m.wa_serialized_id === message.wa_serialized_id)
          )) return prev
          return [...prev, message]
        })
      }
    })

    const removeHistoryListener = window.api.onWhatsAppEvent('wa:history-synced', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) load()
    })

    const removeAckListener = window.api.onWhatsAppEvent('wa:message-ack', ({ accountId: aId, waSerializedId, ack }) => {
      if (aId !== accountId) return
      setMessages(prev => prev.map(m => m.wa_serialized_id === waSerializedId ? { ...m, ack } : m))
    })

    const removeReactionListener = window.api.onWhatsAppEvent('wa:reaction', ({ accountId: aId, waSerializedId, emoji, senderWaId, senderName, removed }) => {
      if (aId !== accountId) return
      setReactionsMap(prev => {
        const next = new Map(prev)
        const list = (next.get(waSerializedId) || []).filter(r => r.sender_wa_id !== senderWaId)
        if (!removed && emoji) list.push({ wa_serialized_id: waSerializedId, emoji, sender_wa_id: senderWaId, sender_name: senderName })
        next.set(waSerializedId, list)
        return next
      })
    })

    return () => {
      removeMsgListener?.()
      removeHistoryListener?.()
      removeAckListener?.()
      removeReactionListener?.()
    }
  }, [contact?.id, accountId])

  // Scroll in fondo (saltato se stiamo evidenziando un messaggio specifico
  // arrivato da un task, altrimenti lo scroll-end vincerebbe la race con
  // lo scroll-to-message qui sotto)
  useEffect(() => {
    if (highlightMessageId) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, highlightMessageId])

  // Scroll + highlight sul messaggio sorgente quando richiesto da TaskDetail
  useEffect(() => {
    if (!highlightMessageId || !messages.length) return
    const el = document.getElementById(`msg-${highlightMessageId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' })
      el.classList.add('msg-highlight')
      const t = setTimeout(() => {
        el.classList.remove('msg-highlight')
        onHighlightDone?.()
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [highlightMessageId, messages])

  // Auto-resize textarea + @mention detection
  const handleInputChange = (e) => {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    }
    if (contact.is_group && groupMembers.length > 0) {
      const cursor = e.target.selectionStart
      const before = e.target.value.slice(0, cursor)
      const match = before.match(/@([^@\s]*)$/)
      if (match) {
        const q = match[1].toLowerCase()
        const filtered = groupMembers.filter(m => {
          const name = (m.name || m.push_name || '').toLowerCase()
          const phone = (m.phone_number || m.whatsapp_id?.split('@')[0] || '').toLowerCase()
          return name.includes(q) || phone.includes(q)
        })
        setMentionSuggestions(filtered.slice(0, 6))
        setMentionActive(filtered.length > 0)
        setMentionIndex(0)
      } else {
        setMentionActive(false)
        setMentionSuggestions([])
      }
    }
  }

  const insertMention = (member) => {
    const displayName = member.name || member.push_name || member.whatsapp_id.split('@')[0]
    const cursor = textareaRef.current.selectionStart
    const before = input.slice(0, cursor).replace(/@[^@\s]*$/, `@${displayName} `)
    const after = input.slice(cursor)
    setInput(before + after)
    pendingMentionIdsRef.current.push(member.whatsapp_id)
    setMentionActive(false)
    setMentionSuggestions([])
    textareaRef.current.focus()
  }

  const handleReact = async (msg, emoji) => {
    setShowReactionPicker(null)
    if (!msg.wa_serialized_id) return
    try {
      await window.api.reactToMessage(accountId, msg.wa_serialized_id, emoji)
    } catch (err) {
      console.error('[ChatView] reactToMessage error:', err)
    }
  }

  // Invia messaggio
  const handleSend = async () => {
    if (!input.trim() && selectedFiles.length === 0) return

    try {
      if (selectedFiles.length > 0) {
        const text = input.trim()
        for (let i = 0; i < selectedFiles.length; i++) {
          const f = selectedFiles[i]
          await sendMediaMessage({
            mediaPath: f.path,
            caption: i === 0 ? text : undefined
          })
        }
        setSelectedFiles([])
        setInput('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      } else {
        const mentionedWaIds = contact.is_group
          ? [...new Set(pendingMentionIdsRef.current)]
          : []
        await window.api.sendMessage(accountId, contact.id, input.trim(),
          mentionedWaIds.length > 0 ? { mentions: mentionedWaIds } : undefined
        )
        setInput('')
        pendingMentionIdsRef.current = []
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      console.error('Errore invio:', err)
      setChatError('Errore invio messaggio: riprova tra qualche istante.')
    }
  }

  const handleKeyDown = (e) => {
    if (mentionActive && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIndex]); return }
      if (e.key === 'Escape')    { setMentionActive(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const getBase64FromBlob = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result
      const base64 = dataUrl.split(',')[1] || ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const getFileName = (filePath) => {
    const parts = filePath.split(/[/\\]/)
    return parts[parts.length - 1] || filePath
  }

  const isImageFile = (filePath) => /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(filePath)

  const getSafeFileUrl = (filePath) => {
    try {
      return encodeURI(`file://${filePath}`)
    } catch {
      return `file://${filePath}`
    }
  }

  const sendMediaMessage = async ({ mediaPath, mediaData, mediaMime, filename, caption }) => {
    if (!contact?.id) return
    try {
      setLoading(true)
      await window.api.sendMessage(accountId, contact.id, caption || '', {
        caption: caption || undefined,
        mediaPath,
        mediaData,
        mediaMime,
        filename
      })
    } catch (err) {
      console.error('Errore invio media:', err)
      setChatError(`Errore invio allegato: ${err?.message || 'riprova tra qualche istante'}`)
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const handleSelectFile = async (options) => {
    try {
      const baseProps = options?.properties || ['openFile']
      const properties = baseProps.includes('multiSelections') ? baseProps : [...baseProps, 'multiSelections']
      const result = await window.api.selectFile({ ...options, properties })
      if (result?.canceled || !result?.filePaths?.length) return
      const items = await Promise.all(result.filePaths.map(async (p) => {
        const info = await window.api.getFileInfo(p)
        return {
          path: p,
          name: getFileName(p),
          isImage: isImageFile(p),
          size: info?.size ?? null,
          mime: info?.mime ?? null
        }
      }))
      setSelectedFiles(prev => [...prev, ...items])
    } catch (err) {
      console.error('Errore selezione file:', err)
      setChatError('Impossibile selezionare il file.')
    }
  }

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMime = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
        ? 'audio/ogg; codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
          ? 'audio/webm; codecs=opus'
          : ''
      const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream)
      const chunks = []

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      })

      recorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((track) => track.stop())
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
        if (recordingCanceledRef.current) {
          recordingCanceledRef.current = false
          setRecording(false)
          setRecordingStatus('')
          return
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const base64 = await getBase64FromBlob(blob)
        const ext = blob.type.includes('ogg') ? 'ogg' : 'webm'
        await sendMediaMessage({
          mediaData: base64,
          mediaMime: blob.type,
          filename: `audio-${Date.now()}.${ext}`
        })
        setRecording(false)
        setRecordingStatus('')
      })

      recorder.start()
      mediaRecorderRef.current = recorder
      mediaStreamRef.current = stream
      setRecording(true)
      let seconds = 0
      setRecordingStatus('00:00')
      recordingTimerRef.current = window.setInterval(() => {
        seconds += 1
        const m = String(Math.floor(seconds / 60)).padStart(2, '0')
        const s = String(seconds % 60).padStart(2, '0')
        setRecordingStatus(`${m}:${s}`)
      }, 1000)
    } catch (err) {
      console.error('Errore avvio registrazione:', err)
      setChatError('Impossibile avviare la registrazione audio.')
    }
  }

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current) return
    mediaRecorderRef.current.stop()
  }

  const handleCancelRecording = () => {
    recordingCanceledRef.current = true
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
    }
    setRecording(false)
    setRecordingStatus('')
    clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
  }

  const formatTime = (ts) => {
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const formatDate = (ts) => {
    try {
      const d = new Date(ts)
      const today = new Date()
      if (d.toDateString() === today.toDateString()) return 'Oggi'
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      if (d.toDateString() === yesterday.toDateString()) return 'Ieri'
      return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch { return '' }
  }

  // Raggruppa messaggi per data
  let lastDate = ''

  return (
    <>
      {/* Header chat */}
      <div className="main-header">
        <div className="main-header__info">
          <AvatarImage
            profilePicPath={contact.profile_pic_path}
            profilePicUrl={contact.profile_pic_url}
            isGroup={contact.is_group}
            className="main-header__avatar"
            style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          />
          <div>
            <div className="main-header__name">{contact.name || contact.push_name || contact.phone_number || contact.whatsapp_id?.split('@')[0]}</div>
            <div className="main-header__status">
              {contact.is_group ? 'Gruppo' : contact.phone_number || 'Contatto'}
            </div>
          </div>
        </div>
      </div>

      {/* Area messaggi */}
      <div className="chat-area">
        {loading && (
          <div className="empty-state">
            <div className="empty-state__text">Caricamento messaggi...</div>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">💬</div>
            <div className="empty-state__text">Nessun messaggio ancora. Inizia la conversazione!</div>
          </div>
        )}
        {messages.map((msg) => {
          const msgDate = formatDate(msg.timestamp)
          let showDateSep = false
          if (msgDate !== lastDate) { showDateSep = true; lastDate = msgDate }
          const showSender = contact.is_group && !msg.is_from_me && (msg.sender_name || msg.sender_wa_id)
          const senderInfo = msg.sender_wa_id ? sendersMap[msg.sender_wa_id] : null

          return (
            <React.Fragment key={msg.id}>
              {showDateSep && (
                <div style={{ textAlign: 'center', margin: '16px 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ background: 'var(--bg-card)', padding: '4px 14px', borderRadius: 12 }}>{msgDate}</span>
                </div>
              )}
              <div id={`msg-${msg.id}`} className={`message ${msg.is_from_me ? 'message--me' : 'message--other'}`}>
                {showSender && (
                  <div className="message__sender-row">
                    <SenderAvatar
                      waId={msg.sender_wa_id}
                      name={msg.sender_name}
                      info={senderInfo}
                      size={22}
                    />
                    <span className="message__sender-name">
                      {senderInfo?.name || msg.sender_name || (msg.sender_wa_id || '').split('@')[0]}
                    </span>
                  </div>
                )}
                <div className="message__bubble-row">
                  <div className="message__bubble">
                    {msg.media_type && msg.media_type !== 'text' && (
                      <MediaPreview
                        msg={msg}
                        downloading={downloadingMedia.has(msg.id)}
                        onDownload={handleDownloadMedia}
                        onPreviewImage={setPreviewImage}
                        onOpenFile={(p) => window.api.openFile(p)}
                      />
                    )}
                    {msg.body && (
                      <MessageBody
                        body={msg.body}
                        accountId={accountId}
                        isGroup={contact.is_group}
                      />
                    )}
                  </div>
                  <div className="message__actions">
                    <button
                      className="message__action-btn"
                      title="Converti in Task"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTaskPopover({ message: msg, rect })
                      }}
                    >
                      <CheckSquare size={14} strokeWidth={1.6} />
                    </button>
                    {msg.wa_serialized_id && (
                      <button
                        className="message__action-btn"
                        title="Reagisci"
                        onClick={() => setShowReactionPicker(prev => prev === msg.wa_serialized_id ? null : msg.wa_serialized_id)}
                      >
                        😊
                      </button>
                    )}
                    {msg.wa_serialized_id && (
                      <button
                        className="message__action-btn"
                        title="Inoltra"
                        onClick={() => setShowForwardModal({ waSerializedId: msg.wa_serialized_id })}
                      >
                        <Share2 size={14} strokeWidth={1.6} />
                      </button>
                    )}
                    {showReactionPicker === msg.wa_serialized_id && (
                      <ReactionPicker
                        onReact={(emoji) => handleReact(msg, emoji)}
                        onClose={() => setShowReactionPicker(null)}
                      />
                    )}
                  </div>
                </div>
                <ReactionsBar reactions={reactionsMap.get(msg.wa_serialized_id) || []} />
                <div className="message__time">
                  {formatTime(msg.timestamp)}
                  {msg.is_from_me === 1 && <AckIndicator ack={msg.ack} />}
                </div>
              </div>
            </React.Fragment>
          )
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Banner errore inline (no alert) */}
      {chatError && (
        <div style={{
          padding: '8px 16px', background: 'rgba(239,68,68,0.12)', borderTop: '1px solid var(--danger)',
          color: 'var(--danger)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>{chatError}</span>
          <button onClick={() => setChatError('')} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Input messaggio */}
      <div className="chat-input-area">
        {recording ? (
          <div className="chat-input-actions">
            <button className="btn btn--primary" onClick={handleStopRecording} title="Ferma e invia">
              <Square size={14} fill="currentColor" />
              <span style={{ marginLeft: 6 }}>{recordingStatus || '00:00'}</span>
            </button>
            <button className="chat-input-btn" onClick={handleCancelRecording} title="Annulla registrazione" style={{ color: 'var(--text-danger)' }}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="chat-input-actions">
            <button className="chat-input-btn" title="Allegato" onClick={() => handleSelectFile({ properties: ['openFile'] })}>
              <Paperclip size={18} strokeWidth={1.6} />
            </button>
            <button className="chat-input-btn" title="Immagine" onClick={() => handleSelectFile({ properties: ['openFile'], filters: [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] })}>
              <Image size={18} strokeWidth={1.6} />
            </button>
            <button
              className="chat-input-btn"
              title="Audio"
              onClick={handleStartRecording}
            >
              <Mic size={18} strokeWidth={1.6} />
            </button>
          </div>
        )}
        <div className="chat-input-main">
          {selectedFiles.map((file, idx) => (
            <div className="chat-file-chip" key={`${file.path}-${idx}`}>
              <div className="chat-file-chip__icon">
                {file.isImage
                  ? <Image size={14} strokeWidth={2} />
                  : <Paperclip size={14} strokeWidth={2} />}
              </div>
              <span className="chat-file-chip__name">
                {file.name.length > 30 ? file.name.slice(0, 28) + '…' : file.name}
              </span>
              {file.size ? <span className="chat-file-chip__size">{formatBytes(file.size)}</span> : null}
              <button className="chat-file-chip__remove" type="button" title="Rimuovi" onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}>
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          ))}
          <div className="chat-input-wrapper">
            {mentionActive && mentionSuggestions.length > 0 && (
              <MentionSuggestions
                suggestions={mentionSuggestions}
                activeIndex={mentionIndex}
                onSelect={insertMention}
              />
            )}
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="Scrivi un messaggio..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />
          </div>
        </div>
        <button className="chat-input-btn" title="Programma invio" onClick={() => setShowSchedule(true)}><Clock size={18} strokeWidth={1.6} /></button>
        <button className="chat-send-btn" onClick={handleSend} title="Invia">
          <Send size={18} strokeWidth={1.6} />
        </button>
      </div>

      {taskPopover && (
        <MessageToTask
          message={taskPopover.message}
          anchorRect={taskPopover.rect}
          onClose={() => setTaskPopover(null)}
          onCreated={() => setTaskPopover(null)}
        />
      )}

      {showForwardModal && (
        <ForwardModal
          waSerializedId={showForwardModal.waSerializedId}
          accountId={accountId}
          onClose={() => setShowForwardModal(null)}
        />
      )}

      {showSchedule && (
        <ScheduleMessageModal
          accountId={accountId}
          initialContact={contact}
          onClose={() => setShowSchedule(false)}
          onSaved={() => setShowSchedule(false)}
        />
      )}

      {/* Modal Anteprima Immagine */}
      {previewImage && (
        <div className="modal-overlay" style={{ zIndex: 2000, background: 'rgba(0,0,0,0.9)' }} onClick={() => setPreviewImage(null)}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={previewImage} alt="Preview" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }} />
            <button 
              onClick={() => setPreviewImage(null)}
              style={{ position: 'absolute', top: -40, right: 0, color: 'white', background: 'none', border: 'none', fontSize: 24, cursor: 'pointer' }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  )
}
