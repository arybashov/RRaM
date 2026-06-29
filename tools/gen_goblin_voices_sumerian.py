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

# Sumerian goblin ack lines
# Original EN → Sumerian (reconstructed)
LINES = [
    ( 1, "he-en-na, lugal-mu!"),        # Yes, master!
    ( 2, "ki-a ga-an-du?"),             # Where to, boss?
    ( 3, "ul-la-am!"),                  # Goblin ready!
    ( 4, "inim-zu-gin!"),               # As you command!
    ( 5, "ga-na-gen!"),                 # On my way!
    ( 6, "igi-zu-she!"),                # Understood! (before your eyes)
    ( 7, "a-ba ga-an-dab?"),            # Who to smash?
    ( 8, "ga-na-ak!"),                  # Goblin do it!
    ( 9, "ak-da-am!"),                  # Consider it done!
    (10, "geshtu-mu tuku!"),            # Goblin listening! (my ear is open)
    (11, "inim-zu shu-mu-ra-ab-gi!"),   # Order received!
    (12, "arad-zu-me-en!"),             # At your service! (I am your servant)
    (13, "igi-mu-she ib-ta-an-e!"),     # Show me target!
    (14, "he-en-na he-en-na, gal-zu!"), # Yes yes, great one!
    (15, "nu-dab, gen-na!"),            # Not argue. Go!
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "prototype-web", "assets", "audio", "goblin")
os.makedirs(OUT_DIR, exist_ok=True)

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

for idx, text in LINES:
    filename = f"goblin_su_{idx:02d}.mp3"
    path = os.path.join(OUT_DIR, filename)
    print(f"[{idx:02d}/15] {filename}  [{text}] ...", end="  ", flush=True)
    try:
        audio = generate(text)
        with open(path, "wb") as f:
            f.write(audio)
        print(f"OK ({len(audio)//1024}KB)")
    except urllib.error.HTTPError as e:
        print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')}")
        sys.exit(1)
    time.sleep(0.5)

print(f"\nDone! Files: {OUT_DIR}")
