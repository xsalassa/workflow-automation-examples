"""Generate offline action explorers from the published sanitized definitions."""
import html
import json
import argparse
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def extract_scopes(definition):
    scopes = []
    declared = set()

    def visit(actions, title, path, triggers=None):
        nodes = []
        scope = {'id': path, 'title': title, 'nodes': nodes, 'edges': []}
        scopes.append(scope)
        for name, action in {**(triggers or {}), **actions}.items():
            if name in declared:
                raise ValueError('Duplicate declaration: ' + name)
            declared.add(name)
            inputs = action.get('inputs', {})
            host = inputs.get('host', {}) if isinstance(inputs, dict) else {}
            node = {'id': name, 'type': action.get('type', ''),
                    'operation': host.get('operationId', ''), 'connector': host.get('apiId', ''),
                    'trigger': name in (triggers or {}), 'detail': action, 'children': []}
            nodes.append(node)
            children = []
            if action.get('actions'):
                children.append(('True branch' if action.get('type') == 'If' else 'Actions', action['actions']))
            if action.get('else', {}).get('actions'):
                children.append(('False branch', action['else']['actions']))
            for case_name, case in action.get('cases', {}).items():
                if case.get('actions'):
                    children.append(('Case: ' + case_name, case['actions']))
            if action.get('default', {}).get('actions'):
                children.append(('Default branch', action['default']['actions']))
            for index, (label, nested) in enumerate(children):
                child_path = path + '/' + name + '/' + str(index)
                node['children'].append({'label': label, 'scope': child_path})
                visit(nested, name + ' / ' + label, child_path)
        ids = {node['id'] for node in nodes}
        for name, action in actions.items():
            for before, statuses in action.get('runAfter', {}).items():
                if before not in ids:
                    raise ValueError('Dependency outside sibling scope: ' + before)
                scope['edges'].append({'from': before, 'to': name, 'statuses': statuses})
            if not action.get('runAfter') and triggers:
                for trigger in triggers:
                    scope['edges'].append({'from': trigger, 'to': name, 'statuses': [], 'triggerEntry': True})
    visit(definition['actions'], 'Workflow entry', 'root', definition['triggers'])
    return scopes


STYLE = '''
:root{color-scheme:light dark;--paper:#fff;--panel:#f4f7f8;--ink:#172b3a;--muted:#4b5e6d;--accent:#146b57;--line:#788991;--tile:#fff}
@media(prefers-color-scheme:dark){:root{--paper:#14222b;--panel:#20333e;--ink:#f1f5f7;--muted:#c1ced5;--accent:#83d8c0;--line:#aab9c3}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,sans-serif}header,main,footer{padding:20px 28px}header{border-bottom:1px solid var(--line)}h1{font-size:28px;line-height:1.25;margin:0 0 12px}h2{font-size:20px;margin:0 0 10px}p{max-width:980px;margin:8px 0}a{color:var(--accent);text-underline-offset:3px}a:hover{text-decoration-thickness:3px}button,select{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:10px;min-height:44px;max-width:100%}button{cursor:pointer}button:hover,button[aria-pressed=true]{border-color:var(--accent);background:var(--paper)}button:active{transform:translateY(1px)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:16px 0}.toolbar label{font-weight:600}.toolbar select{max-width:min(100%,650px)}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:24px}.graph{overflow:auto;border:1px solid var(--line);background:var(--panel);max-height:72vh;min-height:300px;position:relative}.canvas{position:relative}.canvas svg{position:absolute;inset:0;pointer-events:none}.edge{fill:none;stroke:var(--accent);stroke-width:1.8}.edge.trigger{stroke:var(--line);stroke-dasharray:5 4}.node{position:absolute;width:208px;min-height:105px;text-align:left;padding:10px;background:var(--paper);display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;align-content:start}.node img{background:var(--tile);border-radius:3px;object-fit:contain}.node strong{font-size:13px;overflow-wrap:anywhere}.node small{display:block;color:var(--muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}.detail{min-width:0}.detail p{overflow-wrap:anywhere}.detail button{margin:4px 6px 4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel);padding:16px;border:1px solid var(--line);max-height:65vh;overflow:auto;font-size:12px}.note{color:var(--muted);font-size:13px}details{margin:18px 0}summary{cursor:pointer;min-height:44px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid var(--line);text-align:left;padding:8px;overflow-wrap:anywhere}footer{border-top:1px solid var(--line);font-size:13px}.inventory{overflow:auto}@media(max-width:900px){.workspace{grid-template-columns:1fr}.graph{max-height:55vh}header,main,footer{padding:16px}h1{font-size:25px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
'''

