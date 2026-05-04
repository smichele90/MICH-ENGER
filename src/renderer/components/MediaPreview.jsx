import React, { useState } from 'react'
import { Download, Play, Pause, FileText, FileImage, FileVideo, FileAudio, File as FileIcon, Image as ImageIcon, Video as VideoIcon } from 'lucide-react'

/**
 * Anteprima media in chat, stile WhatsApp Web:
 *  - Immagine: thumb dimensionato (default 320x240) cliccabile per fullscreen.
 *    Se manca media_path: usa media_thumb (base64 micro-thumb) come placeholder
 *    sfocato + bottone "Scarica originale".
 *  - Sticker: 140x140.
 *  - Video: thumb + overlay play, click per scaricare/aprire.
 *  - Audio (vocale o file): player audio nativo se scaricato; altrimenti
 *    barra placeholder con durata + bottone download.
 *  - Documento: card con icona, filename, dimensione, click per
 *    aprire/scaricare.
 */
export default function MediaPreview({ msg, downloading, onDownload, onPreviewImage, onOpenFile }) {
  const t = (msg.media_type || '').toLowerCase()

  if (t === 'image') return <ImagePreview msg={msg} downloading={downloading} onDownload={onDownload} onPreviewImage={onPreviewImage} />
  if (t === 'sticker') return <StickerPreview msg={msg} downloading={downloading} onDownload={onDownload} />
  if (t === 'video') return <VideoPreview msg={msg} downloading={downloading} onDownload={onDownload} onOpenFile={onOpenFile} />
  if (t === 'ptt' || t === 'audio') return <AudioPreview msg={msg} downloading={downloading} onDownload={onDownload} />
  if (t === 'document') return <DocumentPreview msg={msg} downloading={downloading} onDownload={onDownload} onOpenFile={onOpenFile} />
  // Fallback per location, vcard, ecc.
  return <GenericPreview msg={msg} downloading={downloading} onDownload={onDownload} onOpenFile={onOpenFile} />
}

// ---------- IMAGE ----------

function ImagePreview({ msg, downloading, onDownload, onPreviewImage }) {
  const fileUrl = msg.media_path ? `file:///${msg.media_path.replace(/\\/g, '/')}` : null
  const ratio = msg.media_width && msg.media_height ? msg.media_height / msg.media_width : 0.75
  const W = 320, H = Math.min(360, Math.max(120, W * ratio))

  return (
    <div style={{
      width: W, height: H, borderRadius: 8, overflow: 'hidden',
      background: 'rgba(0,0,0,0.15)', position: 'relative', marginBottom: 4,
      cursor: fileUrl ? 'pointer' : 'default'
    }}
      onClick={() => fileUrl ? onPreviewImage(fileUrl) : (!downloading && onDownload(msg.id))}
    >
      {/* Thumb base64 sempre come sfondo (compare istantaneamente) */}
      {msg.media_thumb && (
        <img src={msg.media_thumb} alt=""
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            filter: fileUrl ? 'none' : 'blur(8px)',
            position: 'absolute', inset: 0
          }} />
      )}
      {/* Immagine full quality sopra */}
      {fileUrl && (
        <img src={fileUrl} alt="" style={{
          width: '100%', height: '100%', objectFit: 'cover',
          position: 'absolute', inset: 0
        }} />
      )}
      {/* Overlay download */}
      {!fileUrl && (
        <div style={overlayBox}>
          {downloading ? (
            <span style={{ fontSize: 12 }}>⏳ Scarico…</span>
          ) : (
            <>
              <Download size={28} color="white" />
              <span style={{ fontSize: 12, color: 'white' }}>
                {msg.media_size ? formatSize(msg.media_size) : 'Scarica'}
              </span>
            </>
          )}
        </div>
      )}
      {/* Placeholder se non c'è né thumb né file */}
      {!msg.media_thumb && !fileUrl && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)' }}>
          <ImageIcon size={48} />
        </div>
      )}
    </div>
  )
}

// ---------- STICKER ----------

function StickerPreview({ msg, downloading, onDownload }) {
  const fileUrl = msg.media_path ? `file:///${msg.media_path.replace(/\\/g, '/')}` : null
  if (fileUrl) return <img src={fileUrl} alt="sticker" style={{ width: 140, height: 140, display: 'block' }} />
  if (msg.media_thumb) return <img src={msg.media_thumb} alt="sticker" style={{ width: 140, height: 140, display: 'block', cursor: 'pointer' }} onClick={() => onDownload(msg.id)} />
  return <button onClick={() => onDownload(msg.id)} disabled={downloading} style={{ ...placeholderBtn, width: 140, height: 140 }}>
    {downloading ? '⏳' : <Download size={20} />}
  </button>
}

// ---------- VIDEO ----------

