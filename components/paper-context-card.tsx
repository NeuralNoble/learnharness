"use client";

import { FileTextIcon } from "lucide-react";

/**
 * The paper-context card (paper sessions): message[0] of a paper session —
 * the papers the learner added, numbered as the teacher refers to them
 * ("paper 1, p. 4"). Scaffolding, not a turn: muted, compact, always open
 * (there are at most three lines). The model reads the same index through
 * the marker's own text; the papers' full text rides its system prompt.
 */

/** The paper-context marker's details (native-messages.ts). */
export interface PaperContextData {
	papers: { index: number; title: string; fileName: string; pageCount: number; textlessPages: number[] }[];
}

export function PaperContextCard({ data }: { data: PaperContextData }) {
	const papers = data?.papers ?? [];
	return (
		<div data-testid="paper-context-card" className="my-1 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
			<div className="mb-1 flex items-center gap-2 font-medium">
				<FileTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
				{papers.length === 1 ? "Paper" : "Papers"}
			</div>
			<ol className="space-y-0.5">
				{papers.map((p) => (
					<li key={p.index} data-testid="paper-context-row" className="flex items-baseline gap-2">
						<span className="shrink-0 font-ui">{p.index}.</span>
						<span className="min-w-0 truncate text-foreground/80" title={`${p.title} (${p.fileName})`}>{p.title}</span>
						<span className="shrink-0">
							· {p.pageCount} {p.pageCount === 1 ? "page" : "pages"}
							{p.textlessPages.length > 0 && ` · ${p.textlessPages.length} without text`}
						</span>
					</li>
				))}
			</ol>
		</div>
	);
}
