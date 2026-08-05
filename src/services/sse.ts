// ============================================
// Server-Sent Events (SSE) reader
// ============================================
// Reads an SSE streaming HTTP response and invokes `onData` with each `data:`
// payload (the raw string after "data:"). Stops on "[DONE]". Used by the
// streaming Gemini / OpenAI translation calls.

export async function readSSE(
  response: Response,
  onData: (data: string) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitLine = (line: string) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    onData(data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep the (possibly incomplete) last line
    for (const line of lines) emitLine(line);
  }
  // Flush any trailing complete line.
  if (buffer) emitLine(buffer);
}