function VideoPreview({ msg, downloading, onDownload, onOpenFile }) {
  const fileUrl = msg.media_path ? `file:///${msg.media_path.replace(/\\/g, '/')}` : null
  const ratio = msg.media_width && msg.media_height ? msg.media_height / msg.media_width : 0.5625
  const W = 320, H = Math.min(360, Math.max(140, W * ratio))

  return (
    <div style={{
      width: W, height: H, borderRadius: 8, overflow: 'hidden',
      background: '#000', position: 'relative', marginBottom: 4
    }}>
      {fileUrl ? (
        <video src={fileUrl} controls style={{ width: '100%', height: '100%' }} />
      ) : (
        <div onClick={() => !downloading && onDownload(msg.id)} style={{
          width: '100%', height: '100%', position: 'relative', cursor: 'pointer'
        }}>
          {msg.media_thumb && (
            <img src={msg.media_thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.7)' }} />
          )}
          <div style={overlayBox}>
            {downloading ? (
              <span style={{ fontSize: 12 }}>⏳ Scarico…</span>
            ) : (
              <>
                <Play size={36} color="white" fill="white" />
                <span style={{ fontSize: 12, color: 'white' }}>
                  {msg.media_duration ? formatDuration(msg.media_duration) : ''}
                  {msg.media_size ? ` · ${formatSize(msg.media_size)}` : ''}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- AUDIO / VOICE NOTE ----------

function AudioPreview({ msg, downloading, onDownload }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = React.useRef(null)
  const fileUrl = msg.media_path ? `file:///${msg.media_path.replace(/\\/g, '/')}` : null
  const isVoiceNote = (msg.media_type || '').toLowerCase() === 'ptt'

  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play().then(() => setPlaying(true)).catch(() => {}) }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      background: 'rgba(0,0,0,0.1)', borderRadius: 12, minWidth: 240,
      marginBottom: 4
    }}>
      <button
        onClick={() => fileUrl ? togglePlay() : onDownload(msg.id)}
        disabled={downloading}
        style={{
          width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)',
          border: 'none', color: 'white', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', flexShrink: 0
        }}
      >
        {downloading ? '⏳' : fileUrl ? (playing ? <Pause size={16} /> : <Play size={16} />) : <Download size={16} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, marginBottom: 4 }}>
          {/* Barra "fake" — riempita progressivamente quando in play */}
          {fileUrl && playing && <div style={{ height: '100%', width: '50%', background: 'var(--accent)', borderRadius: 2 }} />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {isVoiceNote ? '🎙 Vocale' : '🎵 Audio'}
          {msg.media_duration ? ` · ${formatDuration(msg.media_duration)}` : ''}
          {msg.media_size && !msg.media_duration ? ` · ${formatSize(msg.media_size)}` : ''}
        </div>
      </div>
      {fileUrl && (
        <audio ref={audioRef} src={fileUrl} onEnded={() => setPlaying(false)} preload="none" />
      )}
    </div>
  )
}

// ---------- DOCUMENT ----------

function DocumentPreview({ msg, downloading, onDownload, onOpenFile }) {
  const fileUrl = msg.media_path
  const ext = (msg.media_filename || '').split('.').pop()?.toUpperCase().slice(0, 4) || ''
  const Icon = pickFileIcon(msg.media_mime, msg.media_filename)

  return (
    <div
      onClick={() => fileUrl ? onOpenFile(fileUrl) : (!downloading && onDownload(msg.id))}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: 10,
        background: 'rgba(0,0,0,0.1)', borderRadius: 8, marginBottom: 4,
        cursor: 'pointer', minWidth: 240, maxWidth: 320
      }}
    >
      <div style={{
        width: 40, height: 48, background: 'rgba(255,255,255,0.1)', borderRadius: 4,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        <Icon size={20} />
        {ext && <span style={{ fontSize: 9, fontWeight: 700, marginTop: 2 }}>{ext}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {msg.media_filename || 'Documento'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {msg.media_size ? formatSize(msg.media_size) : (fileUrl ? 'Salvato' : 'Tocca per scaricare')}
          {!fileUrl && !downloading && <Download size={11} />}
          {downloading && <span>⏳</span>}
        </div>
      </div>
    </div>
  )
}

// ---------- GENERIC ----------

function GenericPreview({ msg, downloading, onDownload, onOpenFile }) {
  return (
    <div onClick={() => msg.media_path ? onOpenFile(msg.media_path) : onDownload(msg.id)}
      style={{ ...placeholderBtn, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <FileIcon size={14} />
      <span style={{ fontSize: 12 }}>
        {downloading ? 'Scarico…' : (msg.media_path ? (msg.media_filename || msg.media_type) : `Scarica ${msg.media_type}`)}
      </span>
    </div>
  )
}

// ---------- helpers ----------

function pickFileIcon(mime = '', filename = '') {
  const m = (mime || '').toLowerCase()
  const f = (filename || '').toLowerCase()
  if (m.startsWith('image/')) return FileImage
  if (m.startsWith('video/')) return FileVideo
  if (m.startsWith('audio/')) return FileAudio
  if (m.includes('pdf') || f.endsWith('.pdf')) return FileText
  if (m.includes('word') || f.endsWith('.docx') || f.endsWith('.doc')) return FileText
  if (m.includes('sheet') || f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')) return FileText
  return FileIcon
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(sec) {
  if (sec == null) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const overlayBox = {
  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 4,
  background: 'rgba(0,0,0,0.35)'
}

const placeholderBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.1)', border: 'none', borderRadius: 8,
  color: 'inherit', cursor: 'pointer', marginBottom: 4
}
