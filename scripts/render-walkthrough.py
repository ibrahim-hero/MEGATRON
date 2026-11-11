"""Render a bounded walkthrough from verified captures of actual application states."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess, shutil
from io import BytesIO
ROOT=Path(__file__).resolve().parent.parent
frames=ROOT/'tools/video-frames';frames.mkdir(parents=True,exist_ok=True)
out=ROOT/'assets/demo';out.mkdir(parents=True,exist_ok=True)
font_path=Path('C:/Windows/Fonts/segoeuib.ttf')
font=ImageFont.truetype(str(font_path),25) if font_path.exists() else ImageFont.load_default()
slides=[('mission-control','01  /  Attention-first Mission Control'),('mission-timeline','02  /  A durable factual timeline'),('verification','03  /  Executed, fingerprint-bound verification'),('delivery-review','04  /  One evidence-backed review decision'),('project-knowledge','05  /  Source-cited project intelligence'),('mobile-mission-control','06  /  The same workbench on mobile')]
encoded=[]
for i,(name,label) in enumerate(slides):
    image=Image.open(ROOT/'assets/screenshots'/f'{name}.png').convert('RGB')
    image.thumbnail((1376,894),Image.Resampling.LANCZOS)
    canvas=Image.new('RGB',(1440,1000),'#0e1526');canvas.paste(image,((1440-image.width)//2,28))
    draw=ImageDraw.Draw(canvas);draw.line((32,942,1408,942),fill='#344462',width=1)
    draw.text((35,959),label,fill='#edf2ff',font=font)
    canvas.save(frames/f'frame-{i:02d}.png')
    buffer=BytesIO();canvas.save(buffer,format='JPEG',quality=88);encoded.append(buffer.getvalue())
exe=shutil.which('ffmpeg')
if not exe:
    candidates=list((ROOT/'tools/browsers').glob('ffmpeg-*/ffmpeg*.exe'))
    if candidates:exe=str(candidates[0])
if not exe:raise SystemExit('Install ffmpeg or Playwright’s ffmpeg helper to render the walkthrough.')
target=out/'megatron-walkthrough.webm'
subprocess.run([exe,'-hide_banner','-loglevel','error','-f','image2pipe','-framerate','24','-c:v','mjpeg','-i','pipe:0','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-b:v','1600k','-an','-y',str(target)],input=b''.join(frame*72 for frame in encoded),check=True,timeout=90)
print(f'Rendered 18-second walkthrough of actual captured app states: {target}')
