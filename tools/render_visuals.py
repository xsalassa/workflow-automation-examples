"""Capture authored local diagram HTML in both themes and check its layout."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser',type=Path,help='Optional existing Chromium executable')
    parser.add_argument('--report',type=Path,help='Optional local verification report')
    args=parser.parse_args()
    results=[]
    with sync_playwright() as p:
        launch={'headless':True}
        if args.browser:
            launch['executable_path']=str(args.browser)
        browser=p.chromium.launch(**launch)
        page=browser.new_page(viewport={'width':1200,'height':1000},device_scale_factor=2)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
        page.goto((ROOT/'assets/flows/visuals.html').as_uri())
        loaded=page.locator('svg image').evaluate_all('''nodes => Promise.all(nodes.map(node => new Promise(resolve => {
          const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0);
          image.onerror = () => resolve(false); image.src = node.getAttribute('href');
        })))''')
        assert loaded and all(loaded),'Missing or undecodable service icon'
        for theme in ('light','dark'):
            page.emulate_media(color_scheme=theme,reduced_motion='reduce')
            for section in page.locator('.capture').all():
                name=section.get_attribute('data-name')
                clipped=section.locator('.node').evaluate_all('''nodes => nodes.flatMap(node => {
                  const rect = node.querySelector('rect').getBBox();
                  return [...node.querySelectorAll('text')].filter(text => {
                    const b = text.getBBox();
                    return b.x < rect.x || b.x+b.width > rect.x+rect.width || b.y < rect.y || b.y+b.height > rect.y+rect.height;
                  }).map(text => text.textContent);
                })''')
                assert not clipped,clipped
                suffix='-dark' if theme=='dark' else ''
                section.screenshot(path=str(ROOT/'assets/flows'/f'{name}{suffix}.png'))
                results.append({'figure':name,'theme':theme,'captured':True})
        page.emulate_media(color_scheme='light')
        for width in (390,768,1200):
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),f'Page overflow at {width}'
            for link in page.locator('nav a').all():
                target=link.get_attribute('href')
                link.click()
                assert page.evaluate('location.hash')==target
            results.append({'viewport':width,'navigation_links':page.locator('nav a').count(),'overflow':False})
        page.keyboard.press('Tab')
        assert page.locator(':focus-visible').count()>0,'Missing keyboard focus indicator'
        page.locator('footer a[href="../../THIRD_PARTY_NOTICES.md"]').click()
        assert page.url.endswith('/THIRD_PARTY_NOTICES.md')
        results.append({'footer_attribution_link':'opened existing local notice'})
        assert not errors,errors
        comparison=ROOT/'assets/synthetic-examples/watermark-demo.html'
        if comparison.exists():
            page.set_viewport_size({'width':1100,'height':1100})
            page.goto(comparison.as_uri())
            page.locator('.capture').screenshot(path=str(comparison.with_suffix('.png')))
            assert all(image.evaluate('(el)=>el.complete && el.naturalWidth > 0') for image in page.locator('img').all())
            for width in (390,768,1100):
                page.set_viewport_size({'width':width,'height':1100})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            results.append({'synthetic_watermark_comparison':'captured','images_loaded':True})
        browser.close()
    if args.report:
        args.report.write_text(json.dumps({'checks':results,'console_errors':errors},indent=2))
    print(json.dumps({'diagrams':sum('figure' in result for result in results),'checks':len(results),'console_errors':errors}))


if __name__=='__main__':
    main()
