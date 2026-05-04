import React, { useState, useEffect } from 'react'

/**
 * Renderizza il body di un messaggio con menzioni @numero risolte a nomi
 * Estrae i numeri nel formato @123456789 e li sostituisce con i nomi dei contatti
 */
export default function MessageBody({ body, accountId, isGroup }) {
  const [resolvedBody, setResolvedBody] = useState(null)

  useEffect(() => {
    if (!body) {
      setResolvedBody(null)
      return
    }

    // Se non è un gruppo, renderizza il body così com'è
    if (!isGroup) {
      setResolvedBody(body)
      return
    }

    // Estrai tutti i phone_number dalle menzioni @numero
    const mentionRegex = /@(\d{1,20})/g
    const phoneNumbers = new Set()
    let match
    while ((match = mentionRegex.exec(body)) !== null) {
      phoneNumbers.add(match[1])
    }

    if (phoneNumbers.size === 0) {
      setResolvedBody(body)
      return
    }

    // Risolvi i phone_numbers a nomi
    async function resolve() {
      try {
        const numbersArray = Array.from(phoneNumbers)
        console.log('[MessageBody] Risolvendo numeri:', numbersArray)
        const map = await window.api.resolvePhoneNumbers(accountId, numbersArray)
        console.log('[MessageBody] Map risolto:', map)
        renderWithResolvedMentions(body, map)
      } catch (err) {
        console.error('Errore resolve phone numbers:', err)
        setResolvedBody(body)
      }
    }

    resolve()
  }, [body, accountId, isGroup])

  const renderWithResolvedMentions = (text, map) => {
    const parts = []
    const mentionRegex = /@(\d{1,20})/g
    let lastIndex = 0
    let match

    while ((match = mentionRegex.exec(text)) !== null) {
      const phoneNum = match[1]
      const displayName = map[phoneNum] || phoneNum

      // Testo prima della menzione
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }

      // Menzione risolta
      parts.push(
        <span key={`mention-${match.index}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
          @{displayName}
        </span>
      )

      lastIndex = match.index + match[0].length
    }

    // Testo rimanente
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }

    setResolvedBody(parts.length > 0 ? parts : text)
  }

  return <div style={{ wordBreak: 'break-word' }}>{resolvedBody || body}</div>
}
