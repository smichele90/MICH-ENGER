import React, { useState, useEffect, useRef } from 'react'
import { X, RefreshCw, CheckCircle2 } from 'lucide-react'
import QRCode from 'qrcode'

export default function QRCodeModal({ onClose, onConnected }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [status, setStatus] = useState('loading') // loading, qr, connecting, ready, error
  const [error, setError] = useState(null)
  const initialized = useRef(false)
  const tempAccountIdRef = useRef(null)
  const isReadyRef = useRef(false)
  const onConnectedRef = useRef(onConnected)
  useEffect(() => { onConnectedRef.current = onConnected }, [onConnected])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    let cancelled = false

    // Timeout: se dopo 120 secondi lo status è ancora loading/connecting, mostra errore
    const timeoutId = setTimeout(() => {
      if (!cancelled && !isReadyRef.current) {
        setError('Timeout: WhatsApp non ha generato il QR code. Riprova.')
        setStatus('error')
      }
    }, 120_000)

    const initPairing = async () => {
      try {
        const result = await window.api.createAccount({ name: 'Nuovo Account', phone_number: '' })
        if (cancelled) return
        tempAccountIdRef.current = result.id
        console.log('[QRModal] Account creato, id:', result.id)
        const ok = await window.api.initializeWhatsApp(result.id)
        console.log('[QRModal] initializeWhatsApp completato, ok:', ok)
        if (!cancelled && !ok && !isReadyRef.current) {
          setError('Inizializzazione WhatsApp non riuscita. Riprova.')
          setStatus('error')
        }
      } catch (err) {
        if (!cancelled) {
          setError('Errore durante l\'inizializzazione: ' + err.message)
          setStatus('error')
        }
      }
    }

    initPairing()

    const removeQrListener = window.api.onWhatsAppEvent('wa:qr', async ({ accountId: qrAccId, qr }) => {
      console.log('[QRModal] wa:qr account:', qrAccId, 'atteso:', tempAccountIdRef.current)
      if (qrAccId !== tempAccountIdRef.current) return
      try {
        const url = await QRCode.toDataURL(qr)
        if (!cancelled) { setQrDataUrl(url); setStatus('qr') }
      } catch (e) {
        console.error('[QRModal] QRCode.toDataURL fallito:', e)
        if (!cancelled) { setError('Errore generazione QR: ' + e.message); setStatus('error') }
      }
    })

    const removeReadyListener = window.api.onWhatsAppEvent('wa:ready', async ({ accountId }) => {
      console.log('[QRModal] wa:ready account:', accountId, 'atteso:', tempAccountIdRef.current)
      if (cancelled || accountId !== tempAccountIdRef.current) return
      isReadyRef.current = true
      setStatus('ready')
      const accounts = await window.api.getAccounts()
      const newAccount = accounts.find(a => a.id === accountId)
      setTimeout(() => onConnectedRef.current?.(newAccount), 1500)
    })

    const removeLoadingListener = window.api.onWhatsAppEvent('wa:loading', ({ accountId: ldAccId }) => {
      if (!cancelled && ldAccId === tempAccountIdRef.current) setStatus(s => (s === 'qr' ? s : 'connecting'))
    })

    const removeErrorListener = window.api.onWhatsAppEvent('wa:error', ({ accountId: errId, error: errMsg }) => {
      console.log('[QRModal] wa:error account:', errId, 'atteso:', tempAccountIdRef.current)
      if (!cancelled && errId === tempAccountIdRef.current) {
        setError('Errore WhatsApp: ' + errMsg)
        setStatus('error')
      }
    })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      removeQrListener?.()
      removeReadyListener?.()
      removeLoadingListener?.()
      removeErrorListener?.()
      if (!isReadyRef.current && tempAccountIdRef.current) {
        window.api.destroyWhatsApp(tempAccountIdRef.current).catch(() => {})
        window.api.deleteAccount(tempAccountIdRef.current).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 400, textAlign: 'center' }}>
        <div className="modal__header">
          <span className="modal__title">Collega WhatsApp</span>
          <button className="btn--icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ padding: '20px 0' }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <RefreshCw className="animate-spin" size={48} color="var(--accent)" />
              <p style={{ color: 'var(--text-secondary)' }}>Inizializzazione sessione...</p>
            </div>
          )}

          {status === 'qr' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
              <div style={{ background: 'white', padding: 16, borderRadius: 12 }}>
                <img src={qrDataUrl} alt="WhatsApp QR Code" style={{ width: 240, height: 240 }} />
              </div>
              <div style={{ textAlign: 'left', width: '100%' }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Istruzioni:</p>
                <ol style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 1.6 }}>
                  <li>Apri WhatsApp sul tuo telefono</li>
                  <li>Tocca Menu o Impostazioni e seleziona Dispositivi collegati</li>
                  <li>Tocca Collega un dispositivo</li>
                  <li>Inquadra questo codice QR per accedere</li>
                </ol>
              </div>
            </div>
          )}

          {status === 'connecting' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <RefreshCw className="animate-spin" size={48} color="var(--accent)" />
              <p style={{ color: 'var(--text-secondary)' }}>Connessione a WhatsApp in corso...</p>
            </div>
          )}

          {status === 'ready' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <CheckCircle2 size={64} color="var(--success)" />
              <p style={{ fontSize: 18, fontWeight: 600 }}>Dispositivo Collegato!</p>
              <p style={{ color: 'var(--text-secondary)' }}>Sincronizzazione dei contatti in corso...</p>
            </div>
          )}

          {status === 'error' && (
            <div style={{ color: 'var(--danger)' }}>
              <p>{error}</p>
              <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>Riprova</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
