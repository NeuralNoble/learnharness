"use client";

import { useCallback, useRef, useState } from "react";
import { FileTextIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { MAX_PAPER_BYTES, MAX_SESSION_PAPERS, type PaperRecord } from "@/src/core";

/**
 * The paper session draft's paper list (paper sessions): the learner adds
 * one to three PDFs, each uploaded to POST /api/papers, which keeps the
 * app's own copy. Works in the browser and the desktop app alike — the
 * file's bytes travel, never its local path.
 */

/** A paper record as the upload route returns it, checked field by field. */
function isPaperRecord(value: unknown): value is PaperRecord {
	const p = value as Partial<PaperRecord> | null;
	return !!p && typeof p.id === "string" && /^[0-9a-f]{64}$/.test(p.id) && typeof p.title === "string"
		&& typeof p.fileName === "string" && Number.isInteger(p.pageCount) && Array.isArray(p.textlessPages);
}

/** Upload one PDF; resolves to its stored record or rejects with a
 *  learner-facing message. Pure over `fetchLike` — exported for tests. */
export async function uploadPaper(file: File, fetchLike: typeof fetch = fetch): Promise<PaperRecord> {
	if (file.size > MAX_PAPER_BYTES) throw new Error("Too big. Papers can be at most 25 MB.");
	let response: Response;
	try {
		response = await fetchLike("/api/papers", {
			method: "POST",
			headers: { "Content-Type": "application/pdf", "X-Paper-Name": encodeURIComponent(file.name) },
			body: file,
		});
	} catch {
		throw new Error("Could not reach the app. Try again.");
	}
	const body = (await response.json().catch(() => null)) as { paper?: unknown; error?: unknown } | null;
	if (!response.ok || !isPaperRecord(body?.paper)) {
		throw new Error(typeof body?.error === "string" ? body.error : "Could not add this paper.");
	}
	return body.paper;
}

/** True for a file the picker should try to add (PDFs by type or name). */
export function isPdfFile(file: File): boolean {
	return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

interface PaperUploads {
	papers: PaperRecord[];
	pending: string[];
	errors: string[];
	addFiles: (files: Iterable<File>) => void;
	remove: (id: string) => void;
}

/** The draft's paper list state: added papers, uploads in flight, and the
 *  latest errors. Adding past the session limit is refused per file. */
export function usePaperUploads(upload: (file: File) => Promise<PaperRecord> = uploadPaper): PaperUploads {
	const [papers, setPapers] = useState<PaperRecord[]>([]);
	const [pending, setPending] = useState<string[]>([]);
	const [errors, setErrors] = useState<string[]>([]);
	// Slots taken by added papers plus uploads in flight (read synchronously
	// across back-to-back drops, before React re-renders).
	const taken = useRef(0);
	// The added ids, kept outside state so duplicate checks and slot counts
	// never run inside a state updater (React may call those twice).
	const added = useRef(new Set<string>());
	const addFiles = useCallback((files: Iterable<File>) => {
		const nextErrors: string[] = [];
		for (const file of files) {
			if (!isPdfFile(file)) {
				nextErrors.push(`${file.name}: not a PDF.`);
				continue;
			}
			if (taken.current >= MAX_SESSION_PAPERS) {
				nextErrors.push(`${file.name}: a session can read at most ${MAX_SESSION_PAPERS} papers.`);
				continue;
			}
			taken.current++;
			const key = `${file.name}\u0000${Math.random()}`;
			setPending((p) => [...p, key]);
			void upload(file)
				.then((paper) => {
					if (added.current.has(paper.id)) {
						taken.current--;
						setErrors((e) => [...e, `${file.name}: this paper is already added.`]);
						return;
					}
					added.current.add(paper.id);
					setPapers((list) => [...list, paper]);
				})
				.catch((err: unknown) => {
					taken.current--;
					setErrors((e) => [...e, `${file.name}: ${err instanceof Error ? err.message : "could not add it."}`]);
				})
				.finally(() => setPending((p) => p.filter((k) => k !== key)));
		}
		setErrors(nextErrors);
	}, [upload]);
	const remove = useCallback((id: string) => {
		if (!added.current.delete(id)) return;
		taken.current--;
		setPapers((list) => list.filter((p) => p.id !== id));
	}, []);
	return { papers, pending, errors, addFiles, remove };
}

/** The pending upload's display name (the key carries a uniquifier). */
function pendingName(key: string): string {
	return key.split("\u0000")[0] ?? "";
}

export function PaperPicker({ papers, pending, errors, addFiles, remove }: PaperUploads) {
	const inputRef = useRef<HTMLInputElement>(null);
	const full = papers.length + pending.length >= MAX_SESSION_PAPERS;
	return (
		<div data-testid="paper-picker" className="pointer-events-auto mb-2 rounded-xl border bg-card/85 p-2 shadow-sm backdrop-blur">
			{papers.length + pending.length > 0 && (
				<ul className="mb-1.5 flex flex-col gap-1">
					{papers.map((paper, i) => (
						<li key={paper.id} data-testid="paper-picker-row" className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
							<FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="shrink-0 font-ui text-xs text-muted-foreground">{i + 1}</span>
							<span className="min-w-0 flex-1 truncate" title={`${paper.title} (${paper.fileName})`}>{paper.title}</span>
							<span className="shrink-0 font-ui text-xs text-muted-foreground">
								{paper.pageCount} {paper.pageCount === 1 ? "page" : "pages"}
								{paper.textlessPages.length > 0 && ` · ${paper.textlessPages.length} without text`}
							</span>
							<button
								type="button"
								aria-label={`Remove ${paper.title}`}
								onClick={() => remove(paper.id)}
								className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<XIcon aria-hidden="true" className="size-3" />
							</button>
						</li>
					))}
					{pending.map((key) => (
						<li key={key} role="status" className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground">
							<Loader2Icon aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
							<span className="min-w-0 flex-1 truncate">Adding {pendingName(key)}…</span>
						</li>
					))}
				</ul>
			)}
			{errors.map((error) => (
				<p key={error} role="alert" className="mb-1 px-2 text-xs text-destructive">{error}</p>
			))}
			<div className="flex items-center gap-2 px-1">
				<input
					ref={inputRef}
					type="file"
					accept=".pdf,application/pdf"
					multiple
					hidden
					data-testid="paper-picker-input"
					onChange={(e) => {
						addFiles(Array.from(e.currentTarget.files ?? []));
						e.currentTarget.value = "";
					}}
				/>
				<button
					type="button"
					data-testid="paper-picker-add"
					disabled={full}
					onClick={() => inputRef.current?.click()}
					className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 font-ui text-xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground disabled:cursor-default disabled:opacity-50"
				>
					<PlusIcon aria-hidden="true" className="size-3" />
					Add PDFs
				</button>
				<span className="font-ui text-xs text-muted-foreground">
					{full ? `${MAX_SESSION_PAPERS} papers is the limit.` : `Up to ${MAX_SESSION_PAPERS} papers. You can also drop them here.`}
				</span>
			</div>
		</div>
	);
}
