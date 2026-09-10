import { describe, expect, it, vi } from "vitest";
import { readNdjson } from "@/lib/ndjson";

/** A body that hands back exactly these chunks, so a test can put the split
 *  anywhere it likes, including mid-line and mid-multi-byte-character. */
function bodyOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) =>
    typeof c === "string" ? encoder.encode(c) : c,
  );
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < queue.length) controller.enqueue(queue[i++]);
      else controller.close();
    },
  });
}

async function collect<T>(
  chunks: (string | Uint8Array)[],
  onChunk?: () => void,
): Promise<T[]> {
  const out: T[] = [];
  for await (const evt of readNdjson<T>(bodyOf(chunks), onChunk)) out.push(evt);
  return out;
}

describe("readNdjson", () => {
  it("yields one event per line", async () => {
    expect(
      await collect([`{"type":"start"}\n{"type":"done"}\n`]),
    ).toEqual([{ type: "start" }, { type: "done" }]);
  });

  // The whole reason this is one function and not three copies: the network
  // decides where a chunk ends, and it is usually not at a newline.
  it("holds a line split across chunks until it is complete", async () => {
    expect(await collect([`{"type":"sta`, `rt"}\n{"type":"done"}\n`])).toEqual([
      { type: "start" },
      { type: "done" },
    ]);
  });

  it("handles a chunk boundary falling exactly on the newline", async () => {
    expect(await collect([`{"a":1}`, `\n`, `{"a":2}\n`])).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  // Streaming decode matters for the same reason: a multi-byte character can
  // be cut in half by a chunk boundary, and decoding each chunk independently
  // would produce a replacement character inside otherwise valid JSON.
  it("reassembles a UTF-8 character split across chunks", async () => {
    const bytes = new TextEncoder().encode(`{"s":"café"}\n`);
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    expect(await collect([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([
      { s: "café" },
    ]);
  });

  it("skips blank lines rather than parsing them", async () => {
    expect(await collect([`{"a":1}\n\n   \n{"a":2}\n`])).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  // A writer that stops mid-line has not produced an event, and inventing one
  // would mean handing the caller a JSON.parse throw instead.
  it("drops a trailing line the stream never terminated", async () => {
    expect(await collect([`{"a":1}\n{"a":`])).toEqual([{ a: 1 }]);
  });

  it("reports every chunk to the watchdog, including ones with no full line", async () => {
    const onChunk = vi.fn();
    await collect([`{"a":`, `1}\n`, `{"a":2}\n`], onChunk);
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it("yields nothing for an empty body", async () => {
    expect(await collect([])).toEqual([]);
  });
});
