#!/usr/bin/env bash
# Turns a phone video of the barista (filmed against a green screen) into a clip for the 3D
# welcome scene: trimmed, portrait 540x960, 24 fps, no sound, small enough for phones.
#
#   tools/barista-clip.sh <input> <output.mp4> [start-seconds] [length-seconds] [--loop]
#
# --loop plays the clip forwards then backwards, so an idle clip repeats without a jump.
# See docs/delivery/BARISTA_VIDEO.md.
set -euo pipefail
in=${1:?input video}; out=${2:?output .mp4}; start=${3:-0}; len=${4:-4}; loop=${5:-}
scale="scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=24"
if [[ "$loop" == "--loop" ]]; then
  filter="[0:v]$scale,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]"
else
  filter="[0:v]$scale[v]"
fi
ffmpeg -loglevel error -y -ss "$start" -t "$len" -i "$in" -filter_complex "$filter" -map "[v]" -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 26 -preset slow -movflags +faststart "$out"
echo "$out: $(du -h "$out" | cut -f1)"
