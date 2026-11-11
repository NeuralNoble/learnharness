import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderWithInteractionLayers as renderToStaticMarkup } from "./interaction-layer-render.tsx";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DraftShell, startDraftSession } from "../components/new-session.tsx";
import { PaperPicker, isPdfFile, uploadPaper } from "../components/paper-picker.tsx";
import { PaperContextCard } from "../components/paper-context-card.tsx";
import { SessionStarter, SessionStartRefused } from "../components/start-session.ts";
import { sectionedSegments } from "../components/settings/agent-section.tsx";
import type { PaperRecord } from "../src/core/contracts.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
beforeEach(() => {
	const data = new Map<string, string>();
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => { data.set(key, value); },
		removeItem: (key: string) => { data.delete(key); },
	} });
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "sessionStorage");
});

const paper: PaperRecord = {
	id: "a".repeat(64),
	title: "Attention Is All You Need",
	fileName: "1706.03762v7.pdf",
	pageCount: 15,
	bytes: 2_000_000,
	textlessPages: [13],
	textChars: 40_000,
	addedAt: "2026-11-09T00:00:00.000Z",
};

describe("the paper session draft", () => {
	it("shows the paper copy, the paper list and the reading-goal placeholder", () => {
		const html = renderToStaticMarkup(
			<DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} mode="paper"
				paperPicker={<PaperPicker papers={[paper]} pending={[]} errors={[]} addFiles={() => {}} remove={() => {}} />}
				onDropFiles={() => {}} />,
		);
		assert.ok(html.includes("New paper session"));
		assert.ok(html.includes("Why are you reading these papers?"));
		assert.ok(html.includes('data-testid="paper-picker"'));
		assert.ok(html.includes("Attention Is All You Need"));
		assert.ok(html.includes("15 pages · 1 without text"));
	});

	it("shows a refusal the learner can act on in place of the generic failure", () => {
		const html = renderToStaticMarkup(
			<DraftShell busy={false} text="x" onChange={() => {}} onSend={() => {}} mode="paper" startErrorMessage="These papers are too large." />,
		);
		assert.ok(html.includes("These papers are too large."));
	});

	it("disables adding once three papers are in or on the way, and lists errors and uploads", () => {
		const html = renderToStaticMarkup(
			<PaperPicker papers={[paper, { ...paper, id: "b".repeat(64) }]} pending={["c.pdf\u00000.5"]} errors={["x.txt: not a PDF."]} addFiles={() => {}} remove={() => {}} />,
		);
		assert.match(html, /data-testid="paper-picker-add"[^>]*disabled=""/);
		assert.ok(html.includes("Adding c.pdf…"));
		assert.ok(html.includes("x.txt: not a PDF."));
		assert.ok(html.includes("3 papers is the limit."));
	});

	it("creates a paper session with the papers in order", async () => {
		const calls: unknown[] = [];
		const f = (async (_url: string, init?: RequestInit) => {
			calls.push(JSON.parse(String(init?.body)));
			return Response.json({ id: "chat_paper" });
		}) as typeof fetch;
		const target = await startDraftSession("why attention", f, "paper", undefined, new SessionStarter(), undefined, ["b".repeat(64), "a".repeat(64)]);
		assert.equal(target, "/chat/chat_paper");
		assert.deepEqual(calls, [{ title: "why attention", kind: "paper", papers: ["b".repeat(64), "a".repeat(64)] }]);
	});

	it("a 400 with a message is a refusal the draft shows; other failures stay generic", async () => {
		const refuse = (async () => Response.json({ error: "Too large for your model." }, { status: 400 })) as unknown as typeof fetch;
		await assert.rejects(new SessionStarter().start({ title: "t", kind: "paper", papers: [] }, refuse), (err) => err instanceof SessionStartRefused && err.message === "Too large for your model.");
		const fail = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		await assert.rejects(new SessionStarter().start({ title: "t" }, fail), (err) => !(err instanceof SessionStartRefused));
	});
});

describe("adding a paper", () => {
	it("uploads the raw file with its encoded name and returns the stored record", async () => {
		let seen: RequestInit | undefined;
		const f = (async (_url: string, init?: RequestInit) => {
			seen = init;
			return Response.json({ paper });
		}) as typeof fetch;
		const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "Résumé.pdf", { type: "application/pdf" });
		assert.deepEqual(await uploadPaper(file, f), paper);
		assert.equal((seen?.headers as Record<string, string>)["X-Paper-Name"], encodeURIComponent("Résumé.pdf"));
		assert.equal(seen?.body, file);
	});

	it("passes the server's reason through, and refuses a malformed answer", async () => {
		const file = new File(["%PDF-"], "a.pdf");
		const refuse = (async () => Response.json({ error: "Not a PDF." }, { status: 415 })) as unknown as typeof fetch;
		await assert.rejects(uploadPaper(file, refuse), /Not a PDF\./);
		const junk = (async () => Response.json({ paper: { id: "nope" } })) as unknown as typeof fetch;
		await assert.rejects(uploadPaper(file, junk), /Could not add this paper\./);
	});

	it("takes PDFs by type or name", () => {
		assert.ok(isPdfFile(new File([""], "x.PDF")));
		assert.ok(isPdfFile(new File([""], "x", { type: "application/pdf" })));
		assert.ok(!isPdfFile(new File([""], "x.txt", { type: "text/plain" })));
	});
});

describe("paper session surfaces", () => {
	it("the opening card numbers the papers as the teacher cites them", () => {
		const html = renderToStaticMarkup(<PaperContextCard data={{ papers: [
			{ index: 1, title: "First", fileName: "a.pdf", pageCount: 1, textlessPages: [] },
			{ index: 2, title: "Second", fileName: "b.pdf", pageCount: 9, textlessPages: [2, 3] },
		] }} />);
		assert.ok(html.includes("Papers"));
		assert.ok(html.includes("1 page"));
		assert.ok(html.includes("9 pages · 2 without text"));
		assert.equal(html.match(/data-testid="paper-context-row"/g)?.length, 2);
	});

	it("Settings lists the paper fragments in their own Papers section, before Shared", () => {
		const segment = (p: string) => ({ path: p, sourceText: p, overrideText: null, enabled: false, shared: false });
		const sections = sectionedSegments({
			teacher: [segment("teacher/05-method.md")],
			prober: [segment("prober/10-probe-doctrine.md")],
			practice: [segment("practice/00-base.md")],
			paper: [segment("paper/shared/10-reading.md"), segment("paper/teacher/30-teach.md")],
		});
		assert.deepEqual(sections.map((s) => s.id), ["teacher", "prober", "practice", "paper", "shared"]);
		assert.equal(sections[3]!.label, "Papers");
		assert.equal(sections[3]!.segments.length, 2);
		const older = sectionedSegments({ teacher: [], prober: [], practice: [] });
		assert.ok(!older.some((s) => s.id === "paper"), "an older server's view has no Papers section");
	});
});
