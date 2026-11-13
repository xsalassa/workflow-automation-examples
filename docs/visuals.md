# Reproduce the diagrams

The seven `.mmd` files in `assets/flows/` are editable Mermaid flow summaries. The PNG light/dark pairs come from the authored HTML/SVG source, not from Power Automate or Airflow. Service logos identify the technology used at a stage; Lucide pictograms identify unbranded concepts such as a file, condition, or archive. The diagrams do not establish a deployed topology.

The Apps Script diagram follows the selected PRD functions, including the early return for an existing daily file and nonworking-day profiles. `dynamic-reporting` now depicts the separately verified Excel publisher/Cloud Run worker pattern, with the external subscription binding distinguished from observed source code. `csv-generation` preserves the separate direct CSV DAG path. Article captures remain historical references, not the basis for current PRD control flow.

To rebuild the offline source and capture it from the repository root:

```bash
python tools/build_visual_sources.py --icons /path/to/temporary-icons
python -m pip install -r tools/requirements-visuals.txt
python -m playwright install chromium
python tools/render_visuals.py
python tools/build_flow_details.py --icons /path/to/temporary-icons
```

The renderer uses Playwright's installed Chromium by default. `--browser /path/to/chromium` can select an existing compatible browser. It captures each figure in both themes, checks navigation and page overflow at several widths, and rejects console errors.

Fetch the icon keys listed in `assets/flows/icon-sources.json` into a temporary directory using stack-diagram's `fetch_icons.py`; that directory must contain its manifest. The provenance file records the fetched source URLs. Google Cloud icons come from Google's current product/category packages, including the Data Analytics category icon used for Pub/Sub. Microsoft Power Automate and Apache Airflow use files from their official repositories; Apps Script uses Google's asset host. Other brand marks use svgl. Brand colors are preserved on white tiles in both themes. Loose vendor icon files and downloaded packages are excluded from the repository; HTML embeds the icons as part of the diagrams.

`assets/synthetic-examples/watermark-demo.html` embeds the two pages used for its screenshot. The image comparison was prepared from a local CLI run with generated files; rebuild the example itself using the watermark README before replacing that visual with new results.

Design decisions: neutral backgrounds keep the process readable; teal marks the primary flow; dashed secondary arrows distinguish conditions/notes; the processing group expresses a workflow stage rather than an infrastructure security boundary. System sans-serif typography matches documentation reading, and the diagrams use no decorative background grid or animation.

## JSON action explorers

Each Power Automate example also contains `flow-details.html`, generated directly from its sanitized definition. These offline explorers retain all declared triggers/actions, sibling `runAfter` statuses, nested scopes, conditions and loops. Selecting a node shows its sanitized definition verbatim, including expressions and connector operation IDs. Branch buttons and a scope selector navigate nested action sets; the dependency table provides a textual connection listing.

The file-triggered example has 200 declared nodes across 61 scopes; SQL-to-Excel has 85 across 17 scopes. Solid edges mean explicit `runAfter` dependencies. Dashed trigger-entry edges are inferred for top-level actions without dependencies and are labeled as such. Nested actions are separate graphs to keep dependency lines from crossing container labels. Long graphs scroll within a named keyboard-focusable region. These are definition explorers, not execution traces. No removed query or private identity is reconstructed.
