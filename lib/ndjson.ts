/**
 * An NDJSON response body as a stream of parsed events.
 *
 * Two lanes read NDJSON off the wire, the indicator fan-out and the research
 * lane, and both had grown their own copy of the same framing loop. The framing
 * is the whole subtlety: a chunk boundary falls wherever the network puts it,
 * so the last line of a chunk is usually a fragment and has to be held back
 * until the next chunk completes it. Getting that wrong shows up as a rare
 * JSON.parse throw under exactly the conditions that are hardest to reproduce,
 * which is a good reason for there to be one of it.
 *
 * Blank lines are skipped rather than parsed: a writer that ends its last line
 * with "\n" produces one, and it is not an event.
 */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  /** Called once per network chunk, before its lines are yielded. The check
   *  lane uses this to reset its stall watchdog; the research lane passes
   *  nothing. */
  onChunk?: () => void,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk?.();
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    // The tail is a fragment until a later chunk terminates it. split() always
    // returns at least one element, so there is always a tail to take.
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as T;
    }
  }
}
