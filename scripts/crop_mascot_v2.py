"""
マスコットキャラクター素材 一括切り出しスクリプト (Final)
ChatGPT Image 2026年7月1日 15_45_06.png → 個別透過PNG

アルゴリズム:
  1. チェッカーボード背景 (白/薄灰) をBFSで透過に
  2. 緑ヘッダー行 (連続緑バンド>110px) をマスクから除外
  3. 行グループを検出 → 各グループ内で列投影 → BBox検出
  4. 各行グループ内はX座標でソート (左→右)
  5. 感情シンボルなど小さなbox (<65px) を隣接キャラにマージ
  6. 幅>280px の box を「行→列」の2段階で再分割
"""
import os
from PIL import Image, ImageDraw
import numpy as np
from collections import deque

SRC = r"C:/Users/ykb/Downloads/ChatGPT Image 2026年7月1日 15_45_06.png"
OUT_DIR = r"C:/Users/ykb/Desktop/ykbb/myApps/apps/HP/public/images/characters/新しいフォルダー"

# 検出された全要素を左→右・上→下の順に番号付け
# セクションの定義 (y中心値で判定)
SECTIONS = [
    (  0, 290, [  # 仕事中のバリエーション
        "work_desk",        "work_site_check",  "work_measure",   "work_drawing",
        "work_tablet",      "work_phone",       "work_materials", "work_done",
    ]),
    (290, 490, [  # 表情・感情バリエーション
        "face_happy",       "face_angry",       "face_sad",       "face_joyful",
        "face_worried",     "face_surprised",   "face_troubled",  "face_thinking",
    ]),
    (490, 730, [  # その他ポーズ＋吹き出し＋アイコン
        "pose_presentation","pose_please",      "pose_idea",
        "pose_safety1",     "pose_safety2",     "pose_ganbare",
        "bubble_check",     "bubble_ok",        "bubble_caution", "bubble_done", "bubble_point",
        "icon_clipboard",   "icon_search",      "icon_pencil",
        "icon_tool",        "icon_gear",        "icon_plus",
    ]),
    (730, 870, [  # HP用背景バリエーション
        "bg_green",         "bg_city",          "bg_white",       "bg_dark",
    ]),
    (870, 1024, [  # ミニキャライラスト
        "mini_01", "mini_02", "mini_03", "mini_04", "mini_05",
        "mini_06", "mini_07", "mini_08", "mini_09", "mini_10",
        "mini_11", "mini_12", "mini_13", "mini_14", "paw_print",
    ]),
]


# ──────────────────────────────────────────
# 1. チェッカーボード背景除去 (BFS)
# ──────────────────────────────────────────
def remove_checker_bg(img: Image.Image):
    arr = np.array(img.convert("RGBA"), dtype=np.uint8)
    h, w = arr.shape[:2]
    r, g, b = arr[:,:,0].astype(int), arr[:,:,1].astype(int), arr[:,:,2].astype(int)
    diff = np.abs(r-g) + np.abs(g-b) + np.abs(r-b)
    is_bg = (diff < 25) & ((r+g+b)/3 > 180)

    alpha = np.full((h, w), 255, dtype=np.uint8)
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()
    for x in range(w):
        queue.append((0, x)); queue.append((h-1, x))
    for y in range(h):
        queue.append((y, 0)); queue.append((y, w-1))
    while queue:
        y, x = queue.popleft()
        if visited[y, x]: continue
        visited[y, x] = True
        if not is_bg[y, x]: continue
        alpha[y, x] = 0
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                queue.append((ny, nx))
    result = arr.copy()
    result[:,:,3] = alpha
    return Image.fromarray(result, "RGBA"), (alpha > 0)


