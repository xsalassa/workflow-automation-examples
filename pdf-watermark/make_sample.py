"""Create synthetic PDF and neutral sample-mark fixtures in a new directory."""

import argparse
from pathlib import Path

import pymupdf


def make_sample(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    with pymupdf.open() as doc:
        for heading in ['Synthetic report', 'Synthetic appendix']:
            page = doc.new_page(width=420, height=540)
            page.insert_text((32, 48), heading, fontsize=22, color=(0.1,0.15,0.2))
            page.insert_text((32, 80), 'Demonstration data only. No business or personal records.',fontsize=10)
            page.insert_text((32, 130), 'Item: generated example\nStatus: prepared locally\nOwner: example role',fontsize=12)
            page.draw_line((32, 180),(388,180),color=(0.7,0.75,0.8))
            page.insert_text((32, 505),'Not a signature or an approval record.',fontsize=10)
        doc.save(directory/'input.pdf')
    with pymupdf.open() as doc:
        page = doc.new_page(width=160,height=60)
        page.draw_rect(pymupdf.Rect(3,3,157,57),color=(0.1,0.35,0.3),width=2)
        page.insert_text((23,39),'SAMPLE',fontsize=26,color=(0.1,0.35,0.3))
        page.get_pixmap(matrix=pymupdf.Matrix(2,2)).save(directory/'mark.png')
    return directory


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    args=parser.parse_args()
    make_sample(args.directory)
