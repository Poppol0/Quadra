"""Generate the shareable PDF from the branch changelog. Requires reportlab/pypdf."""
from pathlib import Path
import re
import sys
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dist/pdf-tools'))
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether, Preformatted
from pypdf import PdfReader

SOURCE = ROOT / 'docs/CHANGELOG_feat-online-version.md'
DEST = ROOT / 'docs/CHANGELOG_feat-online-version.pdf'
fonts = Path('C:/Windows/Fonts')
if (fonts / 'arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Quadra', str(fonts / 'arial.ttf')))
    pdfmetrics.registerFont(TTFont('QuadraBold', str(fonts / 'arialbd.ttf')))
    pdfmetrics.registerFontFamily('Quadra', normal='Quadra', bold='QuadraBold', italic='Quadra', boldItalic='QuadraBold')
else:
    raise RuntimeError('Configure a TrueType font for this host')

green = colors.HexColor('#1D4A35')
body = ParagraphStyle('body', fontName='Quadra', fontSize=10, leading=15, textColor=colors.HexColor('#243D32'), spaceAfter=9)
title = ParagraphStyle('title', parent=body, fontName='QuadraBold', fontSize=27, leading=32, textColor=green, spaceAfter=22)
h2 = ParagraphStyle('h2', parent=body, fontName='QuadraBold', fontSize=16, leading=21, spaceBefore=12, spaceAfter=12, keepWithNext=True)
h3 = ParagraphStyle('h3', parent=body, fontName='QuadraBold', fontSize=11, leading=16, spaceBefore=10, spaceAfter=7, keepWithNext=True)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=13, firstLineIndent=-10, spaceAfter=7)
code_style = ParagraphStyle('code',fontName='Courier',fontSize=8,leading=12,backColor=colors.HexColor('#F1F5F2'),borderPadding=10,spaceBefore=8,spaceAfter=16)

def markup(text):
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', escape(text))

def page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(green)
    canvas.rect(0, height-8, width, 8, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor('#627569'))
    canvas.setFont('Quadra', 8)
    canvas.drawRightString(width-48, 25, str(doc.page))
    canvas.restoreState()

story = []
paragraph = []
code = None
def flush():
    if paragraph:
        story.append(Paragraph(markup(' '.join(paragraph)), body)); paragraph.clear()

for line in SOURCE.read_text(encoding='utf-8').splitlines():
    if line.startswith('```'):
        flush()
        if code is None: code = []
        else: story.append(Preformatted('\n'.join(code),code_style)); code = None
        continue
    if code is not None: code.append(line); continue
    if not line.strip(): flush(); continue
    if line == '---': flush(); story.append(PageBreak()); continue
    if line.startswith('# '): flush(); story.append(Paragraph(markup(line[2:]),title)); continue
    if line.startswith('## '): flush(); story.append(Paragraph(markup(line[3:]),h2)); continue
    if line.startswith('### '): flush(); story.append(Paragraph(markup(line[4:]),h3)); continue
    if line.startswith('- '): flush(); story.append(Paragraph('- '+markup(line[2:]),bullet)); continue
    if re.match(r'^\d+\. ', line): flush(); story.append(Paragraph(markup(line),bullet)); continue
    if line.startswith('**Ramo:') or line.startswith('**Data:') or line.startswith('**Stato:'):
        flush(); story.append(Paragraph(markup(line.strip()),body)); continue
    paragraph.append(line.strip())
flush()
doc = SimpleDocTemplate(str(DEST),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=53,bottomMargin=53,
    title='Quadra - Changelog feat/online-version',author='Quadra',subject='Modifiche, verifiche e prossimi sviluppi')
doc.build(story,onFirstPage=page,onLaterPages=page)
reader = PdfReader(DEST)
print(f'{DEST}: {len(reader.pages)} pages')
for number, pdf_page in enumerate(reader.pages,1):
    text = pdf_page.extract_text()
    if len(text.strip()) < 100: raise RuntimeError(f'Unexpected empty page {number}')
    print(f'Page {number}: {len(text)} characters')
