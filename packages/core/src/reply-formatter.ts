/**
 * Reply formatting — long message splitting for WeChat.
 *
 * WeChat has a ~4096 byte display limit per message.
 * We split at paragraph boundaries, then sentence boundaries.
 */

const MAX_CHARS = 2000; // conservative limit (Chinese chars = 3 bytes each)

/** Split a long reply into sendable chunks. */
export function splitReply(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_CHARS) {
      if (current) chunks.push(current.trim());
      // If single paragraph exceeds limit, split by sentences
      if (para.length > MAX_CHARS) {
        chunks.push(...splitBySentence(para));
        current = "";
      } else {
        current = para;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.length > 0 ? chunks : [text.slice(0, MAX_CHARS)];
}

function splitBySentence(text: string): string[] {
  const sentences = text.split(/(?<=[。！？\.\!\?])\s*/);
  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    if (current.length + s.length > MAX_CHARS) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
