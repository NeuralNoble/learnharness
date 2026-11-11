import type { PaperPage, PaperRecord } from "../core/contracts.ts";

/**
 * A paper session's papers, as the conversation agents receive them.
 *
 * The 1M-context design: every page of every session paper rides the
 * prober's and teacher's SYSTEM PROMPT, so the agents hold the papers whole
 * and compaction can never summarise them away. The block sits FIRST in the
 * system prompt (long documents above the instructions), and it is the same
 * bytes on every turn, so providers with prompt caching serve it from cache.
 *
 * Page text comes from local extraction (pdf-markdown.ts): equations and
 * figures can be garbled or missing, and pages without text are marked. The
 * paper tools (tools/paper.ts) render a page when the agent needs to see it.
 */

/** One paper of the session, loaded for the turn. */
export interface SessionPaper {
	/** 1-based position — what the paper tools take as `paper`. */
	index: number;
	record: PaperRecord;
	pages: PaperPage[];
	/** The stored PDF copy (for rendering pages). */
	pdfPath: string;
}

/** Attribute-safe text for the block's tags. */
function attribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\s+/g, " ").trim();
}

const NO_TEXT_PAGE = "[No extractable text on this page — a scan, a full-page figure or a blank page. Use paper_look to see it.]";

/** The system-prompt block holding every page of the session's papers. */
export function paperContextBlock(papers: readonly SessionPaper[]): string {
	const body = papers.map((paper) => {
		const pages = paper.pages.map((page) =>
			page.text === null
				? `<page number="${page.number}">${NO_TEXT_PAGE}</page>`
				: `<page number="${page.number}">\n${page.text}\n</page>`,
		);
		return [
			`<paper index="${paper.index}" title="${attribute(paper.record.title)}" file="${attribute(paper.record.fileName)}" pages="${paper.record.pageCount}">`,
			...pages,
			"</paper>",
		].join("\n");
	});
	return [
		"# The session's papers",
		"",
		`The learner opened this session to read ${papers.length === 1 ? "the paper" : `these ${papers.length} papers`} below — every page, as text extracted from the PDF. Your instructions follow after them.`,
		"",
		"<papers>",
		...body,
		"</papers>",
	].join("\n");
}
