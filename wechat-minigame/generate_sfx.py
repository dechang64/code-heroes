#!/usr/bin/env python3
"""Generate simple sound effect WAV files for the game."""
import wave
import struct
import math
import os

OUT = "/home/z/my-project/download/code-heroes/wechat-minigame/assets/sfx"
os.makedirs(OUT, exist_ok=True)

SAMPLE_RATE = 22050

def write_wav(filename, samples):
    path = os.path.join(OUT, filename)
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = b''.join(struct.pack('<h', int(max(-32768, min(32767, s * 32767)))) for s in samples)
        w.writeframes(frames)
    print(f"  {filename}: {len(samples)/SAMPLE_RATE:.2f}s")

def tone(freq, duration, volume=0.3, decay=True):
    """Generate a simple tone with optional decay envelope."""
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 3) if decay else 1.0
        samples.append(volume * env * math.sin(2 * math.pi * freq * t))
    return samples

def sweep(f1, f2, duration, volume=0.3):
    """Frequency sweep from f1 to f2."""
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = f1 + (f2 - f1) * (i / n)
        env = math.exp(-t * 2)
        samples.append(volume * env * math.sin(2 * math.pi * freq * t))
    return samples

def noise(duration, volume=0.2, decay=True):
    """White noise burst."""
    import random
    random.seed(42)
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 5) if decay else 1.0
        samples.append(volume * env * (random.random() * 2 - 1))
    return samples

def sequence(notes, gap=0.03):
    """Sequence of tones: [(freq, duration), ...]"""
    samples = []
    for freq, dur in notes:
        samples.extend(tone(freq, dur, volume=0.35))
        samples.extend([0] * int(SAMPLE_RATE * gap))
    return samples

print("Generating sound effects...")

# 1. Footstep - short low blip
write_wav("step.wav", tone(180, 0.08, volume=0.15))

# 2. Attack - quick high sweep
write_wav("attack.wav", sweep(400, 800, 0.12, volume=0.3))

# 3. Hit/damage - harsh noise burst
write_wav("hit.wav", [a + b for a, b in zip(noise(0.15, 0.2), tone(150, 0.15, volume=0.25))])

# 4. Heal - rising sweet tone
write_wav("heal.wav", sweep(400, 700, 0.3, volume=0.25))

# 5. Select - short click
write_wav("select.wav", tone(600, 0.05, volume=0.2))

# 6. Confirm - medium click
write_wav("confirm.wav", tone(800, 0.08, volume=0.25))

# 7. Victory - ascending notes C-E-G-C
write_wav("victory.wav", sequence([(523, 0.12), (659, 0.12), (784, 0.12), (1047, 0.25)]))

# 8. Defeat - descending notes
write_wav("defeat.wav", sequence([(400, 0.15), (350, 0.15), (300, 0.15), (200, 0.3)]))

# 9. Level up - sparkly ascending
write_wav("levelup.wav", sequence([(523, 0.08), (659, 0.08), (784, 0.08), (1047, 0.08), (1319, 0.2)]))

# 10. Door - open door sound
write_wav("door.wav", sweep(300, 500, 0.15, volume=0.2))

# 11. Buy - coin sound
write_wav("buy.wav", sequence([(880, 0.06), (1319, 0.12)]))

# 12. Error - buzz
write_wav("error.wav", tone(200, 0.2, volume=0.2))

print(f"\nAll files saved to {OUT}")
print("Files:", os.listdir(OUT))
