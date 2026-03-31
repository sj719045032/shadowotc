#!/usr/bin/env /tmp/tts-env/bin/python3
"""ShadowOTC Demo - Voice playback with timed action prompts
No mouse automation. You operate the browser manually.
Press SPACE to advance to next section.
"""

import time, subprocess, os, threading
from pynput import keyboard

AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "synced")

# Each section: (mp3, [(time_sec, prompt), ...])
# Prompts appear at the given time offset during audio playback
SECTIONS = [
    ("01_intro.mp3", [
        (0,  "👀 Show Order Book page"),
        (5,  "👀 Hover over stats: Total Orders, Filled, Open"),
        (10, "👀 Hover over order table rows"),
    ]),
    ("02_vault_wrap.mp3", [
        (0,  "🖱  Click Vault in nav"),
        (4,  "🖱  Show token selector (ETH)"),
        (7,  "⌨️  Type 0.1 in amount input"),
        (10, "🖱  Click Wrap button"),
        (12, "🦊 Confirm MetaMask TX"),
    ]),
    ("03_vault_decrypt.mp3", [
        (0,  "⏳ Wait for wrap to confirm"),
        (3,  "🖱  Click Decrypt button"),
        (5,  "🦊 Confirm MetaMask signature"),
        (8,  "👀 Show decrypted cWETH + cUSDC balances"),
    ]),
    ("04_create_order.mp3", [
        (0,  "🖱  Click Create Order in nav"),
        (3,  "🖱  Click SELL tab"),
        (5,  "⌨️  Enter price: 10"),
        (7,  "⌨️  Enter amount: 0.1"),
        (10, "🖱  Click Create Order button"),
        (12, "🦊 Confirm MetaMask TX"),
    ]),
    ("05_taker_view.mp3", [
        (0,  "🦊 Switch MetaMask to TAKER account"),
        (3,  "🖱  Click Order Book in nav"),
        (5,  "👀 Show orders — Encrypted prices, purple/green labels"),
        (8,  "🖱  Click on the new SELL order"),
    ]),
    ("06_request_access.mp3", [
        (0,  "🖱  Click Request Access button"),
        (3,  "🦊 Confirm MetaMask TX"),
        (5,  "🦊 Switch to MAKER account"),
        (7,  "🖱  Grant access to taker"),
        (9,  "🦊 Switch back to TAKER account"),
    ]),
    ("07_decrypt_order.mp3", [
        (0,  "🖱  Click Decrypt Order Details"),
        (3,  "🦊 Confirm MetaMask signature"),
        (6,  "👀 Show decrypted price, amount, remaining"),
        (9,  "👀 Scroll down to show settlement preview + balance"),
    ]),
    ("08_fill_order.mp3", [
        (0,  "👀 Show fill amount (pre-populated)"),
        (3,  "👀 Show settlement preview: You pay / You receive / Your balance"),
        (6,  "🖱  Click Fill Order"),
        (8,  "🦊 Confirm initiateFill TX"),
        (12, "⏳ Wait for TX1 + Gateway decrypt"),
        (15, "🦊 Confirm settleFill TX"),
    ]),
    ("09_settlement.mp3", [
        (0,  "⏳ Wait for settlement to complete"),
        (3,  "👀 Show success in modal"),
        (6,  "🖱  Close modal"),
        (9,  "👀 Show updated order status"),
    ]),
    ("10_history.mp3", [
        (0,  "🖱  Click Vault in nav"),
        (3,  "👀 Scroll down to transfer history"),
        (6,  "👀 Show Encrypted amounts"),
        (9,  "🖱  Click Decrypt Amounts"),
        (11, "🦊 Confirm MetaMask signature"),
        (14, "👀 Show decrypted transfer amounts"),
    ]),
    ("11_architecture.mp3", [
        (0,  "👀 Stay on current page — just listen"),
    ]),
    ("12_closing.mp3", [
        (0,  "🖱  Click Order Book for final shot"),
        (5,  "👀 Show the completed order book"),
        (10, "👀 Hover over stats"),
        (15, "👀 Stay centered — closing"),
    ]),
]

# ── Space key ──
_space = threading.Event()
def _on_press(key):
    if key == keyboard.Key.space: _space.set()
keyboard.Listener(on_press=_on_press, daemon=True).start()

def wait_space():
    _space.clear(); _space.wait()

# ── Audio ──
_proc = None
def play(mp3):
    global _proc
    if _proc and _proc.poll() is None: _proc.terminate()
    _proc = subprocess.Popen(["afplay", os.path.join(AUDIO_DIR, mp3)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_audio():
    if _proc: _proc.wait()

# ── Main ──
print("=" * 50)
print("  ShadowOTC Demo Voice Player")
print("=" * 50)
print()
print("  Start QuickTime recording, then press SPACE")
print()
wait_space()

for i, (mp3, prompts) in enumerate(SECTIONS):
    print(f"\n{'─' * 50}")
    print(f"  [{i+1}/{len(SECTIONS)}]")
    print(f"{'─' * 50}")

    play(mp3)
    t0 = time.time()

    # Print prompts at timed intervals during audio
    for j, (sec, prompt) in enumerate(prompts):
        # Wait until the right time
        elapsed = time.time() - t0
        wait = sec - elapsed
        if wait > 0: time.sleep(wait)
        print(f"  {prompt}")

    wait_audio()

    if i < len(SECTIONS) - 1:
        print(f"\n  ⏸  SPACE → next section")
        wait_space()

print(f"\n{'=' * 50}")
print("  ✅ Done! Stop recording.")
print(f"{'=' * 50}")
