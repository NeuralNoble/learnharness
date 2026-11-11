import { svgImageSource } from "../../lib/svg-image-source";

// Preserve the component module's existing public export.
export { svgImageSource };

/** A display-only copy for the white fullscreen stage: a diagram drawn for the
 * dark lesson page has no background, and its light text would vanish on white.
 * Copied source keeps the original. Assumes a viewBox starting at 0 0. */
export function svgWithBackdrop(svg: string, color: string): string {
	return svg.replace(/<svg(?=[\s>])(?:[^<>"']|"[^"]*"|'[^']*')*>/i, (root) => `${root}<rect width="100%" height="100%" fill="${color}"/>`);
}

/** Keep generated SVG in an image document, outside the app's CSS and ID scope.
 * This is a display boundary, not a sanitizer for the original SVG download. */
export function SvgImage({
	svg,
	className,
	width,
	onError,
}: {
	svg: string;
	className?: string;
	width?: number;
	/** Fires when the source cannot be displayed as an image. */
	onError?: () => void;
}) {
	return (
		// The source is already an in-memory vector image; no Next image optimization.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgImageSource(svg))}`}
			alt="Figure"
			className={className}
			width={width}
			draggable={false}
			onError={onError}
			// A server-rendered image can fail before hydration attaches onError.
			ref={(image) => { if (image?.complete && image.naturalWidth === 0) onError?.(); }}
		/>
	);
}