# ──────────────────────────────────────────
# 2. セクションヘッダー行検出
# ──────────────────────────────────────────
def _max_green_run(row_bool, gap_fill=12):
    arr = list(row_bool.astype(int))
    n = len(arr)
    i = 0
    while i < n:
        if arr[i] == 0:
            j = i
            while j < n and arr[j] == 0: j += 1
            if j-i <= gap_fill:
                for k in range(i, j): arr[k] = 1
            i = j
        else: i += 1
    max_r = cur = 0
    for v in arr:
        if v: cur += 1; max_r = max(max_r, cur)
        else: cur = 0
    return max_r

def build_header_mask(img_arr, thr=110):
    r, g, b = img_arr[:,:,0].astype(int), img_arr[:,:,1].astype(int), img_arr[:,:,2].astype(int)
    is_g = (g-r > 30) & (g-b > 20) & (g > 90)
    return np.array([_max_green_run(is_g[y]) > thr for y in range(img_arr.shape[0])])


# ──────────────────────────────────────────
# 3. 投影ユーティリティ
# ──────────────────────────────────────────
def _ranges(arr_1d, thr, min_len=1):
    out, s = [], None
    for i, v in enumerate(arr_1d):
        if v > thr and s is None: s = i
        elif v <= thr and s is not None:
            if i-s >= min_len: out.append((s, i))
            s = None
    if s is not None and len(arr_1d)-s >= min_len:
        out.append((s, len(arr_1d)))
    return out

def _merge(ranges, gap):
    if not ranges: return []
    m = [list(ranges[0])]
    for s, e in ranges[1:]:
        if s-m[-1][1] <= gap: m[-1][1] = e
        else: m.append([s, e])
    return [tuple(r) for r in m]

def _tight_bbox(mask_2d, gy1, gx1, img_w, img_h, padding=10):
    """sub-mask から精確なbboxを算出してpadding付きで返す"""
    rh = mask_2d.any(axis=1); ch = mask_2d.any(axis=0)
    if not rh.any() or not ch.any(): return None
    ay1 = gy1 + int(np.argmax(rh))
    ay2 = gy1 + len(rh) - int(np.argmax(rh[::-1]))
    ax1 = gx1 + int(np.argmax(ch))
    ax2 = gx1 + len(ch) - int(np.argmax(ch[::-1]))
    return (max(0,ax1-padding), max(0,ay1-padding),
            min(img_w,ax2+padding), min(img_h,ay2+padding))


# ──────────────────────────────────────────
# 4. BBox 検出 (セクション内はX順)
# ──────────────────────────────────────────
def detect_boxes(mask, img_w, img_h,
                 min_w=28, min_h=30,
                 row_gap=6, col_gap=2, padding=10):
    row_sums = mask.sum(axis=1)
    row_ranges = _ranges(row_sums, img_w*0.001, min_len=5)
    row_ranges = _merge(row_ranges, row_gap)

    all_boxes = []   # [(x_center, y_center, bbox)]
    for y1, y2 in row_ranges:
        if y2-y1 < min_h: continue
        col_sums = mask[y1:y2, :].sum(axis=0)
        col_ranges = _ranges(col_sums, 1, min_len=min_w)
        col_ranges = _merge(col_ranges, col_gap)

        row_boxes = []
        for x1, x2 in col_ranges:
            if x2-x1 < min_w: continue
            bbox = _tight_bbox(mask[y1:y2, x1:x2], y1, x1, img_w, img_h, padding)
            if bbox is None: continue
            cx = (bbox[0]+bbox[2])//2
            cy = (bbox[1]+bbox[3])//2
            row_boxes.append((cx, cy, bbox))

        # セクション内はX座標でソート (左→右)
        row_boxes.sort(key=lambda t: t[0])
        all_boxes.extend(row_boxes)

    return [b[2] for b in all_boxes]


