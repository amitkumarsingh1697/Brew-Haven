#!/usr/bin/env python3
"""Turns an AI-generated barista clip (uneven green backdrop, e.g. from Wan 2.2) into a clip for the
3D welcome scene: the backdrop becomes flat #00b140 so the in-app key works, cropped head to waist,
540 px wide, 24 fps, silent. Needs ffmpeg and numpy.

  tools/barista-ai-clip.py <in.mp4> <out.mp4> [--loop] [--crop=W:H:X:Y]

The matte keys on how much greener a pixel is than its red and blue, so white shirts, black hair
and the brown apron stay solid (a plain chroma key removes them along with the backdrop).
--loop plays the clip forwards then backwards so an idle clip repeats without a jump.
See docs/delivery/BARISTA_VIDEO.md.
"""
import json, subprocess, sys
import numpy as np

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) != 2:
    sys.exit(__doc__)
src, dst = args
loop = "--loop" in sys.argv
crop = next((a[7:] for a in sys.argv if a.startswith("--crop=")), "480:620:0:60")

probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate", "-of", "json", src], capture_output=True, check=True).stdout)["streams"][0]
w, h, fps = probe["width"], probe["height"], probe["r_frame_rate"]
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    capture_output=True, check=True).stdout
f = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32)
r, g, b = f[..., 0], f[..., 1], f[..., 2]
bg = np.clip((g - np.maximum(r, b) - 18) / 22, 0, 1)[..., None]  # 1 = backdrop
fg = f.copy()
fg[..., 1] = np.minimum(g, np.maximum(r, b) + 4)  # pull green spill off the edges
out = (fg * (1 - bg) + np.array([0, 177, 64], np.float32) * bg).clip(0, 255).astype(np.uint8)

cw, ch = (int(x) for x in crop.split(":")[:2])
size = f"540:{round(540 * ch / cw / 2) * 2}"
chain = f"crop={crop},fps=24,scale={size}:flags=lanczos"
graph = f"[0:v]{chain},split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]" if loop else f"[0:v]{chain}[v]"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", fps,
    "-i", "-", "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-profile:v", "main",
    "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "slow", "-movflags", "+faststart", dst],
    input=out.tobytes(), check=True)
print(dst)
