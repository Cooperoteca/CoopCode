/** LF-only JSONL framing for the pi RPC stdout stream.
 *
 * We deliberately do NOT use `node:readline` here: readline splits on the Unicode
 * line/paragraph separators U+2028 and U+2029, which can legally appear *inside*
 * the JSON string values the pi CLI emits. Splitting only on an ASCII LF keeps a
 * single logical JSON record intact across arbitrary chunks.
 */

import type { Readable } from 'node:stream'

export type JsonlReader = {
  /** Detach every listener from the underlying stream. Safe to call more than once. */
  detach(): void
}

/** Reads an arbitrary byte stream and emits complete LF-terminated lines.
 *  The trailing `\r` of a CRLF line is stripped. An unterminated tail is flushed
 *  on stream end so the last record is delivered too. */
export function createJsonlReader(
  stream: Readable,
  onLine: (line: string) => void
): JsonlReader {
  let buffer = ''
  let detached = false

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      let line = buffer.slice(0, newline)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      onLine(line)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }

  const onEnd = (): void => {
    if (buffer.length > 0) {
      let line = buffer
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      onLine(line)
      buffer = ''
    }
  }

  stream.on('data', onData)
  stream.on('end', onEnd)
  stream.on('close', onEnd)

  return {
    detach() {
      if (detached) {
        return
      }
      detached = true
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('close', onEnd)
    },
  }
}

/** Best-effort JSON.parse that never throws and never takes down the reader. */
export function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim()
  if (trimmed === '') {
    return undefined
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}
