import os, sys, time
import urllib.request, urllib.error, json

API_KEY  = "sk_801291fdc1ebab12dc47b05984b8effc9da9e5819b270caf"
VOICE_ID = "ix71PlHU5tSdWD79SoJ7"   # Ogre
MODEL_ID = "eleven_multilingual_v2"

VOICE_SETTINGS = {
    "stability": 0.30,
    "similarity_boost": 0.75,
    "style": 0.65,
    "use_speaker_boost": True,
}

LINES = [
    ("klingon_test_01.mp3", "HISlaH, joHwI'!"),
    ("klingon_test_02.mp3", "nuv 'Iv wIHoH?"),
    ("klingon_test_03.mp3", "jIjaH!"),
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "prototype-web", "assets", "audio", "goblin")

def generate(text):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    payload = json.dumps({
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": VOICE_SETTINGS,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    })
    with urllib.request.urlopen(req) as r:
        return r.read()

for filename, text in LINES:
    path = os.path.join(OUT_DIR, filename)
    print(f"{filename} ...", end="  ", flush=True)
    audio = generate(text)
    with open(path, "wb") as f:
        f.write(audio)
    print(f"OK ({len(audio)//1024}KB)")
    time.sleep(0.5)

print("Done!")
