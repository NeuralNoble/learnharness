/**
 * Paper sessions — the paper library's records and limits.
 *
 * A paper session (ChatKind "paper") teaches one to three PDFs the learner
 * added. Each PDF is COPIED into the app's paper library (data/papers/<id>/)
 * when added, so a session never depends on where the original file lives.
 * The id is the SHA-256 of the PDF bytes: adding the same paper twice reuses
 * the stored copy and its converted text.
 *
 * The whole page text of every session paper rides the conversation agents'
 * system prompt (src/agent/paper-context.ts), so the limits below bound what
 * one session can hold. Pure types + constants.
 */

/** At most this many papers in one session. */
export const MAX_SESSION_PAPERS = 3;

/** Largest PDF the library accepts (bytes). Matches the import cap. */
export const MAX_PAPER_BYTES = 25 * 1024 * 1024;

/** Longest PDF the library accepts (pages). Longer documents are books,
 *  not papers, and would crowd out the conversation. */
export const MAX_PAPER_PAGES = 300;

/** The papers of one session may use at most this share of the
 *  conversation model's context window; the rest is the lesson. */
export const MAX_PAPER_CONTEXT_SHARE = 0.5;

/** One stored paper: data/papers/<id>/paper.json. */
export interface PaperRecord {
	/** SHA-256 of the PDF bytes, lowercase hex. */
	id: string;
	/** The paper's title as read from the PDF (its first large heading or
	 *  its metadata), else the file name without its extension. */
	title: string;
	/** The file name the learner added (display only). */
	fileName: string;
	pageCount: number;
	bytes: number;
	/** Pages with no extractable text — scans or full-page figures. There is
	 *  no OCR: the agent can only see these by rendering them. */
	textlessPages: number[];
	/** Characters of extracted text across all pages (sizes the context). */
	textChars: number;
	addedAt: string;
}

/** One page's extracted text; null when the page has none. */
export interface PaperPage {
	number: number;
	text: string | null;
}

/** A rough token count for paper text — the same 4-characters-per-token
 *  estimate the compaction projection uses for the system prompt. */
export function estimatePaperTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

/** A SHA-256 hex id, the only form a paper id takes. */
export function isPaperId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