# ──────────────────────────────────────────
# 5. ポスト処理: 小シンボルマージ
# ──────────────────────────────────────────
def merge_tiny(boxes, tiny_max=65, merge_gap=20):
    large = [b for b in boxes if (b[2]-b[0]) >= tiny_max or (b[3]-b[1]) >= tiny_max]
    tiny  = [b for b in boxes if (b[2]-b[0]) < tiny_max and (b[3]-b[1]) < tiny_max]
    result = list(large)
    for sb in tiny:
        sx1,sy1,sx2,sy2 = sb
        best_i, best_d = None, float('inf')
        for i,(lx1,ly1,lx2,ly2) in enumerate(result):
            if not (sy1 < ly2 and sy2 > ly1): continue
            dx = max(0, sx1-lx2, lx1-sx2)
            if dx <= merge_gap and dx < best_d: best_d, best_i = dx, i
        if best_i is not None:
            lx1,ly1,lx2,ly2 = result[best_i]
            result[best_i] = (min(lx1,sx1),min(ly1,sy1),max(lx2,sx2),max(ly2,sy2))
        else:
            result.append(sb)
    # Xでソートを維持 (同じ行グループ内)
    return result


# ──────────────────────────────────────────
# 6. ポスト処理: 幅広boxを2段階再分割
# ──────────────────────────────────────────
def resplit_wide(boxes, mask, img_w, img_h, max_w=270, min_seg=28, padding=10):
    result = []
    for (x1,y1,x2,y2) in boxes:
        if (x2-x1) <= max_w:
            result.append((x1,y1,x2,y2))
            continue

        sub = mask[y1:y2, x1:x2]

        # ステップA: 行方向でまず分割 (bubble行・icon行など)
        row_sums = sub.sum(axis=1)
        rg = _ranges(row_sums, 1, min_len=min_seg)
        rg = _merge(rg, 3)
        if not rg: rg = [(0, y2-y1)]

        sub_boxes = []
        for (ry1, ry2) in rg:
            row_sub = sub[ry1:ry2, :]
            col_sums = row_sub.sum(axis=0)
            cg = _ranges(col_sums, 1, min_len=min_seg)
            cg = _merge(cg, 0)   # gap=0 で厳密に分割
            for (cx1, cx2) in cg:
                if cx2-cx1 < 20: continue
                bbox = _tight_bbox(row_sub[:, cx1:cx2],
                                   y1+ry1, x1+cx1,
                                   img_w, img_h, padding)
                if bbox and (bbox[2]-bbox[0]) >= 20 and (bbox[3]-bbox[1]) >= 20:
                    sub_boxes.append(bbox)

        if len(sub_boxes) > 1:
            result.extend(sub_boxes)
        else:
            result.append((x1,y1,x2,y2))

    return result


