#!/usr/bin/env python3
"""Render title and rules text onto a prepared high-res card frame."""

from __future__ import annotations

import argparse
import sys
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def import_pillow():
    try:
        from PIL import Image, ImageDraw, ImageFont

        return Image, ImageDraw, ImageFont
    except ModuleNotFoundError:
        local_pil = ROOT / "tools" / "board-editor" / ".pdf-tools"
        if local_pil.exists():
            sys.path.insert(0, str(local_pil))
        from PIL import Image, ImageDraw, ImageFont

        return Image, ImageDraw, ImageFont


Image, ImageDraw, ImageFont = import_pillow()


FONT_CANDIDATES = {
    "title": [
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ],
    "body": [
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ],
    "type": [
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Clean framed PNG.")
    parser.add_argument("--output", required=True, type=Path, help="Generated text PNG.")
    parser.add_argument("--title", required=True, help="Card title.")
    parser.add_argument("--body", required=True, help="Rules/body text.")
    parser.add_argument("--type", default="", help="Small type line above rules text.")
    parser.add_argument("--title-size", type=int, default=82)
    parser.add_argument("--type-size", type=int, default=30)
    parser.add_argument("--body-size", type=int, default=49)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def font_path(kind: str) -> Path | None:
    for candidate in FONT_CANDIDATES[kind]:
        if candidate.exists():
            return candidate
    return None


def font(kind: str, size: int):
    path = font_path(kind)
    if path:
        return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def text_bbox(draw, xy, text: str, font_obj, **kwargs):
    return draw.textbbox(xy, text, font=font_obj, **kwargs)


def text_size(draw, text: str, font_obj, **kwargs) -> tuple[int, int]:
    left, top, right, bottom = text_bbox(draw, (0, 0), text, font_obj, **kwargs)
    return right - left, bottom - top


def fit_single_line(draw, text: str, kind: str, max_width: int, start_size: int, min_size: int):
    size = start_size
    while size >= min_size:
        candidate = font(kind, size)
        width, _ = text_size(draw, text, candidate, stroke_width=max(2, size // 18))
        if width <= max_width:
            return candidate, size
        size -= 2
    return font(kind, min_size), min_size


def wrap_lines(draw, text: str, font_obj, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        trial = " ".join([*current, word])
        width, _ = text_size(draw, trial, font_obj)
        if current and width > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines


def fit_wrapped_text(
    draw,
    text: str,
    kind: str,
    max_width: int,
    max_height: int,
    start_size: int,
    min_size: int,
) -> tuple[object, int, list[str], int]:
    for size in range(start_size, min_size - 1, -2):
        candidate = font(kind, size)
        lines = wrap_lines(draw, text, candidate, max_width)
        line_height = int(size * 1.08)
        total_height = line_height * len(lines)
        if total_height <= max_height:
            return candidate, size, lines, line_height
    candidate = font(kind, min_size)
    lines = wrap_lines(draw, text, candidate, max_width)
    return candidate, min_size, lines, int(min_size * 1.08)


def draw_centered(
    draw,
    box: tuple[int, int, int, int],
    lines: list[str],
    font_obj,
    line_height: int,
    fill,
    stroke_fill,
    stroke_width: int,
):
    left, top, right, bottom = box
    total_height = line_height * len(lines)
    y = top + max(0, (bottom - top - total_height) // 2)
    for line in lines:
        width, height = text_size(draw, line, font_obj, stroke_width=stroke_width)
        x = left + (right - left - width) // 2
        draw.text(
            (x, y),
            line,
            font=font_obj,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        y += line_height


def draw_card(args: argparse.Namespace) -> None:
    source = args.source if args.source.is_absolute() else ROOT / args.source
    output = args.output if args.output.is_absolute() else ROOT / args.output
    image = Image.open(source).convert("RGBA")
    draw = ImageDraw.Draw(image)
    width, height = image.size

    scale_x = width / 1023
    scale_y = height / 1537

    def sx(value: int) -> int:
        return int(round(value * scale_x))

    def sy(value: int) -> int:
        return int(round(value * scale_y))

    title_box = (sx(145), sy(130), sx(878), sy(245))
    type_box = (sx(145), sy(1194), sx(878), sy(1238))
    body_box = (sx(126), sy(1232), sx(897), sy(1413))

    gold = (223, 189, 126, 255)
    shadow = (19, 9, 7, 255)
    ink = (14, 7, 4, 255)

    title_font, title_size = fit_single_line(
        draw,
        args.title.upper(),
        "title",
        title_box[2] - title_box[0],
        int(args.title_size * scale_y),
        int(46 * scale_y),
    )
    draw_centered(
        draw,
        title_box,
        [args.title.upper()],
        title_font,
        int(title_size * 1.02),
        gold,
        shadow,
        max(3, title_size // 13),
    )

    if args.type:
        type_font, type_size = fit_single_line(
            draw,
            args.type.upper(),
            "type",
            type_box[2] - type_box[0],
            int(args.type_size * scale_y),
            int(20 * scale_y),
        )
        draw_centered(
            draw,
            type_box,
            [args.type.upper()],
            type_font,
            int(type_size * 1.05),
            ink,
            (218, 170, 96, 160),
            max(1, type_size // 18),
        )

    body_top = body_box[1] + (sy(36) if args.type else 0)
    body_font, body_size, lines, line_height = fit_wrapped_text(
        draw,
        args.body,
        "body",
        body_box[2] - body_box[0],
        body_box[3] - body_top,
        int(args.body_size * scale_y),
        int(25 * scale_y),
    )
    draw_centered(
        draw,
        (body_box[0], body_top, body_box[2], body_box[3]),
        lines,
        body_font,
        line_height,
        ink,
        (232, 178, 95, 120),
        max(1, body_size // 26),
    )

    if args.dry_run:
        print(
            textwrap.dedent(
                f"""\
                source: {source}
                output: {output}
                size: {width}x{height}
                body lines: {len(lines)}
                """
            ).strip()
        )
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    print(output)


if __name__ == "__main__":
    draw_card(parse_args())
