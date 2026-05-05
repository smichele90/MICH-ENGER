import React, { useState, useEffect, useRef } from 'react'
import { Send, Paperclip, Image, Mic, Clock, CheckSquare, User, Users, DownloadCloud, FolderPlus } from 'lucide-react'
import MessageToTask from './MessageToTask'
import ScheduleMessageModal from './ScheduleMessageModal'
import MediaPreview from './MediaPreview'
import MessageBody from './MessageBody'
import AvatarImage from './AvatarImage'

export default function ChatView({ contact, accountId }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskPopover, setTaskPopover] = useState(null) // { message, rect }
  const [showSchedule, setShowSchedule] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [downloadingMedia, setDownloadingMedia] = useState(new Set())
  const [selectedFile, setSelectedFile] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState('')
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const recordingCanceledRef = useRef(false)
  const recordingTimerRef = useRef(null)

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
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folders, setFolders] = useState([])
  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)

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
    }
    load()

    const removeMsgListener = window.api.onWhatsAppEvent('wa:message', ({ accountId: msgAccountId, message }) => {
      if (msgAccountId === accountId && message.contact_id === contact.id) {
        setMessages(prev => {
          if (prev.some(m => m.wa_message_id === message.wa_message_id)) return prev
          return [...prev, message]
        })
      }
    })

    const removeHistoryListener = window.api.onWhatsAppEvent('wa:history-synced', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) load()
    })

    return () => {
      removeMsgListener?.()
      removeHistoryListener?.()
    }
  }, [contact?.id, accountId])

  // Scroll in fondo
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const handleInputChange = (e) => {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    }
  }

  // Invia messaggio
  const handleSend = async () => {
    if (!input.trim() && !selectedFile) return

    try {
      if (selectedFile) {
        await sendMediaMessage({ mediaPath: selectedFile.path })
        setSelectedFile(null)
      } else {
        await window.api.sendMessage(accountId, contact.id, input.trim())
        setInput('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      console.error('Errore invio:', err)
      alert('Errore invio messaggio: riprova tra qualche istante.')
    }
  }

  const handleKeyDown = (e) => {
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

  const sendMediaMessage = async ({ mediaPath, mediaData, mediaMime, filename }) => {
    if (!contact?.id) return
    try {
      setLoading(true)
      await window.api.sendMessage(accountId, contact.id, input.trim() || '', {
        caption: input.trim() || undefined,
        mediaPath,
        mediaData,
        mediaMime,
        filename
      })
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch (err) {
      console.error('Errore invio media:', err)
      alert('Errore invio allegato: riprova tra qualche istante.')
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
      const result = await window.api.selectFile(options)
      if (result?.canceled || !result?.filePaths?.length) return
      const filePath = result.filePaths[0]
      const info = await window.api.getFileInfo(filePath)
      setSelectedFile({
        path: filePath,
        name: getFileName(filePath),
        isImage: isImageFile(filePath),
        size: info?.size ?? null,
        mime: info?.mime ?? null
      })
    } catch (err) {
      console.error('Errore selezione file:', err)
      alert('Impossibile selezionare il file.')
    }
  }

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
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
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const base64 = await getBase64FromBlob(blob)
        await sendMediaMessage({
          mediaData: base64,
          mediaMime: blob.type,
          filename: `audio-${Date.now()}.webm`
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
      alert('Impossibile avviare la registrazione audio.')
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
            <div className="main-header__name">{contact.name || contact.push_name || contact.phone_number}</div>
            <div className="main-header__status">
              {contact.is_group ? 'Gruppo' : contact.phone_number || 'Contatto'}
            </div>
          </div>
        </div>
        <div className="main-header__actions" style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="btn--icon" 
            onClick={async () => {
              if (window.confirm(`Vuoi scaricare TUTTA la cronologia di ${contact.name || contact.phone_number}? Potrebbe richiedere del tempo.`)) {
                setLoading(true)
                const res = await window.api.syncChatHistory(accountId, contact.id)
                if (!res || !res.success) alert('Errore: ' + (res?.error || 'Sconosciuto'))
                setLoading(false)
              }
            }}
            title="Scarica cronologia completa"
          >
            <DownloadCloud size={18} />
          </button>
          <div style={{ position: 'relative' }}>
            <button 
              className="btn--icon" 
              title="Aggiungi a Cartella"
              onClick={async () => {
                const f = await window.api.getFolders();
                setFolders(f);
                setShowFolderModal(!showFolderModal);
              }}
            >
              <FolderPlus size={18} />
            </button>
            {showFolderModal && (
              <div style={{ position: 'absolute', right: 0, top: 30, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, zIndex: 100, minWidth: 150, boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, padding: '0 8px' }}>SELEZIONA CARTELLA</div>
                {folders.length === 0 ? (
                  <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-muted)' }}>Nessuna cartella</div>
                ) : (
                  folders.map(f => (
                    <button
                      key={f.id}
                      onClick={async () => {
                        const ok = await window.api.addFolderMember(f.id, contact.id);
                        setShowFolderModal(false);
                        if (ok === false) alert(`${contact.name || 'Contatto'} è già in "${f.name}".`);
                        else alert(`Aggiunto a "${f.name}".`);
                      }}
                      style={{ width: '100%', textAlign: 'left', padding: '6px 8px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: 4, fontSize: 13 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      📁 {f.name}
                    </button>
                  ))
                )}
              </div>
            )}
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

          return (
            <React.Fragment key={msg.id}>
              {showDateSep && (
                <div style={{ textAlign: 'center', margin: '16px 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ background: 'var(--bg-card)', padding: '4px 14px', borderRadius: 12 }}>{msgDate}</span>
                </div>
              )}
              <div className={`message ${msg.is_from_me ? 'message--me' : 'message--other'}`}>
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
                  <div className="message__actions">
                    <button
                      className="message__action-btn"
                      title="Converti in Task"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTaskPopover({ message: msg, rect })
                      }}
                    >
                      <CheckSquare size={14} />
                    </button>
                  </div>
                </div>
                <div className="message__time">
                  {msg.sender_name && <span style={{ marginRight: 6, fontWeight: 600, color: 'var(--accent)' }}>{msg.sender_name}</span>}
                  {formatTime(msg.timestamp)}
                </div>
              </div>
            </React.Fragment>
          )
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input messaggio */}
      <div className="chat-input-area">
        <div className="chat-input-actions">
          <button className="chat-input-btn" title="Allegato" onClick={() => handleSelectFile({ properties: ['openFile'] })}>
            <Paperclip size={18} />
          </button>
          <button className="chat-input-btn" title="Immagine" onClick={() => handleSelectFile({ properties: ['openFile'], filters: [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] })}>
            <Image size={18} />
          </button>
          <button
            className="chat-input-btn"
            title={recording ? 'Ferma registrazione' : 'Audio'}
            onClick={recording ? handleStopRecording : handleStartRecording}
            style={recording ? { color: 'var(--accent)' } : undefined}
          >
            <Mic size={18} />
          </button>
        </div>
        {selectedFile && (
          <div className="chat-file-preview">
            {selectedFile.isImage ? (
              <img className="chat-file-preview__thumb" src={getSafeFileUrl(selectedFile.path)} alt={selectedFile.name} />
            ) : (
              <div className="chat-file-preview__thumb chat-file-preview__thumb--file">📎</div>
            )}
            <div className="chat-file-preview__info">
              <div>
                <div className="chat-file-preview__name">{selectedFile.name}</div>
                <div className="chat-file-preview__meta">
                  {selectedFile.mime ? `${selectedFile.mime}` : 'Tipo sconosciuto'}
                  {selectedFile.size ? ` · ${formatBytes(selectedFile.size)}` : ''}
                </div>
              </div>
              <button className="btn btn--ghost" type="button" onClick={() => setSelectedFile(null)}>Rimuovi</button>
            </div>
          </div>
        )}
      {recording && (
        <div className="chat-recording-indicator" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', color: 'var(--accent)', fontSize: 13 }}>
          <span>Registrazione in corso</span>
          <span>{recordingStatus}</span>
          <button className="chat-input-btn" title="Annulla" onClick={handleCancelRecording} style={{ color: 'var(--text-danger)' }}>✕</button>
        </div>
      )}
        <div className="chat-input-wrapper">
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
        <button className="chat-input-btn" title="Programma invio" onClick={() => setShowSchedule(true)}><Clock size={18} /></button>
        <button className="chat-send-btn" onClick={handleSend} title="Invia">
          <Send size={18} />
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