# ──────────────────────────────────────────
# 7. 名前付け (セクションのy範囲で分類+X順)
# ──────────────────────────────────────────
def assign_names(boxes):
    named = []
    for box in boxes:
        cx = (box[0]+box[2])//2
        cy = (box[1]+box[3])//2
        for (y_lo, y_hi, names) in SECTIONS:
            if y_lo <= cy < y_hi:
                named.append((cy, cx, box))
                break
        else:
            named.append((cy, cx, box))

    # セクション内でX座標順 (CYが同じ帯の中ではCXで並べる)
    # → まずCYの帯 (SECTION) で分割してからCXでソート
    result = []
    for (y_lo, y_hi, names) in SECTIONS:
        sec_items = [(cx, cy, b) for (cy, cx, b) in named
                     if y_lo <= (b[1]+b[3])//2 < y_hi]
        sec_items.sort(key=lambda t: t[0])  # X順
        for idx, (cx, cy, b) in enumerate(sec_items):
            name = names[idx] if idx < len(names) else f"item_{len(result)+1:02d}"
            result.append((name, b))
    return result


# ──────────────────────────────────────────
# 8. 下部キャプションテキストをトリム
# ──────────────────────────────────────────
def trim_caption(img: Image.Image) -> Image.Image:
    """
    下部テキストラベルを2段階で除去する。

    アプローチ1: 透過ギャップ検出
      - 下部35%をスキャンし、3行以上の「ほぼ透過行 (cnt<=5)」をギャップと判定
      - ギャップ直上でクロップ (キャラ↓透過gap↓テキスト 構造)

    アプローチ2: 本体密度比較 (ギャップなし時のフォールバック)
      - 上部70%の最大密度 body_max を算出
      - body_max の40%以下になった下端でクロップ
    """
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    row_fill = (arr[:, :, 3] > 10).sum(axis=1)

    search_top = int(h * 0.65)  # 下部35%のみ探索

    # --- アプローチ1: 透過ギャップ検出 ---
    TIGHT_THR = 5   # この値以下 = ほぼ透過行
    MIN_GAP   = 3   # 最小ギャップ行数

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
                # 偽ギャップ (短すぎ) → in_text に戻る
                state = 'in_text'

    # --- アプローチ2: 本体密度比較 ---
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
# 9. メイン処理
# ──────────────────────────────────────────
def process():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Loading: {SRC}")
    src = Image.open(SRC)
    img_w, img_h = src.size
    print(f"  サイズ: {img_w}x{img_h}  Mode: {src.mode}")
    src_arr = np.array(src.convert("RGB"))

    print("  チェッカーボード背景除去中...")
    rgba, mask = remove_checker_bg(src)

    print("  セクションヘッダー行を除外中...")
    is_header = build_header_mask(src_arr)
    clean = mask.copy()
    clean[is_header, :] = False
    print(f"    → ヘッダー行: {is_header.sum()}行")

    print("  キャラクター検出中 (col_gap=2, X順ソート)...")
    boxes = detect_boxes(clean, img_w, img_h,
                         min_w=28, min_h=30,
                         row_gap=6, col_gap=2, padding=10)
    boxes = [b for b in boxes
             if (b[2]-b[0])>=20 and (b[3]-b[1])>=20
             and (b[2]-b[0])*(b[3]-b[1])>=600]
    print(f"  初期検出: {len(boxes)}個")

    print("  小シンボルをキャラにマージ中...")
    boxes = merge_tiny(boxes, tiny_max=65, merge_gap=20)
    boxes = [b for b in boxes
             if (b[2]-b[0])>=20 and (b[3]-b[1])>=20
             and (b[2]-b[0])*(b[3]-b[1])>=600]
    print(f"  マージ後: {len(boxes)}個")

    print("  幅広boxを2段階再分割中...")
    boxes = resplit_wide(boxes, clean, img_w, img_h, max_w=270)
    boxes = [b for b in boxes
             if (b[2]-b[0])>=20 and (b[3]-b[1])>=20
             and (b[2]-b[0])*(b[3]-b[1])>=600]
    print(f"  再分割後: {len(boxes)}個")

    print("  名前を割り当て中...")
    named = assign_names(boxes)
    print()

    saved = []
    for name, (x1,y1,x2,y2) in named:
        char_img = rgba.crop((x1,y1,x2,y2))
        char_img = trim_caption(char_img)   # 下部テキストラベルを除去
        out_path = os.path.join(OUT_DIR, f"{name}.png")
        char_img.save(out_path)
        saved.append(name)
        print(f"  {name:35s} {x2-x1}x{y2-y1}px  (y={y1}-{y2}, x={x1}-{x2})")

    # デバッグ用インデックス画像
    debug = src.convert("RGBA")
    draw = ImageDraw.Draw(debug)
    for i, (name, (x1,y1,x2,y2)) in enumerate(named):
        draw.rectangle([x1,y1,x2,y2], outline=(255,0,0,200), width=2)
        draw.text((x1+2,y1+2), str(i+1), fill=(255,0,0,255))
    debug.save(os.path.join(OUT_DIR, "_debug_index.png"))

    print(f"\nDone! {len(saved)}ファイル + _debug_index.png 保存完了")
    print(f"  → {OUT_DIR}")


if __name__ == "__main__":
    process()
