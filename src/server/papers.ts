/**
 * The paper library's server side: adding a learner's PDF (copy, convert,
 * store) and loading a paper session's papers for a turn.
 *
 * A paper is identified by the SHA-256 of its bytes, so adding the same PDF
 * twice returns the stored paper without converting it again. Conversion is
 * the notes import's local text extraction (convertPdf) — no model call, no
 * OCR: a PDF without any text is refused, and textless pages are recorded.
 */

import { createHash } from "node:crypto";
import { convertPdf, pdfMetadataTitle } from "../agent/subagents/pdf-ops.ts";
import type { SessionPaper } from "../agent/paper-context.ts";
import {
	estimatePaperTokens,
	isPaperId,
	MAX_PAPER_BYTES,
	MAX_PAPER_CONTEXT_SHARE,
	MAX_PAPER_PAGES,
	MAX_SESSION_PAPERS,
	type PaperPage,
	type PaperRecord,
} from "../core/contracts.ts";
import { stores } from "./stores.ts";

/** A refused upload, carrying the HTTP status the route answers with. */
export class PaperUploadError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
		this.name = "PaperUploadError";
	}
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const MAX_TITLE_CHARS = 200;

function clip(text: string): string {
	const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
	return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean;
}

/** The display file name: the last path segment, without control characters. */
export function paperFileName(raw: string): string {
	const base = raw.split(/[\\/]/).pop() ?? "";
	return clip(base) || "paper.pdf";
}

/** The paper's title from its first page: the first run of top-level
 *  headings (a title wrapped over two lines arrives as two headings). */
export function paperTitleFromPages(pages: readonly PaperPage[]): string | null {
	const first = pages.find((p) => p.text !== null);
	if (!first?.text) return null;
	const lines = first.text.split("\n").map((l) => l.trim()).filter(Boolean);
	const start = lines.findIndex((l) => /^# \S/.test(l));
	if (start < 0) return null;
	const run: string[] = [];
	for (let i = start; i < lines.length && /^# \S/.test(lines[i]!); i++) run.push(lines[i]!.slice(2));
	return clip(run.join(" ")) || null;
}

/** Store a learner's PDF in the paper library (or return the stored copy). */
export async function addPaper(bytes: Uint8Array, rawFileName: string): Promise<PaperRecord> {
	if (bytes.length === 0) throw new PaperUploadError("The file is empty.", 400);
	if (bytes.length > MAX_PAPER_BYTES) throw new PaperUploadError("Too big. Papers can be at most 25 MB.", 413);
	if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) throw new PaperUploadError("Not a PDF.", 415);
	const id = createHash("sha256").update(bytes).digest("hex");
	const existing = stores.paperStore.getPaper(id);
	if (existing) return existing;
	// pdfjs may take ownership of the buffer it reads: hand it copies and keep
	// `bytes` intact for the stored copy.
	const conversion = await convertPdf(bytes.slice(), MAX_PAPER_PAGES);
	if (conversion.kind === "unreadable") {
		throw new PaperUploadError("Could not open this PDF. It may be damaged or password-protected.", 422);
	}
	if (conversion.kind === "too-long") {
		throw new PaperUploadError(`Too long: ${conversion.pageCount} pages. Papers can have at most ${MAX_PAPER_PAGES} pages.`, 413);
	}
	const pages: PaperPage[] = conversion.pages.map((p) => ({ number: p.number, text: p.kind === "text" ? p.markdown : null }));
	const textChars = pages.reduce((sum, p) => sum + (p.text?.length ?? 0), 0);
	if (textChars === 0) {
		throw new PaperUploadError("No text found in this PDF. Scanned papers need OCR, which isn't supported yet.", 422);
	}
	const fileName = paperFileName(rawFileName);
	const title = paperTitleFromPages(pages)
		?? (await pdfMetadataTitle(bytes.slice()).then((t) => (t ? clip(t) : null)))
		?? (clip(fileName.replace(/\.pdf$/i, "")) || "Untitled paper");
	const record: PaperRecord = {
		id,
		title,
		fileName,
		pageCount: pages.length,
		bytes: bytes.length,
		textlessPages: pages.filter((p) => p.text === null).map((p) => p.number),
		textChars,
		addedAt: new Date().toISOString(),
	};
	stores.paperStore.savePaper(record, bytes, pages);
	return record;
}

/** A new session's paper ids: 1–3 distinct ids of stored papers. */
export function resolveSessionPapers(ids: unknown): { ok: true; papers: PaperRecord[] } | { ok: false; error: string } {
	if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Add at least one paper." };
	if (ids.length > MAX_SESSION_PAPERS) return { ok: false, error: `A session can read at most ${MAX_SESSION_PAPERS} papers.` };
	if (new Set(ids).size !== ids.length) return { ok: false, error: "The same paper was added twice." };
	const papers: PaperRecord[] = [];
	for (const id of ids) {
		const paper = isPaperId(id) ? stores.paperStore.getPaper(id) : null;
		if (!paper) return { ok: false, error: "A paper could not be found. Add it again." };
		papers.push(paper);
	}
	return { ok: true, papers };
}

/** Why these papers can't fit the conversation model, or null when they fit
 *  (or the model's context window is unknown). */
export function paperContextProblem(papers: readonly PaperRecord[], contextWindow: number | undefined): string | null {
	if (!contextWindow) return null;
	const tokens = estimatePaperTokens(papers.reduce((sum, p) => sum + p.textChars, 0));
	const budget = Math.floor(contextWindow * MAX_PAPER_CONTEXT_SHARE);
	if (tokens <= budget) return null;
	const k = (n: number) => `${Math.round(n / 1000)}k`;
	return `These papers are about ${k(tokens)} tokens, more than half of your model's ${k(contextWindow)}-token context. Remove a paper or choose a model with a larger context.`;
}

/** Load a paper session's papers for a turn; null when any is missing. */
export function loadSessionPapers(ids: readonly string[]): SessionPaper[] | null {
	const out: SessionPaper[] = [];
	for (const [i, id] of ids.entries()) {
		const record = stores.paperStore.getPaper(id);
		const pages = stores.paperStore.readPages(id);
		if (!record || !pages) return null;
		out.push({ index: i + 1, record, pages, pdfPath: stores.paperStore.pdfPath(id) });
	}
	return out;
}