SCRIPT = r'''
const data=JSON.parse(document.getElementById('flow-data').textContent);
const scopes=new Map(data.scopes.map(s=>[s.id,s]));
const picker=document.getElementById('scope');
const graph=document.getElementById('graph');
const panel=document.getElementById('detail');
let active='root';
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function icon(node){const c=node.connector;for(const [part,key] of [['onedrive','onedrive'],['excel','excel'],['sql','sql'],['teams','teams'],['outlook','outlook'],['approvals','check']])if(c.includes(part))return key;return ['If','Switch'].includes(node.type)?'branch':node.type==='Foreach'?'archive':node.trigger?'automate':'file';}
function inspect(node){
 document.querySelectorAll('.node').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===node.id)));
 const selected=[...document.querySelectorAll('.node')].find(b=>b.dataset.id===node.id);
 if(selected)graph.scrollTo({left:Math.max(0,selected.offsetLeft-24),top:Math.max(0,selected.offsetTop-24)});
 panel.replaceChildren(element('h2',node.id),element('p',node.operation||node.type),element('p',node.connector||'Built-in workflow action','note'));
 for(const child of node.children){const b=element('button','Open '+child.label);b.onclick=()=>show(child.scope);panel.append(b);}
 const detail=element('details');detail.open=true;detail.append(element('summary','Sanitized action JSON'),element('pre',JSON.stringify(node.detail,null,2)));panel.append(detail);
 document.getElementById('status').textContent='Selected '+node.id;
}
function show(id){
 active=id;picker.value=id;const scope=scopes.get(id);graph.replaceChildren();
 document.getElementById('scope-title').textContent=scope.title;
 const levels=new Map();const pending=new Set(scope.nodes.map(n=>n.id));
 while(pending.size){let progressed=false;for(const name of [...pending]){const before=scope.edges.filter(e=>e.to===name).map(e=>e.from);if(before.every(x=>levels.has(x))){levels.set(name,before.length?1+Math.max(...before.map(x=>levels.get(x))):0);pending.delete(name);progressed=true;}}if(!progressed)throw Error('Cyclic dependency in '+scope.title);}
 const columns=new Map();const positions=new Map();for(const node of scope.nodes){const level=levels.get(node.id);const row=columns.get(level)||0;columns.set(level,row+1);positions.set(node.id,{x:24+level*270,y:24+row*156});}
 const width=Math.max(480,48+(Math.max(0,...levels.values())+1)*270);const height=Math.max(300,48+Math.max(1,...columns.values())*156);
 const canvas=element('div',undefined,'canvas');canvas.style.width=width+'px';canvas.style.height=height+'px';
 const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('width',width);svg.setAttribute('height',height);
 const defs=document.createElementNS(ns,'defs');defs.innerHTML='<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker>';svg.append(defs);
 for(const edge of scope.edges){
  const a=positions.get(edge.from),b=positions.get(edge.to);
  const path=document.createElementNS(ns,'path');const start=a.x+212,end=b.x-5,middle=end-22;
  const route=b.x-a.x>270?`M${start} ${a.y+44} H${start+15} V10 H${middle} V${b.y+44} H${end}`:`M${start} ${a.y+44} H${middle} V${b.y+44} H${end}`;
  path.setAttribute('d',route);path.setAttribute('class','edge'+(edge.triggerEntry?' trigger':''));path.setAttribute('marker-end','url(#arrow)');
  const title=document.createElementNS(ns,'title');title.textContent=edge.triggerEntry?'Trigger entry (inferred from empty runAfter)':edge.statuses.join(', ');path.append(title);svg.append(path);
 }
 canvas.append(svg);
 for(const node of scope.nodes){const pos=positions.get(node.id);const b=element('button',undefined,'node');b.dataset.id=node.id;b.style.left=pos.x+'px';b.style.top=pos.y+'px';b.setAttribute('aria-pressed','false');const img=element('img');img.src=data.icons[icon(node)];img.width=32;img.height=32;img.alt='';const label=element('span');label.append(element('strong',node.id),element('small',node.operation||node.type),element('small',node.trigger?'Trigger':node.children.length+' nested branches'));b.append(img,label);b.onclick=()=>inspect(node);canvas.append(b);}
 graph.append(canvas);graph.scrollTo(0,0);
 const tbody=document.getElementById('edges');tbody.replaceChildren();for(const e of scope.edges){const row=element('tr');for(const value of [e.from,e.to,e.triggerEntry?'Trigger entry (inferred)':e.statuses.join(', ')])row.append(element('td',value));tbody.append(row);}
 document.getElementById('inventory').textContent=scope.nodes.length+' nodes / '+scope.edges.length+' connections in this scope';
 if(scope.nodes.length)inspect(scope.nodes[0]);
}
for(const scope of data.scopes){const option=element('option',scope.title);option.value=scope.id;picker.append(option);}
picker.onchange=()=>show(picker.value);document.getElementById('root').onclick=()=>show('root');show('root');
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icons', type=Path, required=True, help='Temporary fetched icon directory')
    args = parser.parse_args()
    provenance = json.loads((ROOT/'assets/flows/icon-sources.json').read_text())
    icon_dir = args.icons
    keys = ['onedrive','excel','sql','teams','outlook','check','branch','archive','automate','file']
    icons = {}
    for key in keys:
        p = icon_dir/provenance[key]['file']
        mime = 'image/svg+xml' if p.suffix == '.svg' else 'image/png'
        icons[key] = 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()
    for path in sorted((ROOT/'power-automate').glob('*/definition.template.json')):
        document = json.loads(path.read_text())
        scopes = extract_scopes(document['properties']['definition'])
        total = sum(len(s['nodes']) for s in scopes)
        payload = json.dumps({'scopes': scopes, 'icons': icons}, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
        title = path.parent.name.replace('-', ' ').title()
        page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}: JSON action explorer</title><style>{STYLE}</style></head><body><header><h1>{html.escape(title)}: JSON action explorer</h1><p>{total} declared triggers/actions across {len(scopes)} scopes, extracted from the sanitized definition. Select a node to read its details; open a nested branch to inspect its own action graph.</p><p class="note">Solid lines: explicit runAfter dependencies. Dashed lines: inferred trigger entry for top-level actions with no runAfter. Dependency statuses appear in the table below. Container completion and loop iteration are Power Automate semantics, not additional invented edges.</p><p><a href="definition.template.json">Sanitized source JSON</a> · <a href="../../THIRD_PARTY_NOTICES.md">Icon attribution</a></p></header><main><div class="toolbar"><label for="scope">Action scope</label><select id="scope"></select><button id="root" type="button">Return to workflow entry</button></div><h2 id="scope-title"></h2><p id="inventory" class="note"></p><div class="workspace"><section id="graph" class="graph" tabindex="0" aria-label="Scrollable action graph"></section><aside id="detail" class="detail" aria-label="Selected action details"></aside></div><p id="status" role="status" class="note"></p><details><summary>Dependency status table for this scope</summary><div class="inventory"><table><thead><tr><th>From</th><th>To</th><th>Required status</th></tr></thead><tbody id="edges"></tbody></table></div></details><p class="note">Resource identities use generic aliases. Query and message stubs remain as supplied in the public template. No connector execution, flow import, or runtime path is claimed. Scroll within the graph to follow long chains; all actions can also be reached with Tab.</p></main><footer>Icons embedded from the same sources as the overview diagrams. Brand marks remain trademarks of their owners. Made with <a href="https://github.com/caru-ini/stack-diagram">stack-diagram</a>.</footer><script id="flow-data" type="application/json">{payload}</script><script>{SCRIPT}</script></body></html>'''
        (path.parent/'flow-details.html').write_text(page)
        print(path.parent.name, total, 'nodes', len(scopes), 'scopes')


if __name__ == '__main__':
    main()
