from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import csv
import re

ROOT = Path(__file__).resolve().parent
EMBEDDED = ROOT / "embedded"
OUT = ROOT / "sheets"
LIST_FILE = ROOT / "pdfimages-list.txt"
OUT.mkdir(parents=True, exist_ok=True)


def read_pdfimages_rows():
    rows = []
    raw = LIST_FILE.read_bytes()
    if raw.startswith(b"\xff\xfe") or raw.count(b"\x00") > len(raw) // 8:
        text = raw.decode("utf-16", errors="replace")
    else:
        text = raw.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if not re.match(r"^\s*\d+\s+\d+\s+", line):
            continue
        parts = line.split()
        rows.append({
            "page": int(parts[0]),
            "num": int(parts[1]),
            "type": parts[2],
            "width": int(parts[3]),
            "height": int(parts[4]),
            "object": f"{parts[10]} {parts[11]}",
            "x_ppi": int(parts[12]),
            "y_ppi": int(parts[13]),
        })
    return rows


def fit_image(path, box_w, box_h):
    img = Image.open(path).convert("RGB")
    img.thumbnail((box_w, box_h), Image.LANCZOS)
    canvas = Image.new("RGB", (box_w, box_h), "white")
    x = (box_w - img.width) // 2
    y = (box_h - img.height) // 2
    canvas.paste(img, (x, y))
    return canvas


def main():
    rows = read_pdfimages_rows()
    files = sorted(
        [p for p in EMBEDDED.iterdir() if p.name.startswith("card-")],
        key=lambda p: int(re.search(r"card-(\d+)", p.stem).group(1)),
    )
    if len(rows) != len(files):
        raise SystemExit(f"row/file mismatch: {len(rows)} rows, {len(files)} files")

    manifest_path = ROOT / "manifest.csv"
    with manifest_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["seq", "file", "page", "num", "pair", "side_guess", "object", "width", "height", "x_ppi", "y_ppi"],
        )
        writer.writeheader()
        for i, (row, path) in enumerate(zip(rows, files)):
            writer.writerow({
                "seq": i,
                "file": path.name,
                "page": row["page"],
                "num": row["num"],
                "pair": i // 2,
                "side_guess": "back" if i % 2 == 0 else "front",
                **{k: row[k] for k in ["object", "width", "height", "x_ppi", "y_ppi"]},
            })

    font = ImageFont.load_default()
    cols = 5
    rows_per_sheet = 4
    cell_w, cell_h = 230, 330
    label_h = 34
    per_sheet = cols * rows_per_sheet

    for start in range(0, len(files), per_sheet):
        sheet_rows = list(zip(range(start, min(start + per_sheet, len(files))), files[start:start + per_sheet]))
        sheet = Image.new("RGB", (cols * cell_w, rows_per_sheet * (cell_h + label_h)), "white")
        draw = ImageDraw.Draw(sheet)
        for n, (seq, path) in enumerate(sheet_rows):
            x = (n % cols) * cell_w
            y = (n // cols) * (cell_h + label_h)
            img = fit_image(path, cell_w - 8, cell_h - 8)
            sheet.paste(img, (x + 4, y + label_h + 4))
            row = rows[seq]
            label = f"{seq:03d} p{row['page']:03d} {'B' if seq % 2 == 0 else 'F'} obj {row['object'].split()[0]}"
            draw.rectangle([x, y, x + cell_w, y + label_h], fill=(245, 245, 245), outline=(210, 210, 210))
            draw.text((x + 6, y + 10), label, fill=(0, 0, 0), font=font)
        out_path = OUT / f"sheet-{start:03d}-{sheet_rows[-1][0]:03d}.jpg"
        sheet.save(out_path, quality=92)

    unique_dir = ROOT / "unique-sheets"
    unique_dir.mkdir(parents=True, exist_ok=True)
    first_by_object = {}
    count_by_object = {}
    for i, (row, path) in enumerate(zip(rows, files)):
        key = row["object"]
        count_by_object[key] = count_by_object.get(key, 0) + 1
        first_by_object.setdefault(key, (i, row, path))
    unique_items = sorted(first_by_object.items(), key=lambda item: item[1][0])
    unique_manifest = ROOT / "unique-manifest.csv"
    with unique_manifest.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["unique_index", "object", "count", "first_seq", "first_page", "file", "width", "height"],
        )
        writer.writeheader()
        for unique_index, (key, (seq, row, path)) in enumerate(unique_items):
            writer.writerow({
                "unique_index": unique_index,
                "object": key,
                "count": count_by_object[key],
                "first_seq": seq,
                "first_page": row["page"],
                "file": path.name,
                "width": row["width"],
                "height": row["height"],
            })

    for start in range(0, len(unique_items), per_sheet):
        sheet_items = unique_items[start:start + per_sheet]
        sheet = Image.new("RGB", (cols * cell_w, rows_per_sheet * (cell_h + label_h)), "white")
        draw = ImageDraw.Draw(sheet)
        for n, (key, (seq, row, path)) in enumerate(sheet_items):
            x = (n % cols) * cell_w
            y = (n // cols) * (cell_h + label_h)
            img = fit_image(path, cell_w - 8, cell_h - 8)
            sheet.paste(img, (x + 4, y + label_h + 4))
            unique_index = start + n
            label = f"u{unique_index:03d} seq{seq:03d} p{row['page']:03d} x{count_by_object[key]} obj {key.split()[0]}"
            draw.rectangle([x, y, x + cell_w, y + label_h], fill=(245, 245, 245), outline=(210, 210, 210))
            draw.text((x + 6, y + 10), label, fill=(0, 0, 0), font=font)
        out_path = unique_dir / f"unique-{start:03d}-{start + len(sheet_items) - 1:03d}.jpg"
        sheet.save(out_path, quality=92)

    print(f"wrote {manifest_path}")
    print(f"wrote {len(list(OUT.glob('sheet-*.jpg')))} sheets to {OUT}")
    print(f"wrote {unique_manifest}")
    print(f"wrote {len(list(unique_dir.glob('unique-*.jpg')))} unique sheets to {unique_dir}")


if __name__ == "__main__":
    main()
