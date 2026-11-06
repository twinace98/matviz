/**
 * Byte-level line iteration utilities for parsing files that may exceed
 * V8's MAX_STRING_LENGTH (~512 MiB on x64). Used by the *FromBytes
 * volumetric parser variants (v0.22 Tier 2). A single yielded line is
 * still materialized as a JS string, so the helper is only safe for
 * formats where individual lines stay well under the string ceiling —
 * which is true for ASCII scientific volumetric formats (cube, XSF,
 * CHGCAR) where lines hold at most a handful of floats.
 */

/**
 * Yield UTF-8 decoded lines from a byte buffer. Handles `\n`, `\r\n`,
 * and bare `\r` line endings. The trailing partial line (no terminator)
 * is yielded last. BOM at start of buffer is stripped by TextDecoder.
 */
export function* iterLines(buf: Uint8Array): IterableIterator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0A) {
      const end = i > start && buf[i - 1] === 0x0D ? i - 1 : i;
      yield decoder.decode(buf.subarray(start, end));
      start = i + 1;
    } else if (b === 0x0D && (i + 1 === buf.length || buf[i + 1] !== 0x0A)) {
      yield decoder.decode(buf.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buf.length) {
    yield decoder.decode(buf.subarray(start));
  }
}

/** First occurrence of `needle` in `haystack` starting at `from`. -1 if not found. */
export function findBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0) return from;
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Return the byte offset of the start of the (1-indexed) N-th line after
 * `from`. Used to slice off a header portion of length-known line count.
 * Returns -1 if the buffer has fewer than N line terminators after `from`.
 */
export function offsetAfterLines(buf: Uint8Array, n: number, from = 0): number {
  let lines = 0;
  for (let i = from; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0A) {
      lines++;
      if (lines === n) return i + 1;
    } else if (b === 0x0D && (i + 1 === buf.length || buf[i + 1] !== 0x0A)) {
      // Bare \r (classic Mac line ending) — counts as a line terminator
      // for parity with iterLines.
      lines++;
      if (lines === n) return i + 1;
    }
  }
  return -1;
}

/**
 * Like `iterLines`, but also yields `next` = byte offset just past the line
 * terminator, so a caller can jump into the buffer at a known line boundary
 * (v0.23.1: XSF endpoint probe before streaming the grid).
 */
export function* iterLineSpans(buf: Uint8Array): IterableIterator<{ line: string; next: number }> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0A) {
      const end = i > start && buf[i - 1] === 0x0D ? i - 1 : i;
      yield { line: decoder.decode(buf.subarray(start, end)), next: i + 1 };
      start = i + 1;
    } else if (b === 0x0D && (i + 1 === buf.length || buf[i + 1] !== 0x0A)) {
      yield { line: decoder.decode(buf.subarray(start, i)), next: i + 1 };
      start = i + 1;
    }
  }
  if (start < buf.length) {
    yield { line: decoder.decode(buf.subarray(start)), next: buf.length };
  }
}

const isLineBreak = (b: number) => b === 0x0A || b === 0x0D;

/** First `count` whitespace-separated numbers at or after `from`. */
export function firstNumbers(buf: Uint8Array, from: number, count: number): Float64Array {
  const out = new Float64Array(count);
  let n = 0, pos = from;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  while (n < count && pos < buf.length) {
    let end = Math.min(buf.length, pos + (1 << 20));
    while (end < buf.length && !isLineBreak(buf[end])) end++;  // whole lines only
    for (const t of decoder.decode(buf.subarray(pos, end)).split(/\s+/)) {
      if (t === '') continue;
      if (n >= count) break;
      out[n++] = parseFloat(t);
    }
    pos = end;
  }
  return n === count ? out : out.subarray(0, n);
}

/**
 * Last `count` whitespace-separated numbers strictly before `end` (e.g. the
 * offset of an `END_DATAGRID_3D` marker), in file order.
 */
export function lastNumbersBefore(buf: Uint8Array, end: number, count: number): Float64Array {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let span = 1 << 16;
  for (;;) {
    let start = Math.max(0, end - span);
    while (start > 0 && !isLineBreak(buf[start - 1])) start--;  // whole lines only
    const toks = decoder.decode(buf.subarray(start, end)).split(/\s+/).filter(t => t !== '');
    if (toks.length >= count || start === 0) {
      const tail = toks.slice(Math.max(0, toks.length - count));
      return Float64Array.from(tail, t => parseFloat(t));
    }
    span *= 2;
  }
}
