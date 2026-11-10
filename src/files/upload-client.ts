import { readFileSync } from 'node:fs';

/**
 * HW #26: the "browser". Demos run it as a separate process whose environment
 * holds nothing but PATH — no storage keys, no database — so whatever it gets
 * into storage got there through a presigned URL alone.
 *
 * stdin JSON:
 *   { "url", "file", "contentType" }                    → PUT the file, print put=<status>
 *   { "parts": [...], "partSize", "file", "crashAfter" } → upload these parts
 *   { "base", "token", "fileId", "file", "crashAfter" }  → ask the API which parts are
 *                                                          missing (ListParts), upload those
 * Prints uploaded=<n>. crashAfter=N dies with exit 3 after N parts: a lost connection.
 */
interface Part {
  partNumber: number;
  url: string;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const file = readFileSync(input.file);

  if (input.url) {
    const res = await fetch(input.url, { method: 'PUT', body: file, headers: { 'content-type': input.contentType } });
    console.log(`put=${res.status}`);
    return;
  }

  let parts: Part[] = input.parts;
  let partSize: number = input.partSize;
  if (!parts) {
    const res = await fetch(`${input.base}/uploads/parts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.token}` },
      body: JSON.stringify({ fileId: input.fileId }),
    });
    if (res.status !== 200) throw new Error(`/uploads/parts answered ${res.status}`);
    ({ parts, partSize } = await res.json());
  }

  let uploaded = 0;
  for (const { partNumber, url } of parts) {
    if (input.crashAfter !== undefined && uploaded === input.crashAfter) {
      console.log(`uploaded=${uploaded} (crash)`);
      process.exit(3);
    }
    const body = file.subarray((partNumber - 1) * partSize, partNumber * partSize);
    const res = await fetch(url, { method: 'PUT', body });
    if (res.status !== 200) throw new Error(`part ${partNumber}: ${res.status}`);
    uploaded++;
  }
  console.log(`uploaded=${uploaded}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
