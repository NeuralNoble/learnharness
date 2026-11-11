import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFauxCore, createProvider, fauxAssistantMessage, fauxText, type StreamFunction } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

// Isolation first (the cache-retention pattern): every store and the paper
// library live in a temporary data folder; no keys, no network.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-paper-sessions-"));
const originalEnv = process.env, originalFetch = globalThis.fetch;
process.env = { PATH: originalEnv.PATH, HOME: directory, NODE_ENV: "test", NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT, LH_DATA_DIR: directory, LH_AUTH_FILE: path.join(directory, "auth.json") };
fs.writeFileSync(process.env.LH_AUTH_FILE!, "{}");
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
const { addPaper, PaperUploadError, paperTitleFromPages, resolveSessionPapers, paperContextProblem, loadSessionPapers } = await import("../src/server/papers.ts");
const { createPaperStore } = await import("../src/store/papers.ts");
const { POST: postPaper } = await import("../app/api/papers/route.ts");
const { POST: postChat } = await import("../app/api/chats/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { piModels } = await import("../src/agent/models.ts");
const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { createProberAgent, composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { paperContextBlock } = await import("../src/agent/paper-context.ts");
const { paperTools, createPaperLookTool, createPaperShowTool } = await import("../src/agent/tools/paper.ts");
const { allSegmentPaths, effectivePaperSegments, listSourceSegments } = await import("../src/agent/prompt-segments.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { projectView } = await import("../src/core/view.ts");
const { nativeInputCause, newPaperContextMessage } = await import("../src/core/native-messages.ts");
after(() => { process.env = originalEnv; globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); });

/** A two-page paper: a title over body text, then a page with no text. */
function samplePaper(title = "Attention Is All You Need"): Uint8Array<ArrayBuffer> {
	return tinyPdf([
		{ runs: [
			{ text: title, x: 72, y: 700, size: 24 },
			{ text: "We propose a new simple network architecture based solely on attention.", x: 72, y: 640, size: 10 },
			{ text: "Experiments on two translation tasks show these models are superior.", x: 72, y: 620, size: 10 },
		] },
		{ image: true },
	]);
}

function toolText(result: { content: { type: string; text?: string }[] }): string {
	return result.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

describe("the paper library", () => {
	it("stores a byte-exact copy with its page text, and adding the same PDF again reuses it", async () => {
		const bytes = samplePaper();
		const paper = await addPaper(bytes, "/Users/someone/Downloads/1706.03762v7.pdf");
		assert.equal(paper.title, "Attention Is All You Need");
		assert.equal(paper.fileName, "1706.03762v7.pdf");
		assert.equal(paper.pageCount, 2);
		assert.deepEqual(paper.textlessPages, [2]);
		assert.ok(paper.textChars > 50);
		const store = createPaperStore(path.join(directory, "papers"));
		assert.deepEqual(new Uint8Array(fs.readFileSync(store.pdfPath(paper.id))), bytes, "the stored copy is the learner's PDF, byte for byte");
		const pages = store.readPages(paper.id)!;
		assert.equal(pages[1]!.text, null);
		assert.match(pages[0]!.text!, /solely on attention/);
		const again = await addPaper(samplePaper(), "renamed.pdf");
		assert.deepEqual(again, paper, "same bytes, same stored record (no second conversion)");
	});

	it("refuses what it cannot teach from, with the status the route answers", async () => {
		const refusal = async (bytes: Uint8Array) => {
			try {
				await addPaper(bytes, "x.pdf");
			} catch (err) {
				assert.ok(err instanceof PaperUploadError);
				return [err.status, err.message] as const;
			}
			assert.fail("expected a refusal");
		};
		assert.equal((await refusal(new Uint8Array()))[0], 400);
		assert.equal((await refusal(new TextEncoder().encode("plain text, not a pdf")))[0], 415);
		const [status, message] = await refusal(tinyPdf([{ image: true }]));
		assert.equal(status, 422);
		assert.match(message, /OCR/);
		const broken = new TextEncoder().encode("%PDF-1.7 truncated garbage");
		assert.equal((await refusal(broken))[0], 422);
	});

	it("titles from the first page's top headings, joined across a wrapped title", () => {
		assert.equal(paperTitleFromPages([{ number: 1, text: null }, { number: 2, text: "# Deep Residual\n\n# Learning\n\nBody text" }]), "Deep Residual Learning");
		assert.equal(paperTitleFromPages([{ number: 1, text: "## Abstract\n\nNo top heading" }]), null);
	});

	it("checks a session's paper ids and the papers' share of the model's context", async () => {
		const paper = await addPaper(samplePaper(), "a.pdf");
		assert.equal(resolveSessionPapers([]).ok, false);
		assert.equal(resolveSessionPapers([paper.id, paper.id]).ok, false);
		assert.equal(resolveSessionPapers(["0".repeat(64)]).ok, false);
		assert.equal(resolveSessionPapers(["not-an-id"]).ok, false);
		assert.equal(resolveSessionPapers([paper.id, "a".repeat(64), "b".repeat(64), "c".repeat(64)]).ok, false);
		const ok = resolveSessionPapers([paper.id]);
		assert.ok(ok.ok && ok.papers[0]!.id === paper.id);
		const big = { ...paper, textChars: 2_400_000 };
		assert.equal(paperContextProblem([big], 1_000_000), "These papers are about 600k tokens, more than half of your model's 1000k-token context. Remove a paper or choose a model with a larger context.");
		assert.equal(paperContextProblem([big], 2_000_000), null);
		assert.equal(paperContextProblem([big], undefined), null, "an unknown window never blocks");
		const loaded = loadSessionPapers([paper.id])!;
		assert.equal(loaded[0]!.index, 1);
		assert.equal(loadSessionPapers(["d".repeat(64)]), null);
	});
});

describe("POST /api/papers", () => {
	it("adds a raw PDF body under its URI-encoded file name", async () => {
		const response = await postPaper(new Request("http://localhost/api/papers", {
			method: "POST",
			headers: { "Content-Type": "application/pdf", "X-Paper-Name": encodeURIComponent("Résumé of attention.pdf") },
			body: samplePaper("Route Paper Title"),
		}));
		assert.equal(response.status, 200);
		const { paper } = await response.json();
		assert.equal(paper.title, "Route Paper Title");
		assert.equal(paper.fileName, "Résumé of attention.pdf");
	});

	it("answers refusals as JSON errors, and refuses oversized bodies before reading them", async () => {
		const notPdf = await postPaper(new Request("http://localhost/api/papers", { method: "POST", body: "hello" }));
		assert.equal(notPdf.status, 415);
		assert.deepEqual(await notPdf.json(), { error: "Not a PDF." });
		const huge = await postPaper(new Request("http://localhost/api/papers", { method: "POST", headers: { "Content-Length": String(26 * 1024 * 1024) }, body: "x" }));
		assert.equal(huge.status, 413);
	});
});

describe("paper session creation", () => {
	it("creates a paper session with its papers and an opening paper card, and refuses bad paper lists", async () => {
		const paper = await addPaper(samplePaper(), "a.pdf");
		const create = (body: unknown) => postChat(new Request("http://localhost/api/chats", { method: "POST", body: JSON.stringify(body) }));
		const refused = await create({ title: "Read it", kind: "paper", papers: [] });
		assert.equal(refused.status, 400);
		assert.deepEqual(await refused.json(), { error: "Add at least one paper." });
		const response = await create({ title: "Why does attention work?", kind: "paper", papers: [paper.id] });
		assert.equal(response.status, 200);
		const { id } = await response.json();
		const record = chatStore.getChat(id)!;
		assert.equal(record.kind, "paper");
		assert.deepEqual(record.papers, [paper.id]);
		assert.equal(record.messages.length, 1);
		const marker = record.messages[0] as { customType?: string; content?: string };
		assert.equal(marker.customType, "paper-context");
		assert.match(marker.content!, /1\. Attention Is All You Need \(2 pages\)/);
		const summary = chatStore.listChats().find((c) => c.id === id)!;
		assert.equal(summary.kind, "paper");
	});
});

describe("a paper session's turn", () => {
	it("puts every page before the instructions, composes the paper prompts and registers the prober's paper tool", async () => {
		const paper = await addPaper(samplePaper(), "a.pdf");
		const faux = createFauxCore({});
		const providerId = "paper-fixture";
		const entry = { ...faux.getModel(), provider: providerId, id: "paper-model" };
		const seen: string[] = [];
		const stream: StreamFunction = (model, context, options) => {
			// Providers receive the normalized transcript: the system prompt
			// rides its system messages.
			seen.push(getCurrentSystemPrompt(context.messages as never));
			return faux.streamSimple(model, context, options);
		};
		piModels().setProvider(createProvider({ id: providerId, models: [entry], auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
		writeSettings({ version: 1, graph: { enabled: false }, models: { strong: { model: { provider: providerId, id: "paper-model" } } } });
		const chat = chatStore.createChat("Paper turn", "paper", [paper.id]);
		faux.setResponses([fauxAssistantMessage([fauxText("Why are you reading it?")])]);
		let built: { paper?: { context: string; tools: { name: string }[] } } | undefined;
		const response = await handleChatInput(chat.id, { type: "text", text: "Teach me this paper" }, (options) => {
			built = options;
			return createProberAgent({} as never, { ...options, tools: {} });
		});
		assert.equal(response.status, 200, await response.clone().text());
		const handle = runningTurn(chat.id);
		if (handle) await new Response(handle.subscribe()).text();
		assert.deepEqual(built?.paper?.tools.map((t) => t.name), ["paper_look"], "the prober looks; only the teacher shows");
		const system = seen[0]!;
		assert.ok(system.startsWith("# The session's papers"), "the papers lead the system prompt");
		assert.ok(system.indexOf("solely on attention") < system.indexOf("# The agent"), "pages come before the instructions");
		assert.match(system, /<page number="2">\[No extractable text on this page/);
		assert.match(system, /# Probing for a paper session/);
		assert.doesNotMatch(system, /# Teaching a paper session/);
		piModels().deleteProvider(providerId);
	});

	it("refuses a turn whose papers are gone from the library, before any turn effects", async () => {
		const chat = chatStore.createChat("Orphan", "paper", ["e".repeat(64)]);
		const response = await handleChatInput(chat.id, { type: "text", text: "hello" });
		assert.equal(response.status, 409);
		assert.equal(chatStore.getChat(chat.id)!.messages.length, 0);
	});
});

describe("the paper tools", () => {
	it("paper_look returns rendered pages to a vision model and only text to a text model", async () => {
		const paper = await addPaper(samplePaper(), "a.pdf");
		const papers = loadSessionPapers([paper.id])!;
		const chatStoreSpy = { saveImageSnapshot: () => {} };
		const vision = createPaperLookTool({ papers, chatId: "c", chatStore: chatStoreSpy, model: { input: ["text", "image"] } as never });
		const seen = await vision.execute("t1", { paper: 1, pages: "1-9" });
		assert.equal(seen.content.filter((c) => c.type === "image").length, 2, "pages clamp to the paper");
		assert.match(toolText(seen as never), /Paper 1 \("Attention Is All You Need"\), pages 1, 2:/);
		const textOnly = createPaperLookTool({ papers, chatId: "c", chatStore: chatStoreSpy, model: { input: ["text"] } as never });
		const blind = await textOnly.execute("t2", { paper: 1, pages: "1" });
		assert.equal(blind.content.filter((c) => c.type === "image").length, 0);
		assert.match(toolText(blind as never), /cannot see images/);
		await assert.rejects(() => vision.execute("t3", { paper: 2, pages: "1" }), /There is no paper 2; this session has paper 1\./);
		await assert.rejects(() => vision.execute("t4", { paper: 1, pages: "7" }), /No pages matched/);
	});

	it("paper_show stores the rendered page as a session snapshot and records show_image's details", async () => {
		const paper = await addPaper(samplePaper(), "a.pdf");
		const papers = loadSessionPapers([paper.id])!;
		const saved: { id: string; snapshotId: string; mimeType: string; width: number }[] = [];
		const tool = createPaperShowTool({ papers, chatId: "chat-x", chatStore: { saveImageSnapshot: (id, snapshotId, image) => { saved.push({ id, snapshotId, mimeType: image.mimeType, width: image.width }); } } });
		const result = await tool.execute("s1", { paper: 1, page: 1, caption: "the abstract" });
		assert.equal(saved.length, 1);
		assert.equal(saved[0]!.id, "chat-x");
		assert.ok(saved[0]!.width > 500);
		const details = result.details as { path: string; caption: string; snapshotId: string };
		assert.equal(details.path, "attention-is-all-you-need-page-1.png");
		assert.equal(details.caption, "Attention Is All You Need, p. 1 — the abstract");
		assert.equal(details.snapshotId, saved[0]!.snapshotId);
		assert.match(toolText(result as never), /Shown to the learner: paper 1/);
		await assert.rejects(() => tool.execute("s2", { paper: 1, page: 3 }), /pages 1–2/);
		assert.deepEqual(paperTools({ papers, chatId: "c", chatStore: { saveImageSnapshot: () => {} } }, "teacher").map((t) => t.name), ["paper_look", "paper_show"]);
	});
});

describe("paper prompts and context", () => {
	it("compose only into paper sessions, after the agent's own doctrine and before the shared mechanics", () => {
		const teacher = listSourceSegments("teacher", { paper: true }).map((s) => s.path);
		const firstShared = teacher.findIndex((p) => p.startsWith("shared/"));
		const lastTeacher = teacher.findLastIndex((p) => p.startsWith("teacher/"));
		assert.ok(teacher.indexOf("paper/shared/10-reading.md") > lastTeacher);
		assert.ok(teacher.indexOf("paper/teacher/30-teach.md") < firstShared);
		assert.ok(!teacher.includes("paper/prober/20-probe.md"));
		assert.ok(!listSourceSegments("teacher").some((s) => s.path.startsWith("paper/")), "teach sessions never see them");
		assert.ok(!listSourceSegments("practice", { paper: true }).some((s) => s.path.startsWith("paper/")));
		assert.ok(composeInstructions("prober", undefined, { paper: true }).includes("# Probing for a paper session"));
		assert.ok(!composeInstructions("prober").includes("Paper sessions"));
	});

	it("are editable segments, listed in their own Settings view", () => {
		assert.ok(isValidSegmentPath("paper/teacher/30-teach.md"));
		assert.ok(isValidSegmentPath("paper/shared/10-reading.md"));
		assert.ok(!isValidSegmentPath("paper/practice/10-x.md"));
		assert.ok(!isValidSegmentPath("paper/10-x.md"));
		assert.ok(allSegmentPaths().includes("paper/prober/20-probe.md"));
		assert.deepEqual(effectivePaperSegments({}).map((s) => s.path), ["paper/shared/10-reading.md", "paper/prober/20-probe.md", "paper/teacher/30-teach.md"]);
	});

	it("the context block tags every page and escapes attributes", () => {
		const block = paperContextBlock([{
			index: 1,
			record: { id: "f".repeat(64), title: 'A "quoted" <title> & more', fileName: "a.pdf", pageCount: 2, bytes: 1, textlessPages: [2], textChars: 4, addedAt: "" },
			pages: [{ number: 1, text: "Body" }, { number: 2, text: null }],
			pdfPath: "/x",
		}]);
		assert.match(block, /<paper index="1" title="A &quot;quoted&quot; &lt;title> &amp; more" file="a.pdf" pages="2">/);
		assert.match(block, /<page number="1">\nBody\n<\/page>/);
		assert.match(block, /read the paper below/);
	});

	it("the opening marker is neutral context that projects to the transcript card", () => {
		const marker = { ...newPaperContextMessage([{ index: 1, title: "T", fileName: "t.pdf", pageCount: 1, textlessPages: [] }]) };
		assert.equal(nativeInputCause(marker as never, []), "neutral");
		const view = projectView([marker]);
		assert.equal(view[0]!.parts[0]!.type, "data-paper-context");
	});
});
