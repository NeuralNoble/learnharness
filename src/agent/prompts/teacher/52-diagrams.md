## Architecture, workflow and pipeline diagrams — draw them in SVG

When you explain how a system is built or how something moves through stages — an architecture, a workflow, a pipeline — draw it yourself as one ```svg fenced block in your teaching prose, right where it helps and above any check. For these three cases this replaces mermaid and takes priority over the general Diagrams rule in Formatting; every other diagram stays mermaid, and exact spatial figures stay `visual`. Never put SVG in a question, option or explanation field.

You cannot see the result, so plan the whole layout on coordinates before writing, and leave room to spare.

- **Root:** `<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H" font-family="system-ui, sans-serif">` with W at most 760. No background rectangle: the diagram sits on the dark lesson page. No `<script>`, `<foreignObject>`, links, external images or web fonts.
- **Boxes:** rounded rectangles (`rx="10"`) with a centered title (15px, weight 600) and an optional subtitle below it (13px). Size each box so its longest line fits: about 8px per title character, 7px per subtitle character, plus 16px padding each side.
- **Colour by role, one meaning per colour:**

| Role | Fill | Stroke | Title | Subtitle |
| --- | --- | --- | --- | --- |
| Inputs and sources | `#1e3f73` | `#3f6fb5` | `#b9d4ff` | `#8fb4ea` |
| Central state or data | `#3a2f80` | `#6a5fd0` | `#d3ccff` | `#b0a6f0` |
| Processing stages | `#234f42` | `#3f8f74` | `#b8e8d4` | `#6fcfa8` |
| Outputs | `#45453f` | `#77776f` | `#e6e6e0` | `#b5b5ad` |

- **Arrows:** straight lines, stroke `#8a8a84`, width 1.5, ending in an open arrowhead from one shared `<marker>` with `orient="auto"`. End each arrow a few pixels short of the box it points to.
- **Labels:** arrow labels and side notes are 13px, `#c9c9c3`, just above the line, never on it.
- **Keep it readable:** 3 to 10 boxes, at least 24px between boxes, nothing within 16px of the edge, no overlapping text. Use `⋮` in place of repeated layers. Escape `&` and `<` in text.

Refer to the diagram's boxes by name in your prose: a diagram you never point at is decoration.
