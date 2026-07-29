"""
ナツ キャラクター素材 切り出しスクリプト
ChatGPT Image 2026年7月2日 13_54_57.png → 個別透過PNG

画像はRGBA (透過済み) なので背景除去不要。
scipy connected-components でキャラクター個別検出。
"""
import os
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

SRC = r"C:/Users/ykb/Downloads/ChatGPT Image 2026年7月2日 13_54_57.png"
OUT_DIR = r"C:/Users/ykb/Desktop/ykbb/myApps/apps/HP/public/images/characters/ナツ素材"

# セクション定義 (y中心で分類、X順に並ぶ)
# セクション1・2: 大ポーズ (X順)
SECTIONS_12 = [
    (0, 410, [
        "work_drill",   "work_wrench",
        "work_shy",     "work_wink",    "work_curious",
    ]),
    (410, 700, [
        "work_happy",   "work_present", "work_laptop",
        "work_thinking","work_cool",
    ]),
]

# セクション3: 行3要素 (Y帯→X順 の2Dソート)
# Y帯 0: cy < 800 (上段: バナー・吹き出し上段・アイコン上段)
# Y帯 1: 800 <= cy < 930 (中段: ミニキャラ・吹き出し下段・大キャラ)
# Y帯 2: cy >= 930 (下段: アイコン・肉球)
SEC3_NAMES = [
    # 上段 (cy < 800, X順) = 8要素:
    #   banner, チェック!, OK!, 注目!, cone, crossed-tools, bag, book
    "banner_logo",
    "bubble_check", "bubble_ok",    "bubble_notice",
    "icon_cone",    "icon_tools",   "icon_bag",     "icon_book",
    # 中段 (800 <= cy < 930, X順) = 8要素:
    #   ミニキャラ×2, 吹き出し×2, items×2, 立ちポーズ, items
    "mini_wrench",  "mini_wave",
    "bubble_done",  "bubble_point",
    "item_01",      "item_02",
    "pose_stand",   "item_03",
    # 下段 (cy >= 930, X順) = 3要素: 小アイコン
    "icon_01",      "icon_02",      "icon_03",
]

# 最小コンポーネントサイズ (px²) - これ以下は無視
MIN_COMP_PX = 300
# 小コンポーネントのマージ閾値 (px²)
# - セクション1/2のスパークル: 582-1491px → 全てマージ
# - セクション3の小アイコン: 2081-3616px → 保持したい
# 1800 にすることでスパークルは吸収、アイコンは個別保持
MERGE_TINY_PX = 1800
# bbox padding (px)
PADDING = 8


