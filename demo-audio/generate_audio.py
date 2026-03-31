#!/usr/bin/env /tmp/tts-env/bin/python3
"""Generate demo voiceover audio using edge-tts (Microsoft Andrew voice)"""

import asyncio
import json
import os
import subprocess

VOICE = "en-US-AndrewNeural"
SPEED_FACTOR = 1.15  # Speed up slightly
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "synced")

async def generate_section(section):
    """Generate TTS audio for one section"""
    import edge_tts

    sid = section["id"]
    text = section["text"]
    raw_path = os.path.join(OUTPUT_DIR, f"{sid}_raw.mp3")
    final_path = os.path.join(OUTPUT_DIR, f"{sid}.mp3")

    print(f"  Generating {sid}...")
    communicate = edge_tts.Communicate(text, VOICE, rate="+5%")
    await communicate.save(raw_path)

    # Speed up with ffmpeg
    subprocess.run([
        "ffmpeg", "-y", "-i", raw_path,
        "-filter:a", f"atempo={SPEED_FACTOR}",
        "-q:a", "2", final_path
    ], capture_output=True)

    os.remove(raw_path)

    # Get duration
    result = subprocess.run([
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "csv=p=0", final_path
    ], capture_output=True, text=True)
    duration = float(result.stdout.strip())
    print(f"  {sid}: {duration:.1f}s")
    return sid, duration


async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(os.path.join(SCRIPT_DIR, "scripts.json")) as f:
        scripts = json.load(f)

    print(f"Generating {len(scripts['sections'])} sections with {VOICE}...")
    print(f"Speed factor: {SPEED_FACTOR}x\n")

    total = 0
    for section in scripts["sections"]:
        sid, dur = await generate_section(section)
        total += dur

    print(f"\nTotal voiceover: {total:.1f}s ({total/60:.1f} min)")
    print(f"Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
