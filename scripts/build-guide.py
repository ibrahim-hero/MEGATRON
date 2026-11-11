"""Generate the branded implementation guide on the project drive."""
from pathlib import Path
import re, shutil, textwrap
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Preformatted, Image, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
FONT = Path('C:/Windows/Fonts')
if (FONT / 'segoeui.ttf').exists():
    for name, file in [('Body','segoeui.ttf'),('Bold','segoeuib.ttf'),('Mono','consola.ttf')]:
        pdfmetrics.registerFont(TTFont(name,str(FONT/file)))
    registerFontFamily('Body',normal='Body',bold='Bold',italic='Body',boldItalic='Bold')
else:
    pdfmetrics.registerFontFamily('Body',normal='Helvetica',bold='Helvetica-Bold',italic='Helvetica-Oblique',boldItalic='Helvetica-BoldOblique')
    Body, Bold, Mono = 'Helvetica','Helvetica-Bold','Courier'
INK = colors.HexColor('#17223b'); BLUE = colors.HexColor('#3450d6'); MUTED = colors.HexColor('#596784'); NAVY = colors.HexColor('#0e1526')
body = ParagraphStyle('body',fontName='Body' if (FONT/'segoeui.ttf').exists() else 'Helvetica',fontSize=9.5,leading=14,textColor=INK,spaceAfter=6)
bold = 'Bold' if (FONT/'segoeui.ttf').exists() else 'Helvetica-Bold'
mono = 'Mono' if (FONT/'consola.ttf').exists() else 'Courier'
h1 = ParagraphStyle('heading',parent=body,fontName=bold,fontSize=22,leading=27,textColor=INK,spaceAfter=13,keepWithNext=True)
h2 = ParagraphStyle('subheading',parent=body,fontName=bold,fontSize=13,leading=18,textColor=BLUE,spaceBefore=12,spaceAfter=6,keepWithNext=True)
code = ParagraphStyle('code',fontName=mono,fontSize=7.5,leading=10,textColor=colors.HexColor('#dbe5ff'))
small = ParagraphStyle('small',parent=body,fontSize=8,leading=11,textColor=MUTED)

def inline(text):
    text=escape(text)
    text=re.sub(r'\[([^\]]+)\]\([^)]+\)',r'\1',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'`([^`]+)`',lambda m:'<font name="'+mono+'">'+m.group(1)+'</font>',text)
    return text

def furniture(canvas, doc):
    if doc.page==1:
        canvas.setFillColor(NAVY);canvas.rect(0,0,A4[0],A4[1],fill=1,stroke=0)
        canvas.setFillColor(colors.HexColor('#4d6bfe'));canvas.roundRect(42,731,51,51,12,fill=1,stroke=0)
        canvas.setFillColor(colors.white);canvas.setFont(bold,30);canvas.drawString(51,741,'M')
        canvas.setFont(bold,32);canvas.drawString(110,745,'MEGATRON')
        canvas.setFillColor(colors.HexColor('#b8c7ed'));canvas.setFont(body.fontName,11);canvas.drawString(44,694,'PRODUCT · IMPLEMENTATION · UI / UX · OPERATIONS')
        canvas.setFillColor(colors.white);canvas.setFont(bold,26);canvas.drawString(44,633,'Less oversight. More outcomes.')
        canvas.setFillColor(colors.HexColor('#b8c7ed'));canvas.setFont(body.fontName,11);canvas.drawString(44,607,'Evidence-first autonomous engineering. Version 1.0.0')
        image=ROOT/'assets/screenshots/mission-control.png'
        if image.exists():canvas.drawImage(str(image),44,199,width=507,height=350,preserveAspectRatio=True,anchor='c',mask='auto')
        canvas.setFillColor(colors.HexColor('#e8a33d'));canvas.setFont(bold,10);canvas.drawString(44,155,'REAL SOURCE CHANGES. EXECUTED CHECKS. REVIEWABLE DELIVERY.')
        canvas.setFillColor(colors.HexColor('#b8c7ed'));canvas.setFont(body.fontName,9);canvas.drawString(44,121,'The default demonstration is explicitly scripted; its execution and evidence are real.')
        canvas.drawString(44,106,'Use a configured provider to measure live engineering performance on the same tasks.')
        canvas.setFillColor(colors.HexColor('#7587af'));canvas.setFont(body.fontName,8);canvas.drawString(44,47,'Prepared for MEGATRON · source, documentation, screenshots, demo, and installable extension')
    else:
        canvas.setFillColor(MUTED);canvas.setFont(bold,8);canvas.drawString(42,808,'MEGATRON  /  PRODUCT AND OPERATING GUIDE')
        canvas.setStrokeColor(colors.HexColor('#d5ddeb'));canvas.line(42,798,553,798);canvas.line(42,38,553,38)
        canvas.setFont(body.fontName,8);canvas.drawString(42,24,'v1.0.0 · Evidence-first engineering');canvas.drawRightString(553,24,str(doc.page))

