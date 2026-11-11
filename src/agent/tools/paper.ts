import { createHash } from "node:crypto";
import { Type } from "typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { processImage } from "../image-processing/index.ts";
import { getHeadless } from "../subagents/headless.ts";
import { parsePageSpec } from "../subagents/pdf-ops.ts";
import type { SessionPaper } from "../paper-context.ts";
import type { ChatStore } from "../../core/ports.ts";
import type { ShowImageDetails } from "../../core/contracts.ts";
import { healToolRecord } from "./heal.ts";

/**
 * The paper tools (paper sessions only). The papers' TEXT already rides the
 * system prompt (paper-context.ts); these tools are the agents' eyes on the
 * real pages, rendered natively from the stored PDF copy:
 *
 *   paper_look  — the agent sees up to four pages as images (prober + teacher)
 *   paper_show  — the learner sees one page in the lesson (teacher only),
 *                 through show_image's card and session snapshot store
 */

const MAX_LOOK_PAGES = 4;
/** 150 DPI: the pdf-reader's default — equations and small print stay legible. */
const RENDER_DPI = 150;

export interface PaperToolContext {
	papers: readonly SessionPaper[];
	chatId: string;
	chatStore: Pick<ChatStore, "saveImageSnapshot">;
	/** The conversation model: whether it sees images, and its resize limits. */
	model?: Pick<Model<Api>, "input" | "inputLimits">;
}

function paperAt(ctx: PaperToolContext, index: number): SessionPaper {
	const paper = ctx.papers.find((p) => p.index === index);
	if (!paper) {
		const range = ctx.papers.length === 1 ? "paper 1" : `papers 1–${ctx.papers.length}`;
		throw new Error(`There is no paper ${index}; this session has ${range}.`);
	}
	return paper;
}

/** A PNG's pixel size, from its IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "paper";
}

const paperField = Type.Integer({ minimum: 1, description: "The paper's number in this session (1 = the first paper)." });

const lookInput = Type.Object({
	paper: paperField,
	pages: Type.String({ description: `Pages to see: '3', '3-4' or '2,5'. At most ${MAX_LOOK_PAGES} pages per call.` }),
});

const showInput = Type.Object({
	paper: paperField,
	page: Type.Integer({ minimum: 1, description: "The page to show." }),
	caption: Type.Optional(Type.String({ description: "One short line under the page, e.g. what to look at." })),
});

export function createPaperLookTool(ctx: PaperToolContext): AgentTool<typeof lookInput> {
	return {
		name: "paper_look",
		label: "paper_look",
		description:
			"See pages of a session paper as images: equations, figures, tables and layout, which the page text in your " +
			"instructions can garble or miss, and pages that have no extractable text. Up to 4 pages per call. The images come " +
			"back to you only; the learner sees nothing. To put a page in front of the learner, use paper_show.",
		parameters: lookInput,
		execute: serverExecute("paper_look", lookInput, async ({ paper: index, pages: spec }, { signal }): Promise<ImageFileResult> => {
			const paper = paperAt(ctx, index);
			const wanted = parsePageSpec(spec, paper.record.pageCount);
			if (wanted.length === 0) {
				throw new Error(`No pages matched "${spec}"; paper ${index} has pages 1–${paper.record.pageCount}.`);
			}
			const pages = wanted.slice(0, MAX_LOOK_PAGES);
			const notes = [`Paper ${index} ("${paper.record.title}"), page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}:`];
			if (wanted.length > pages.length) notes.push(`[Showing the first ${MAX_LOOK_PAGES} of ${wanted.length} pages; ask again for the rest.]`);
			if (ctx.model && !ctx.model.input.includes("image")) {
				notes.push("[The current model cannot see images. Work from the page text in your instructions.]");
				return { text: notes.join("\n") };
			}
			const rendered = await getHeadless().renderPdfPages(paper.pdfPath, pages, { dpi: RENDER_DPI });
			signal?.throwIfAborted();
			const images: { data: string; mimeType: string }[] = [];
			for (const page of rendered) {
				const processed = await processImage(page.png, "image/png", { resizeOptions: ctx.model?.inputLimits?.images?.resize });
				signal?.throwIfAborted();
				if (processed.ok) images.push({ data: processed.data, mimeType: processed.mimeType });
				else notes.push(`Page ${page.page}: ${processed.message}`);
			}
			return { text: notes.join("\n"), images };
		}),
	};
}

export function createPaperShowTool(ctx: PaperToolContext): AgentTool<typeof showInput> {
	return {
		name: "paper_show",
		label: "paper_show",
		description:
			"Show the learner one page of a session paper as the real page, with an optional caption: the figure, table or " +
			"equation you are teaching from. Instant. The result only confirms what was shown; the image is not sent back to " +
			"you (use paper_look to see a page yourself). Show a page when seeing the original helps, not as decoration.",
		parameters: showInput,
		execute: serverExecute("paper_show", showInput, async ({ paper: index, page, caption }, { signal }) => {
			const paper = paperAt(ctx, index);
			if (page > paper.record.pageCount) throw new Error(`Paper ${index} has pages 1–${paper.record.pageCount}.`);
			const [rendered] = await getHeadless().renderPdfPages(paper.pdfPath, [page], { dpi: RENDER_DPI });
			signal?.throwIfAborted();
			if (!rendered) throw new Error(`Page ${page} of paper ${index} could not be rendered.`);
			const { width, height } = pngSize(rendered.png);
			const snapshotId = createHash("sha256").update(rendered.png).digest("hex");
			ctx.chatStore.saveImageSnapshot(ctx.chatId, snapshotId, {
				mimeType: "image/png",
				data: Buffer.from(rendered.png).toString("base64"),
				width,
				height,
			});
			const trimmed = caption?.trim();
			const details: ShowImageDetails = {
				path: `${slug(paper.record.title)}-page-${page}.png`,
				caption: `${paper.record.title}, p. ${page}${trimmed ? ` — ${trimmed}` : ""}`,
				mimeType: "image/png",
				snapshotId,
				width,
				height,
			};
			return { text: `Shown to the learner: paper ${index} ("${paper.record.title}"), page ${page}.`, details };
		}),
	};
}

/** The paper tools for one agent: the teacher gets both, the prober looks. */
export function paperTools(ctx: PaperToolContext, agent: "prober" | "teacher"): AgentTool<any>[] {
	return Object.values(healToolRecord({
		paper_look: createPaperLookTool(ctx),
		...(agent === "teacher" ? { paper_show: createPaperShowTool(ctx) } : {}),
	}));
}
