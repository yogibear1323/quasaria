#!/bin/bash
# sheet.sh video.mp4 out.jpg [n]
n=${3:-8}; d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"); fps=$(python3 -c "print($n/$d)")
ffmpeg -v error -y -i "$1" -vf "fps=$fps,scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2:color=white,tile=4x$(( (n+3)/4 ))" -frames:v 1 "$2"
