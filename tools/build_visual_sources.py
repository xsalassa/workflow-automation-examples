"""Build offline workflow illustrations from authored diagram specifications."""

import argparse
import base64
import json
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/flows'
ICONS = {}
ICON_MAP = {
    'dynamic-reporting': [('airflow','bigquery'), ('pubsub',), ('cloudrun',), ('python',), ('storage',), ('airflow',), ('pubsub','mail')],
    'monitoring-file-setup': [('appscript',), ('sheets',), ('drive','sheets'), ('sheets',), ('sheets',), ('check',), ('clock',)],
    'csv-generation': [('bigquery',), ('bigquery',), ('storage',), ('python',), ('file',), ('clock',), ('pubsub','mail')],
    'daily-project-report': [('automate',), ('excel',), ('automate',), ('teams','outlook'), ('archive',), ('branch',), ('check',)],
    'report-distribution': [('onedrive',), ('automate',), ('automate',), ('excel',), ('teams','outlook'), ('check',), ('branch',)],
    'sql-excel-sync': [('sql',), ('sql',), ('excel',), ('excel',), ('outlook',), ('branch',), ('alert',)],
    'pdf-watermarking': [('file',), ('python',), ('file',), ('python',), ('file',), ('alert',), ('archive',)],
}
PLATFORM = {'dynamic-reporting': ('cloudrun','Asynchronous workbook generation'),
            'csv-generation': ('airflow','Apache Airflow / direct CSV export'),
            'monitoring-file-setup': ('appscript','Google Apps Script automation'),
            'daily-project-report': ('automate','Microsoft Power Automate'),
            'report-distribution': ('automate','Microsoft Power Automate'),
            'sql-excel-sync': ('automate','Microsoft Power Automate'),
            'pdf-watermarking': ('python','Python / PyMuPDF local CLI')}

# name, title, stage labels/tool roles, and source-based branch annotations.
DIAGRAMS = [
    ('dynamic-reporting', 'Generate Excel with Airflow and Cloud Run',
     [('Read request rows','BigQuery metadata'), ('Publish requests','Pub/Sub messages'),
      ('Receive push','Cloud Run HTTP route'), ('Query and write XLSX','BigQuery / XlsxWriter'),
      ('Upload workbook','Cloud Storage output')],
     [('Wait for file count','Airflow polls GCS'),('Publish notifications','email and chat topics')],
     'Push subscription/IAM binding is configured externally and unverified. Airflow waits for object counts, then publishes notification messages.'),
    ('csv-generation', 'Direct CSV generation: separate Airflow DAG',
     [('Poll readiness','upstream success table'), ('Run report SQL','eight task groups'),
      ('Export CSV files','Cloud Storage / shards'), ('Join and checksum','SHA-1 file manifest'),
      ('Finish the DAG','output file set')],
     [('Not ready','retry; timeout raises'),('Task failure','Pub/Sub and email')],
     'Two report chains run in parallel, sequential within each chain. This direct CSV DAG does not trigger the Excel worker.'),
    ('monitoring-file-setup', 'Daily checkpoint: actual Apps Script PRD flow',
     [('Load and validate','template / properties'),('Refresh schedule','workday / holiday PIC'),
      ('Find or create file','year/month folders'),('Prepare new workbook','copy sheets / profile'),
      ('Save links and state','master / history / props')],
     [('Existing daily file','validate; state; return'),('Later service checks','scheduled / manual')],
     'Existing files return without replacement. Weekends/holidays select profiles, not an automatic stop. Airflow status checks run manually from the sidebar.'),
    ('daily-project-report','Scheduled daily project report',
     [('Weekday trigger','scheduled workflow'),('Read the checklist','Excel activities'),
      ('Build the summary','activities and progress'),('Send the report','Teams and email'),
      ('Archive and clean','monthly log; marked rows')],
     [('Small activity set','article shows a stop check'),('Pending activities','include in the summary')],
     'This scheduled workflow is separate from the file-created approval and distribution workflow.'),
    ('report-distribution','File-created approval and distribution',
     [('New file arrives','OneDrive polling trigger'),('Read and classify','metadata and category'),
      ('Route the report','branch-specific handling'),('Update workbook','eligible row updates'),
      ('Notify recipients','Teams or email paths')],
     [('Selected categories','request and await approval'),('Other categories','direct update paths')],
     'A simplified branch overview, not an exact run trace. Not every category requires approval.'),
    ('sql-excel-sync','SQL-to-Excel synchronization',
     [('Source item changes','SQL modified-item trigger'),('Read source records','SQL and Power Query'),
      ('Compare rows','Excel reads and filters'),('Update matches','branch-specific keys'),
      ('Build notifications','tables and email')],
     [('Group summaries','area and region selections'),('Adaptation needed','queries and keys are stubs')],
     'The public template preserves connector structure; it does not establish reconciliation accuracy.'),
    ('pdf-watermarking','Local PDF image watermark',
     [('Choose local inputs','PDF and neutral mark'),('Validate inputs','geometry and output path'),
      ('Select the pages','first page or all pages'),('Insert the image','PyMuPDF overlay'),
      ('Publish the output','separate PDF file')],
     [('Invalid input','exit without publishing'),('Existing output','explicit overwrite required')],
     'Visible watermarking only. This example does not create a certificate-based digital signature.'),
]