# ──────────────────────────────────────────
# テキストラベルをトリム
# ──────────────────────────────────────────
def trim_caption(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    row_fill = (arr[:, :, 3] > 10).sum(axis=1)

    search_top = int(h * 0.65)
    TIGHT_THR = 5
    MIN_GAP = 3
    state = 'bottom'
    gap_top = h
    gap_len = 0

    for y in range(h - 1, search_top - 1, -1):
        cnt = int(row_fill[y])
        if state == 'bottom':
            if cnt > TIGHT_THR:
                state = 'in_text'
        elif state == 'in_text':
            if cnt <= TIGHT_THR:
                state = 'in_gap'
                gap_top = y + 1
                gap_len = 1
        elif state == 'in_gap':
            if cnt <= TIGHT_THR:
                gap_len += 1
            else:
                if gap_len >= MIN_GAP:
                    return img.crop((0, 0, w, gap_top))
                state = 'in_text'

    body_top = int(h * 0.70)
    body_max = int(row_fill[:body_top].max()) if body_top > 0 else 0
    if body_max >= 10:
        cut_thr = max(5, int(body_max * 0.40))
        for y in range(h - 1, search_top - 1, -1):
            if int(row_fill[y]) > cut_thr:
                crop_y = y + 1
                if crop_y < h:
                    return img.crop((0, 0, w, crop_y))
                return img
    return img


# ──────────────────────────────────────────
# 名前付け (セクション内でX順)
# ──────────────────────────────────────────
def assign_names(boxes_cxcy):
    """boxes_cxcy: list of (cx, cy, (x1,y1,x2,y2))"""
    result = []

    # セクション 1・2: X順
    for (y_lo, y_hi, names) in SECTIONS_12:
        sec = [(cx, cy, b) for cx, cy, b in boxes_cxcy if y_lo <= cy < y_hi]
        sec.sort(key=lambda t: t[0])
        for idx, (cx, cy, b) in enumerate(sec):
            name = names[idx] if idx < len(names) else f"item_{len(result)+1:02d}"
            result.append((name, b))

    # セクション 3: Y帯 → X順 (2Dソート)
    sec3 = [(cx, cy, b) for cx, cy, b in boxes_cxcy if 700 <= cy < 1024]
    def sec3_key(t):
        cx, cy, b = t
        if cy < 800:   tier = 0
        elif cy < 930: tier = 1
        else:          tier = 2
        return (tier, cx)
    sec3.sort(key=sec3_key)
    for idx, (cx, cy, b) in enumerate(sec3):
        name = SEC3_NAMES[idx] if idx < len(SEC3_NAMES) else f"item_{len(result)+1:02d}"
        result.append((name, b))

    return result


# ──────────────────────────────────────────
# メイン
# ──────────────────────────────────────────
def process():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Loading: {SRC}")
    src = Image.open(SRC)
    img_w, img_h = src.size
    print(f"  サイズ: {img_w}x{img_h}  Mode: {src.mode}")

    arr = np.array(src.convert("RGBA"))
    mask = arr[:, :, 3] > 10
    rgba = src.convert("RGBA")

    # ──────────────────────────────────
    # Connected components で検出
    # ──────────────────────────────────
    print("  Connected components 検出中...")
    labeled, n_total = ndimage.label(mask)
    print(f"    総コンポーネント数: {n_total}")

    comps = []  # (pixel_count, cy, cx, y1, y2, x1, x2)
    for i in range(1, n_total + 1):
        ys, xs = np.where(labeled == i)
        px = len(ys)
        if px < MIN_COMP_PX:
            continue
        y1, y2 = int(ys.min()), int(ys.max() + 1)
        x1, x2 = int(xs.min()), int(xs.max() + 1)
        cy = (y1 + y2) // 2
        cx = (x1 + x2) // 2
        comps.append((px, cy, cx, y1, y2, x1, x2))

    print(f"    >= {MIN_COMP_PX}px: {len(comps)}個")

    # ──────────────────────────────────
    # 小コンポーネントを隣接する大きなboxにマージ
    # ──────────────────────────────────
    large = [c for c in comps if c[0] >= MERGE_TINY_PX]
    tiny  = [c for c in comps if c[0] < MERGE_TINY_PX]

    print(f"    大: {len(large)}個  小(マージ対象): {len(tiny)}個")

    # large の bbox リスト
    bboxes = [[px, cy, cx, y1, y2, x1, x2]
              for px, cy, cx, y1, y2, x1, x2 in large]

    for (px, cy, cx, y1, y2, x1, x2) in tiny:
        # 最も近い(重なりor近距離の)largeにマージ
        best_i, best_d = None, float('inf')
        for i, b in enumerate(bboxes):
            by1, by2, bx1, bx2 = b[3], b[4], b[5], b[6]
            dy = max(0, y1 - by2, by1 - y2)
            dx = max(0, x1 - bx2, bx1 - x2)
            dist = dy + dx
            if dist <= 60 and dist < best_d:
                best_d = dist; best_i = i
        if best_i is not None:
            b = bboxes[best_i]
            b[3] = min(b[3], y1); b[4] = max(b[4], y2)
            b[5] = min(b[5], x1); b[6] = max(b[6], x2)
            b[1] = (b[3] + b[4]) // 2
            b[2] = (b[5] + b[6]) // 2

    # ──────────────────────────────────
    # padding 付き bbox
    # ──────────────────────────────────
    boxes_cxcy = []
    for b in bboxes:
        _, cy, cx, y1, y2, x1, x2 = b
        x1p = max(0, x1 - PADDING)
        y1p = max(0, y1 - PADDING)
        x2p = min(img_w, x2 + PADDING)
        y2p = min(img_h, y2 + PADDING)
        boxes_cxcy.append((cx, cy, (x1p, y1p, x2p, y2p)))

    print(f"    マージ後: {len(boxes_cxcy)}個")

    # ──────────────────────────────────
    # 名前付け & 保存
    # ──────────────────────────────────
    print("  名前を割り当て中...")
    named = assign_names(boxes_cxcy)
    print()

    saved = []
    for name, (x1, y1, x2, y2) in named:
        char_img = rgba.crop((x1, y1, x2, y2))
        char_img = trim_caption(char_img)
        out_path = os.path.join(OUT_DIR, f"{name}.png")
        char_img.save(out_path)
        saved.append(name)
        print(f"  {name:<30} {x2-x1}x{y2-y1}px  (y={y1}-{y2}, x={x1}-{x2})")

    # デバッグインデックス (白背景)
    bg = Image.new("RGBA", src.size, (255, 255, 255, 255))
    bg.paste(src, mask=src.convert("RGBA"))
    debug = bg.convert("RGB")
    draw = ImageDraw.Draw(debug)
    for i, (name, (x1, y1, x2, y2)) in enumerate(named):
        draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=2)
        draw.text((x1 + 2, y1 + 2), f"{i+1}:{name}", fill=(255, 0, 0))
    debug.save(os.path.join(OUT_DIR, "_debug_index.png"))

    print(f"\nDone! {len(saved)}ファイル + _debug_index.png 保存完了")
    print(f"  → {OUT_DIR}")


if __name__ == "__main__":
    process()
