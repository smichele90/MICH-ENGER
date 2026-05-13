import React, { useState, useEffect } from 'react'

const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi

function trimTrailingPunctuation(url) {
  let end = url.length
  while (end > 0 && /[).,;:!?]/.test(url[end - 1])) end--
  return { core: url.slice(0, end), trailing: url.slice(end) }
}

function handleLinkClick(e, url) {
  e.preventDefault()
  e.stopPropagation()
  const full = url.startsWith('http') ? url : `https://${url}`
  window.api?.openExternal?.(full)
}

function renderUrls(text, keyPrefix) {
  if (!text) return text
  const out = []
  let lastIndex = 0
  let match
  let i = 0
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    const raw = match[0]
    const { core, trailing } = trimTrailingPunctuation(raw)
    if (!core) continue
    if (match.index > lastIndex) out.push(text.substring(lastIndex, match.index))
    out.push(
      <a
        key={`${keyPrefix}-url-${i++}-${match.index}`}
        href={core.startsWith('http') ? core : `https://${core}`}
        onClick={(e) => handleLinkClick(e, core)}
        style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
      >
        {core}
      </a>
    )
    if (trailing) out.push(trailing)
    lastIndex = match.index + raw.length
  }
  if (lastIndex < text.length) out.push(text.substring(lastIndex))
  return out.length > 0 ? out : text
}

/**
 * Renderizza il body di un messaggio con menzioni @numero risolte a nomi
 * e link cliccabili.
 */
export default function MessageBody({ body, accountId, isGroup }) {
  const [resolvedBody, setResolvedBody] = useState(null)

  useEffect(() => {
    if (!body) {
      setResolvedBody(null)
      return
    }

    if (!isGroup) {
      setResolvedBody(renderUrls(body, 'plain'))
      return
    }

    const mentionRegex = /@(\d{1,20})/g
    const phoneNumbers = new Set()
    let match
    while ((match = mentionRegex.exec(body)) !== null) {
      phoneNumbers.add(match[1])
    }

    if (phoneNumbers.size === 0) {
      setResolvedBody(renderUrls(body, 'grp'))
      return
    }

    async function resolve() {
      try {
        const numbersArray = Array.from(phoneNumbers)
        const map = await window.api.resolvePhoneNumbers(accountId, numbersArray)
        renderWithResolvedMentions(body, map)
      } catch (err) {
        console.error('Errore resolve phone numbers:', err)
        setResolvedBody(renderUrls(body, 'grp'))
      }
    }

    resolve()
  }, [body, accountId, isGroup])

  const renderWithResolvedMentions = (text, map) => {
    const parts = []
    const mentionRegex = /@(\d{1,20})/g
    let lastIndex = 0
    let match
    let i = 0

    while ((match = mentionRegex.exec(text)) !== null) {
      const phoneNum = match[1]
      const displayName = map[phoneNum] || phoneNum

      if (match.index > lastIndex) {
        const seg = text.substring(lastIndex, match.index)
        parts.push(
          <React.Fragment key={`seg-${i++}-${match.index}`}>{renderUrls(seg, `seg-${match.index}`)}</React.Fragment>
        )
      }

      parts.push(
        <span key={`mention-${match.index}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
          @{displayName}
        </span>
      )

      lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
      const tail = text.substring(lastIndex)
      parts.push(
        <React.Fragment key={`seg-tail-${i++}`}>{renderUrls(tail, 'tail')}</React.Fragment>
      )
    }

    setResolvedBody(parts.length > 0 ? parts : renderUrls(text, 'fallback'))
  }

  return <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{resolvedBody || body}</div>
}