def text(x, y, value, css='label'):
    return f'<text class="{css}" x="{x}" y="{y}" text-anchor="middle">{escape(value)}</text>'


def node(cx, top, label, role, icons, secondary=False):
    klass='node secondary' if secondary else 'node'
    logos=''
    for i,key in enumerate(icons):
        left=cx-18 if len(icons)==1 else cx-39+i*42
        logos+=(f'<rect class="logo-tile" x="{left-3}" y="{top+8}" width="42" height="38" rx="4"/>'
                f'<image class="service-icon" href="{ICONS[key]}" x="{left}" y="{top+11}" width="36" height="32"><title>{escape(key)}</title></image>')
    return (f'<g class="{klass}" data-box="{cx-86},{top},172,100">'
            f'<rect x="{cx-86}" y="{top}" width="172" height="100" rx="7"/>'
            +logos
            +text(cx,top+57,label)+text(cx,top+79,role,'role')+'</g>')


def diagram(name,title,stages,branches,caption):
    icons=ICON_MAP[name]
    nodes=''.join(node(cx,110,*stage,icons[i]) for i,(cx,stage) in enumerate(zip([110,315,520,725,930],stages)))
    nodes+=node(110,320,*branches[0],icons[5],secondary=True)
    nodes+=node(520,320,*branches[1],icons[6],secondary=True)
    platform,platform_label=PLATFORM[name]
    edges=''.join(f'<path class="edge'+(' secondary-edge' if name=='dynamic-reporting' and cx==315 else '')+f'" d="M{cx+90} 160 H{cx+111}" marker-end="url(#{name}-arrow)"/>'
                  for cx in [110,315,520,725])
    # Extra lines express source conditions, not a standalone deployment topology.
    if name=='dynamic-reporting':
        edges+=f'<path class="edge secondary-edge" d="M315 216 V280 H110 V314" marker-end="url(#{name}-arrow)"/>'
        edges+=f'<path class="edge" d="M200 370 H428" marker-end="url(#{name}-arrow)"/>'
        edges+=text(310,355,'count ready','edge-label')
    elif name=='monitoring-file-setup':
        edges+=f'<path class="edge secondary-edge" d="M520 216 V270 H110 V314" marker-end="url(#{name}-arrow)"/>'
        edges+=text(300,257,'already exists','edge-label')
        edges+=f'<path class="edge secondary-edge" d="M930 216 V290 H520 V314" marker-end="url(#{name}-arrow)"/>'
        edges+=text(790,280,'later triggers / UI','edge-label')
        edges+=text(622,104,'new file','edge-label')
    elif name=='csv-generation':
        edges+=f'<path class="edge secondary-edge" d="M110 216 V314" marker-end="url(#{name}-arrow)"/>'
        edges+=text(155,267,'condition','edge-label')
    elif name in ('daily-project-report','pdf-watermarking'):
        edges+=f'<path class="edge secondary-edge" d="M315 216 V260 H110 V314" marker-end="url(#{name}-arrow)"/>'
    elif name=='report-distribution':
        edges+=f'<path class="edge secondary-edge" d="M520 216 V260 H110 V314" marker-end="url(#{name}-arrow)"/>'
        edges+=text(300,250,'approval path','edge-label')
    else:
        edges+=f'<path class="edge secondary-edge" d="M315 216 V260 H110 V314" marker-end="url(#{name}-arrow)"/>'
    if name=='pdf-watermarking':
        edges+=f'<path class="edge secondary-edge" d="M315 216 V285 H520 V314" marker-end="url(#{name}-arrow)"/>'
    elif name not in ('dynamic-reporting','monitoring-file-setup'):
        edges+=f'<path class="edge secondary-edge" d="M520 216 V314" marker-end="url(#{name}-arrow)"/>'
    svg=(f'<svg width="1060" height="465" viewBox="0 0 1060 465" role="img" aria-labelledby="{name}-title {name}-desc">'
         f'<title id="{name}-title">{escape(title)}</title><desc id="{name}-desc">{escape(caption)}</desc>'
         '<defs>'+f'<marker id="{name}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>'
         '<rect class="group" x="205" y="50" width="835" height="210" rx="9"/>'
         +f'<rect class="logo-tile" x="224" y="63" width="28" height="28" rx="3"/>'
         +f'<image href="{ICONS[platform]}" x="227" y="66" width="22" height="22"/>'
         +text(610,88,platform_label+' · processing and output','group-label')+edges+nodes+'</svg>')
    return (f'<section class="capture" id="{name}" data-name="{name}"><header>'
            '<p class="kind">Source-based workflow summary</p>'
            f'<h2>{escape(title)}</h2></header>{svg}'
            f'<p class="caption">{escape(caption)}</p></section>')


