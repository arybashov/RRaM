#!/usr/bin/env python
"""Генерация игровых SFX через Stable Audio Open 1.0 (diffusers).

44.1 кГц стерео. Модель gated: нужен HF-токен (env HF_TOKEN) и принятая лицензия
на https://huggingface.co/stabilityai/stable-audio-open-1.0.

Читает тот же prompts.json. Seed по умолчанию выводится из id (стабильно, но у
каждого звука свой), что даёт разные звуки; можно переопределить --seed.

Примеры:
  python generate_sao.py --only attack-hit,dice-roll,victory,ui-click --outdir prototype-web/assets/audio/_sao
  python generate_sao.py --priority
  python generate_sao.py            # все промпты
"""
import argparse
import json
import sys
import zlib
from pathlib import Path

import torch
import soundfile as sf
from diffusers import StableAudioPipeline

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[2]
PROMPTS = Path(__file__).resolve().parent / "prompts.json"
MODEL = "stabilityai/stable-audio-open-1.0"
NEG = "low quality, average quality, noise, hiss, muffled, distortion"


def seed_for(cid, override):
    if override:
        return override
    return zlib.crc32(cid.encode("utf-8")) & 0x7FFFFFFF


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--priority", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--outdir", default="prototype-web/assets/audio")
    p.add_argument("--steps", type=int, default=160)
    p.add_argument("--seed", type=int, default=0, help="0 = seed из id")
    return p.parse_args()


def main():
    args = parse_args()
    out_dir = (ROOT / args.outdir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    items = json.loads(PROMPTS.read_text(encoding="utf-8"))["sfx"]
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    if only:
        items = [i for i in items if i["id"] in only]
    elif args.priority:
        items = [i for i in items if i.get("priority")]
    if not args.force:
        items = [i for i in items if not (out_dir / f"{i['id']}.wav").exists()]
    if not items:
        print("Нечего генерировать (--force чтобы перезаписать).")
        return

    if not torch.cuda.is_available():
        print("ВНИМАНИЕ: нет CUDA — будет очень медленно.")
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    print(f"Загрузка модели {MODEL} ...")
    # low_cpu_mem_usage=False: иначе веса грузятся на 'meta', а weight_norm в
    # декодере Stable Audio на meta-бэкенде падает (aten::_weight_norm_interface).
    pipe = StableAudioPipeline.from_pretrained(MODEL, torch_dtype=dtype, low_cpu_mem_usage=False)
    pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
    sr = pipe.vae.config.sampling_rate
    print(f"Готово. Частота {sr} Гц; к генерации: {len(items)}; шагов: {args.steps}")

    for idx, item in enumerate(items, 1):
        cid = item["id"]
        prompt = item["prompt"]
        dur = max(1.0, float(item.get("duration", 2.0)))
        seed = seed_for(cid, args.seed)
        print(f"[{idx}/{len(items)}] {cid} ({dur}s, seed {seed}): {prompt}")
        try:
            gen = torch.Generator("cuda" if torch.cuda.is_available() else "cpu").manual_seed(seed)
            res = pipe(
                prompt=prompt,
                negative_prompt=NEG,
                num_inference_steps=args.steps,
                audio_end_in_s=dur,
                num_waveforms_per_prompt=1,
                generator=gen,
            ).audios
            audio = res[0].T.float().cpu().numpy()  # [samples, channels]
            sf.write(str(out_dir / f"{cid}.wav"), audio, sr)
        except Exception as e:
            print(f"  ОШИБКА на {cid}: {e}", file=sys.stderr)

    print(f"Готово. Файлы: {out_dir}")


if __name__ == "__main__":
    main()
