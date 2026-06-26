import os, sys, time
import urllib.request, urllib.error, json

API_KEY = "sk_801291fdc1ebab12dc47b05984b8effc9da9e5819b270caf"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "prototype-web", "assets", "audio")

SFX = [
    # (output_filename, prompt, duration)
    ("ui-click.wav",          "short wooden button click, board game UI tap",                           0.5),
    ("ui-error.wav",          "short error buzz, negative feedback, low thud",                          0.8),
    ("ui-notify.wav",         "soft chime notification, gentle bell ding",                              0.8),
    ("dice-roll.wav",         "wooden dice rolling on a wooden table, multiple dice",                   1.5),
    ("turn-start.wav",        "fantasy turn start chime, magical shimmer, short fanfare",               1.5),
    ("turn-end.wav",          "soft gong hit, turn ending, medieval board game",                        1.2),
    ("card-draw.wav",         "card sliding and drawing from a deck, paper swoosh",                     0.8),
    ("card-transfer.wav",     "card passing between players, paper slide",                              0.8),
    ("card-place-terrain.wav","thick card placed firmly on a wooden table, thud",                      0.6),
    ("card-flip-terrain.wav", "card flipping over, paper flip whoosh",                                 0.6),
    ("card-to-inventory.wav", "card picked up and tucked away, paper rustle",                          0.8),
    ("attack-hit.wav",        "sword hit impact on flesh, fantasy melee combat strike",                 0.8),
    ("attack-blocked.wav",    "sword blocked by shield, metal clang deflect",                           0.8),
    ("character-defeat.wav",  "character defeated, dramatic short sting, medieval fantasy",             2.0),
    ("beast-appear.wav",      "wild beast appearing, growl and dramatic reveal, fantasy monster",       2.0),
    ("beast-fight-hit.wav",   "beast claws slashing, monster attack impact",                            0.8),
    ("beast-defeat.wav",      "monster defeated, beast dying growl and thud",                           2.0),
    ("teleport-cast.wav",     "magical teleport cast, whoosh and sparkle, fantasy spell",               1.5),
    ("craft-success.wav",     "successful crafting, magical chime and anvil ring, item created",        1.5),
    ("craft-fail.wav",        "crafting failure, sad trombone short, clatter of dropped tools",         1.2),
    ("victory.wav",           "victory fanfare, triumphant medieval brass short stinger",               3.0),
    ("defeat.wav",            "defeat sting, sad medieval short musical phrase, somber",                2.5),
]

def generate_sfx(prompt, duration):
    url = "https://api.elevenlabs.io/v1/sound-generation"
    payload = json.dumps({
        "text": prompt,
        "duration_seconds": duration,
        "prompt_influence": 0.5,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

print(f"Generating {len(SFX)} game SFX...\n")
for filename, prompt, duration in SFX:
    path = os.path.join(OUT_DIR, filename)
    print(f"  {filename} ...", end="  ", flush=True)
    try:
        audio = generate_sfx(prompt, duration)
        with open(path, "wb") as f:
            f.write(audio)
        print(f"OK ({len(audio)//1024}KB)")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"FAIL {e.code}: {body}")
    time.sleep(0.5)

print(f"\nDone! {OUT_DIR}")