STYLE='''
:root{color-scheme:light;--paper:#ffffff;--ink:#172b3a;--muted:#4b5e6d;--accent:#176b5b;--line:#6c7c87;--panel:#f1f5f3;--border:#6c7c87}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#14222b;--ink:#f1f5f7;--muted:#c1ced5;--accent:#83d8c0;--line:#aab9c3;--panel:#20333e;--border:#91a4b1}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--paper);color:var(--ink);font-family:Arial,Helvetica,sans-serif;line-height:1.55}main,.page-head,nav,footer{max-width:1080px;margin:0 auto}h1{font-size:28px;line-height:1.25}h2{font-size:26px;line-height:1.25;margin:6px 0 0}.page-head p{max-width:760px;color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding:16px 0}a{color:var(--accent);cursor:pointer;min-height:44px;display:inline-flex;align-items:center;text-underline-offset:4px}a:hover{text-decoration-thickness:3px}a:active{transform:translateY(1px)}a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}section.capture{width:100%;padding:30px 20px 24px;margin:28px 0 48px;border:1px solid var(--border);background:var(--paper)}.kind{font-size:14px;margin:0;color:var(--accent)}svg{display:block;width:100%;height:auto;margin-top:12px}.node rect{fill:var(--paper);stroke:var(--border);stroke-width:1.3}.node.secondary rect{fill:var(--panel)}.glyph{fill:none;stroke:var(--accent);stroke-width:1.5}.label{font-size:13px;font-weight:600;fill:var(--ink)}.role{font-size:11px;fill:var(--muted)}.edge{stroke:var(--accent);stroke-width:1.8;fill:none}.secondary-edge{stroke:var(--line);stroke-dasharray:5 4}.edge-label{fill:var(--muted);font-size:11px;paint-order:stroke;stroke:var(--paper);stroke-width:5px;stroke-linejoin:round}.group{fill:var(--panel);stroke:var(--border);stroke-width:1;stroke-dasharray:4 4}.group-label{fill:var(--muted);font-size:12px}.caption{margin:0;color:var(--muted);font-size:14px;max-width:960px}footer{padding:20px 0;font-size:13px;color:var(--muted)}img{max-width:100%;height:auto}figure{margin:0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}.comparison figcaption{font-size:16px;font-weight:bold;margin-bottom:8px}@media(max-width:600px){body{padding:12px}section.capture{padding:20px 8px}h2{font-size:22px}.comparison{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icons',type=Path,required=True,help='Temporary stack-diagram icon directory containing manifest.json')
    args=parser.parse_args()
    manifest=json.loads((args.icons/'manifest.json').read_text())
    used={key for groups in ICON_MAP.values() for group in groups for key in group}|{v[0] for v in PLATFORM.values()}
    for key in used:
        path=args.icons/manifest[key]['file']
        mime='image/svg+xml' if path.suffix=='.svg' else 'image/png'
        ICONS[key]='data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()
    OUT.mkdir(parents=True,exist_ok=True)
    links=''.join(f'<a href="#{d[0]}">{escape(d[1])}</a>' for d in DIAGRAMS)
    body=''.join(diagram(*d) for d in DIAGRAMS)
    logo_style=':root{--logo-tile:#fff}.logo-tile,.node rect.logo-tile{fill:var(--logo-tile);stroke:none}'
    html=(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workflow case study diagrams</title><style>{STYLE}{logo_style}</style></head><body>'
          '<header class="page-head"><h1>Workflow case study diagrams</h1><p>Offline illustrations of documented flow patterns. These simplified diagrams do not show a deployed system or a production run.</p></header>'
          f'<nav aria-label="Diagram index">{links}</nav><main>{body}</main>'
          '<footer>Icons: svgl / Google Cloud product icons / Lucide / official Apache and Microsoft repositories. Brand logos remain trademarks of their owners. <a href="https://github.com/caru-ini/stack-diagram">Made with stack-diagram</a>. <a href="../../THIRD_PARTY_NOTICES.md">Attribution and dependencies</a></footer></body></html>')
    (OUT/'visuals.html').write_text(html)
    (OUT/'icon-sources.json').write_text(json.dumps({key:manifest[key] for key in sorted(used)},indent=2)+'\n')
    for name,title,stages,branches,caption in DIAGRAMS:
        lines=['flowchart LR']
        for i,(label,role) in enumerate(stages):
            lines.append(f'    S{i}["{label}: {role}"]')
        lines.append('    S0 --> S1 --> S2 --> S3 --> S4')
        if name=='dynamic-reporting':
            lines[-1]='    S0 --> S1 -. externally configured push .-> S2 --> S3 --> S4'
        for i,(label,role) in enumerate(branches):
            lines.append(f'    B{i}["{label}: {role}"]')
        lines+=['    S0 -. condition .-> B0','    S2 -. source note .-> B1']
        if name=='dynamic-reporting':
            lines[-2:]=['    S1 --> B0','    B0 -->|object count ready| B1']
        if name=='monitoring-file-setup':
            lines[-2:]=['    S2 -->|already exists; preserve contents| B0','    S4 -. later triggers / UI .-> B1']
        if name=='report-distribution':
            lines[-2]='    S2 -. selected category .-> B0'
        if name=='sql-excel-sync':
            lines[-2]='    S1 -. grouping .-> B0'
        if name in ('daily-project-report','pdf-watermarking'):
            lines[-2]='    S1 -. condition .-> B0'
        if name=='pdf-watermarking':
            lines[-1]='    S1 -. output collision .-> B1'
        (OUT/(name+'.mmd')).write_text('\n'.join(lines)+'\n')
    print(f'Built {len(DIAGRAMS)} diagram sources and offline HTML')


if __name__=='__main__':
    main()
