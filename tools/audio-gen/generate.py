#!/usr/bin/env python
"""Генерация игровых SFX через Meta AudioGen (audiocraft).

Читает prompts.json, генерирует <id>.wav в prototype-web/assets/audio/.
Модель facebook/audiogen-medium (16 кГц, моно), грузится один раз.

Примеры:
  python generate.py --priority           # только минимальный набор
  python generate.py --only dice-roll,ui-click
  python generate.py                       # все промпты (пропускает уже готовые)
  python generate.py --force               # перегенерировать всё
"""
import argparse
import json
import sys
from pathlib import Path

# На Windows при редиректе stdout берёт cp1251 и падает на кириллице — форсим UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import torch
from audiocraft.models import AudioGen
from audiocraft.data.audio import audio_write

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "prototype-web" / "assets" / "audio"
PROMPTS = Path(__file__).resolve().parent / "prompts.json"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="", help="список id через запятую")
    p.add_argument("--priority", action="store_true", help="только priority=true")
    p.add_argument("--force", action="store_true", help="перегенерировать существующие")
    p.add_argument("--model", default="facebook/audiogen-medium")
    p.add_argument("--seed", type=int, default=0, help="0 = случайно каждый раз")
    return p.parse_args()


def main():
    args = parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = json.loads(PROMPTS.read_text(encoding="utf-8"))
    items = data["sfx"]

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    if only:
        items = [i for i in items if i["id"] in only]
    elif args.priority:
        items = [i for i in items if i.get("priority")]

    if not args.force:
        items = [i for i in items if not (OUT_DIR / f"{i['id']}.wav").exists()]

    if not items:
        print("Нечего генерировать (всё уже есть? добавь --force).")
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Устройство: {device}; модель: {args.model}; к генерации: {len(items)}")
    if device == "cpu":
        print("ВНИМАНИЕ: CUDA не найдена — на CPU будет очень медленно.")

    model = AudioGen.get_pretrained(args.model)

    for idx, item in enumerate(items, 1):
        cid, prompt, dur = item["id"], item["prompt"], float(item.get("duration", 2.0))
        if args.seed:
            torch.manual_seed(args.seed)
        print(f"[{idx}/{len(items)}] {cid} ({dur}s): {prompt}")
        try:
            model.set_generation_params(duration=dur)
            wav = model.generate([prompt])  # [1, channels, samples]
            audio_write(
                str(OUT_DIR / cid), wav[0].cpu(), model.sample_rate,
                strategy="loudness", loudness_compressor=True,
            )
        except Exception as e:  # одна ошибка не валит весь батч
            print(f"  ОШИБКА на {cid}: {e}", file=sys.stderr)

    print(f"Готово. Файлы: {OUT_DIR}")


if __name__ == "__main__":
    main()
