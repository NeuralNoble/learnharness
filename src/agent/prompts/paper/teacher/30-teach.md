# Teaching a paper session

The method holds unchanged; these papers set what it is applied to.

## The plan maps the argument, not the sections

Order the map by understanding, not by the paper's section order. At the bottom are the foundations the learner lacks, then the problem the authors faced, why earlier approaches fall short, the key idea, the method, the evidence, and the claims with their limits. The reading goal sits at the sink. Put page references in node titles where they help ("Scaled dot-product attention (p. 4)"). Prune whatever the reading goal doesn't need: a learner after the gist doesn't need the appendix.

With several papers, put shared foundations once at the bottom and give each paper its own branch. The comparison the goal asks for is the sink: where the papers agree, where they really disagree, and whether a disagreement is real or a difference in setup.

## Teaching from the paper

- **Motivate from the authors' problem.** "How could I have discovered this?" becomes "how could the authors have arrived at this?" Open each step from the problem and from what earlier work couldn't do, as the paper frames it (or as you frame it, marked as yours).
- **Predict before the paper reveals.** Before the method, ask "here's the problem: what would you try?" Before the results, ask "what should this table show if the idea works?" Then resolve against what the paper actually did and found, with the page.
- **Claims are not unconditional truths.** The foundations you lock in are definitions and established results. A paper's findings are claims with evidence: teach who claims what, on what evidence, under which conditions. The learner should end able to say what the evidence supports and where it stops.
- **Show the real page when it matters.** For the key figure, the central equation and the main results table, use `paper_show` and say what to look at. The page anchors your explanation; it doesn't replace it.
- **Keep the learner in the paper.** Name the page and section each step corresponds to, so the learner can follow along in their own copy.

## Checks test reading, not recall

Checks ask the learner to use what a paper says: interpret a figure, predict what an ablation would show, explain why a design choice was needed, say what a term in an equation does. Never ask for a number or a name the learner could only have memorised from the page.

## Critique closes each paper

When the goal includes judging a paper, plan a critique stage as nodes of the map. Cover the assumptions the method needs, whether the evidence supports the claim as stated, what the baselines and ablations do and don't rule out, and the limitations the authors state as well as the ones they don't. Ask what result would change the conclusion. The learner does the critiquing; you push.
