/**
 * PaperStore — the fs adapter for the paper library (data/papers/<id>/).
 *
 * Implements core/ports.ts PaperStore. One folder per paper, named by the
 * SHA-256 of the PDF bytes:
 *
 *   paper.pdf    the learner's PDF, copied byte for byte
 *   pages.json   PaperPage[] — every page's extracted text (null = none)
 *   paper.json   PaperRecord — written LAST, so its presence means complete
 *
 * Wired in the composition root (src/server/stores.ts); tests construct
 * their own over a temporary directory with createPaperStore.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { isPaperId, type PaperPage, type PaperRecord } from "../core/contracts.ts";
import type { PaperStore } from "../core/ports.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function folder(root: string, id: string): string {
	if (!isPaperId(id)) throw new Error(`Invalid paper id: ${id}`);
	return path.join(root, id);
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
}

function isRecord(value: unknown, id: string): value is PaperRecord {
	const r = value as Partial<PaperRecord> | null;
	return !!r && r.id === id && typeof r.title === "string" && typeof r.fileName === "string"
		&& Number.isInteger(r.pageCount) && Number.isInteger(r.bytes) && Array.isArray(r.textlessPages)
		&& Number.isInteger(r.textChars) && typeof r.addedAt === "string";
}

function isPages(value: unknown): value is PaperPage[] {
	return Array.isArray(value) && value.every((p) => {
		const page = p as Partial<PaperPage> | null;
		return !!page && Number.isInteger(page.number) && (page.text === null || typeof page.text === "string");
	});
}

/** Write bytes beside the target, then rename over it (one atomic step). */
function writeBytesAtomic(file: string, bytes: Uint8Array): void {
	const tmp = `${file}.tmp-${randomUUID()}`;
	try {
		fs.writeFileSync(tmp, bytes);
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}

export function createPaperStore(root: string): PaperStore {
	return {
		getPaper(id) {
			if (!isPaperId(id)) return null;
			const record = readJson(path.join(folder(root, id), "paper.json"));
			return isRecord(record, id) ? record : null;
		},
		readPages(id) {
			if (!isPaperId(id)) return null;
			const pages = readJson(path.join(folder(root, id), "pages.json"));
			return isPages(pages) ? pages : null;
		},
		pdfPath(id) {
			return path.join(folder(root, id), "paper.pdf");
		},
		savePaper(record, pdf, pages) {
			const dir = folder(root, record.id);
			fs.mkdirSync(dir, { recursive: true });
			writeBytesAtomic(path.join(dir, "paper.pdf"), pdf);
			writeFileAtomicSync(path.join(dir, "pages.json"), JSON.stringify(pages), { allowInPlaceFallback: true });
			writeFileAtomicSync(path.join(dir, "paper.json"), JSON.stringify(record, null, "\t"), { allowInPlaceFallback: true });
		},
	};
}

export const paperStore: PaperStore = createPaperStore(PATHS.papers);
