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

# Short punchy goblin English acks
LINES = [
    ( 1, "Yes, master!"),
    ( 2, "Where to, boss?"),
    ( 3, "Goblin ready!"),
    ( 4, "As you command!"),
    ( 5, "On my way!"),
    ( 6, "Understood!"),
    ( 7, "Who to smash?"),
    ( 8, "Goblin do it!"),
    ( 9, "Consider it done!"),
    (10, "Goblin listening!"),
    (11, "Order received!"),
    (12, "At your service!"),
    (13, "Show me target!"),
    (14, "Yes yes, great one!"),
    (15, "Goblin not argue. Goblin go!"),
]

# Non-verbal sounds for Sound Effects API
SFX = [
    ("grunt_01",  "a goblin grunting in agreement, short grunt"),
    ("grunt_02",  "a goblin short grunt, raspy and guttural"),
    ("grunt_03",  "deep goblin grunt of acknowledgement"),
    ("cough_01",  "a goblin coughing roughly, single cough"),
    ("cough_02",  "goblin clearing throat, raspy"),
    ("snort_01",  "goblin snorting and huffing"),
    ("wheeze_01", "goblin wheezing exhale"),
    ("laugh_01",  "goblin short snicker, mischievous"),
    ("laugh_02",  "goblin raspy chuckle"),
    ("hmm_01",    "goblin low guttural hmm sound"),
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "prototype-web", "assets", "audio", "goblin")
os.makedirs(OUT_DIR, exist_ok=True)

def generate_tts(text):
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

def generate_sfx(prompt):
    url = "https://api.elevenlabs.io/v1/sound-generation"
    payload = json.dumps({
        "text": prompt,
        "duration_seconds": 2.0,
        "prompt_influence": 0.4,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    })
    with urllib.request.urlopen(req) as r:
        return r.read()

print("=== TTS voice lines ===")
for idx, text in LINES:
    filename = f"goblin_ack_{idx:02d}.mp3"
    path = os.path.join(OUT_DIR, filename)
    print(f"[{idx:02d}/15] {filename} ...", end="  ", flush=True)
    try:
        audio = generate_tts(text)
        with open(path, "wb") as f:
            f.write(audio)
        print(f"OK ({len(audio)//1024}KB)")
    except urllib.error.HTTPError as e:
        print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')}")
        sys.exit(1)
    time.sleep(0.4)

print("\n=== SFX grunts/coughs ===")
for name, prompt in SFX:
    filename = f"{name}.mp3"
    path = os.path.join(OUT_DIR, filename)
    print(f"  {filename} ...", end="  ", flush=True)
    try:
        audio = generate_sfx(prompt)
        with open(path, "wb") as f:
            f.write(audio)
        print(f"OK ({len(audio)//1024}KB)")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"FAIL {e.code}: {body}")
    time.sleep(0.5)

print(f"\nDone! {OUT_DIR}")
