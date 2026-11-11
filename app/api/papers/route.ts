/**
 * POST /api/papers — add one PDF to the paper library (paper sessions).
 *
 * The body is the raw PDF (Content-Type: application/pdf); the original
 * file name rides the X-Paper-Name header, URI-encoded. The server keeps its
 * own copy (data/papers/<sha256>/), converts its text locally, and answers
 * with the stored PaperRecord. The same PDF twice returns the stored paper.
 *
 *   200 → { paper: PaperRecord }
 *   4xx → { error: string } (empty, too big, not a PDF, unreadable, too
 *         long, no text)
 *
 * Works from the browser and the desktop app alike: the file's bytes are
 * uploaded, never its local path.
 */
import { addPaper, PaperUploadError } from "@/src/server";
import { MAX_PAPER_BYTES } from "@/src/core";

export const dynamic = "force-dynamic";

const TOO_BIG = "Too big. Papers can be at most 25 MB.";

class BodyLimitError extends Error {}

/** The whole body, refused as soon as it passes the cap. */
async function readCappedBody(request: Request): Promise<Uint8Array> {
	if (Number(request.headers.get("content-length")) > MAX_PAPER_BYTES) {
		void request.body?.cancel().catch(() => undefined);
		throw new BodyLimitError();
	}
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_PAPER_BYTES) throw new BodyLimitError();
			chunks.push(value);
		}
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function fileNameHeader(request: Request): string {
	const raw = request.headers.get("x-paper-name") ?? "";
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

export async function POST(request: Request) {
	let bytes: Uint8Array;
	try {
		bytes = await readCappedBody(request);
	} catch (err) {
		if (err instanceof BodyLimitError) return Response.json({ error: TOO_BIG }, { status: 413 });
		return Response.json({ error: "Could not read the upload. Please add the file again." }, { status: 400 });
	}
	try {
		const paper = await addPaper(bytes, fileNameHeader(request));
		return Response.json({ paper });
	} catch (err) {
		if (err instanceof PaperUploadError) return Response.json({ error: err.message }, { status: err.status });
		console.error("[papers] add failed:", err);
		return Response.json({ error: "Could not add this paper." }, { status: 500 });
	}
}
