#!/bin/bash
# mux.sh video_only_or_new.mp4 original.mp4 out.mp4 : take video from $1, audio from original $2
ffmpeg -y -v error -i "$1" -i "$2" -map 0:v -map 1:a -c copy -shortest -movflags +faststart "$3" && rm -f "$1"