story=[Spacer(1,1),PageBreak(),Paragraph('The plan, in runnable form.',h1),Paragraph('This guide combines product direction, the implemented capability ledger, the operating instructions, and the interface design. The original planning PDF is included separately as a historical reference; its targets are not presented as measured results.',body)]
for i,(title,name) in enumerate([('Product and UI / UX','PRODUCT.md'),('Plan-to-code traceability','IMPLEMENTATION.md'),('How to use MEGATRON','USAGE.md'),('Architecture and recovery','ARCHITECTURE.md'),('Integrations','INTEGRATIONS.md'),('HTTP API','API.md'),('Testing and validation','TESTING.md')]):
    story += [Spacer(1,12),Paragraph(f'{i+1}. {title}',h2)]
    story.append(Paragraph(f'Source: docs/{name}',small))
story.append(PageBreak())
for title,name in [('Product and UI / UX','PRODUCT.md'),('Plan-to-code traceability','IMPLEMENTATION.md'),('How to use MEGATRON','USAGE.md'),('Architecture and recovery','ARCHITECTURE.md'),('Integrations','INTEGRATIONS.md'),('HTTP API','API.md'),('Testing and validation','TESTING.md')]:
    story.append(Paragraph(title,h1)); lines=(DOCS/name).read_text(encoding='utf-8').splitlines();i=1
    while i<len(lines):
        line=lines[i];i+=1
        if not line.strip():continue
        if line.startswith('```'):
            block=[]
            while i<len(lines) and not lines[i].startswith('```'):
                block.extend(textwrap.wrap(lines[i],width=92,replace_whitespace=False,drop_whitespace=False) or ['']);i+=1
            i+=1
            # Code backgrounds are real table surfaces, rather than unsupported Preformatted background hints.
            box=Table([[Preformatted('\n'.join(block),code)]],colWidths=[499]);box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),NAVY),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]));story += [box,Spacer(1,9)];continue
        if line.startswith('## '):story.append(Paragraph(inline(line[3:]),h2));continue
        if line.startswith('|'):
            rows=[line]
            while i<len(lines) and lines[i].startswith('|'):rows.append(lines[i]);i+=1
            data=[[Paragraph(inline(c.strip()),small) for c in row.strip('|').split('|')] for row in rows if not re.match(r'^\|[ :|-]+\|$',row)]
            if data:
                count=len(data[0]);data=[r for r in data if len(r)==count];table=Table(data,colWidths=[499/count]*count,repeatRows=1)
                table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8edfc')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f4f6fb')]),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#d5ddeb')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));story += [table,Spacer(1,9)]
            continue
        story.append(Paragraph(inline(line),body))
    if name=='PRODUCT.md':
        for caption,file in [('Executed verification','verification.png'),('Evidence-bound review','delivery-review.png'),('Source-cited project knowledge','project-knowledge.png'),('Responsive mobile surface','mobile-mission-control.png')]:
            image=ROOT/'assets/screenshots'/file
            if image.exists():
                story += [PageBreak(),Paragraph(caption,h2)]
                from PIL import Image as PILImage
                with PILImage.open(image) as im:w,h=im.size
                scale=min(499/w,640/h);story += [Image(str(image),width=w*scale,height=h*scale),Spacer(1,8),Paragraph('Captured from the running MEGATRON application. Demonstration mode is labeled; checks and artifacts are executed.',small)]
    story.append(PageBreak())
target=DOCS/'MEGATRON-Product-Guide.pdf'
SimpleDocTemplate(str(target),pagesize=A4,leftMargin=42,rightMargin=42,topMargin=58,bottomMargin=49,title='MEGATRON — Product and Operating Guide',author='MEGATRON').build(story,onFirstPage=furniture,onLaterPages=furniture)
original=ROOT.parent/'DSH-Superagent-Vision-Evaluation-Roadmap-UIUX.pdf'
if original.exists():shutil.copyfile(original,DOCS/'MEGATRON-Original-Plan.pdf')
print(f'Generated {target}')
