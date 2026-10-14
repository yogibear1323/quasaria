#!/bin/bash
# mux.sh new_video.mp4 original.mp4 out.mp4 : earthy LUT safety grade on video from $1, audio copied from original $2
ffmpeg -y -v error -i "$1" -i "$2" -map 0:v -map 1:a -vf "lut3d=/workspace/quasaria-video/earthy/earthy.cube" -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p -c:a copy -shortest -movflags +faststart "$3" && rm -f "$1"
