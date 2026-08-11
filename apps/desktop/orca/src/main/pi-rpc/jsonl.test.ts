import { PassThrough } from 'node:stream'
import { describe, it, expect, vi } from 'vitest'
import { createJsonlReader, parseJsonLine } from './jsonl'

async function linesFrom(chunks: (string | Buffer)[]): Promise<string[]> {
  const stream = new PassThrough()
  const received: string[] = []
  createJsonlReader(stream, (line) => received.push(line))
  for (const chunk of chunks) {
    stream.write(chunk)
  }
  stream.end()
  // Why: 'data' events fire synchronously in flowing mode, but the 'end' event
  // (which flushes an unterminated tail) fires on the next tick. Await one so
  // the helper sees the fully-framed result.
  await new Promise<void>((resolve) => setImmediate(resolve))
  return received
}

describe('createJsonlReader', () => {
  it('joins a single JSON record split across two chunks', async () => {
    const received = await linesFrom(['{"type":"prompt"', ',"message":"hello"}\n'])
    expect(received).toEqual(['{"type":"prompt","message":"hello"}'])
  })

  it('keeps U+2028 / U+2029 inside a JSON string on one line', async () => {
    // readline would split on U+2028/U+2029; our LF-only reader must not.
    const record = JSON.stringify({ type: 'message_update', text: 'line\u2028break' })
    const received = await linesFrom([`${record}\n`])
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0])).toEqual({ type: 'message_update', text: 'line\u2028break' })
  })

  it('keeps a multi-byte character intact when it straddles a chunk boundary', async () => {
    // The real corruption risk: pi writes bytes, and a chunk can end mid-character.
    // Portuguese accents are 2 bytes and U+2028 is 3, so this is the common case,
    // not an edge case. Decoding per chunk yields U+FFFD and still parses as JSON.
    const text = `ação${String.fromCharCode(0x2028)}fim`
    const record = `${JSON.stringify({ text })}\n`
    const bytes = Buffer.from(record, 'utf8')
    const split = bytes.indexOf(0xc3) + 1 // inside the 2-byte 'ç'
    const received = await linesFrom([bytes.subarray(0, split), bytes.subarray(split)])
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0])).toEqual({ text })
  })

  it('strips a trailing CR from CRLF framing', async () => {
    expect(await linesFrom(['{"a":1}\r\n'])).toEqual(['{"a":1}'])
  })

  it('flushes an unterminated trailing line on close/end', async () => {
    expect(await linesFrom(['{"a":1}'])).toEqual(['{"a":1}'])
  })

  it('delivers multiple records from one chunk', async () => {
    expect(await linesFrom(['{"a":1}\n{"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('stops delivering once detached', () => {
    const stream = new PassThrough()
    const onLine = vi.fn()
    const reader = createJsonlReader(stream, onLine)
    reader.detach()
    stream.write('{"a":1}\n')
    expect(onLine).not.toHaveBeenCalled()
  })
})

describe('parseJsonLine', () => {
  it('parses a valid record', () => {
    expect(parseJsonLine('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns undefined for invalid JSON without throwing', () => {
    expect(() => parseJsonLine('not-json')).not.toThrow()
    expect(parseJsonLine('not-json')).toBeUndefined()
  })

  // Why-not-readline: confirms a corrupt / half-framed line never takes the
  // reader down and subsequent valid records still parse.
  it('keeps parsing valid records after an invalid one', () => {
    const stream = new PassThrough()
    const frames: unknown[] = []
    createJsonlReader(stream, (line) => {
      const parsed = parseJsonLine(line)
      if (parsed !== undefined) {
        frames.push(parsed)
      }
    })
    stream.write('garbage-not-json\n')
    stream.write('{"ok":true}\n')
    expect(frames).toEqual([{ ok: true }])
  })
})
