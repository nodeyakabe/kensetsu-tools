"""
sozai1.png 処理スクリプト
- グラデーション背景を除去（エッジflood fill）
- キャラ別に切り出してPNG保存
"""

from PIL import Image
import numpy as np
from collections import deque

SRC  = "photo/sozai1.png"
DEST = "apps/HP/public/images/characters"

# ============================================================
# 背景除去（エッジflood fill）
# ============================================================
def remove_bg(img_rgba: Image.Image, tolerance: int = 40) -> Image.Image:
    arr  = np.array(img_rgba.convert("RGBA"), dtype=np.int32)
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3].copy().astype(np.uint8)

    # 四辺のピクセル色を基準に「背景らしい色」を判定
    visited = np.zeros((h, w), dtype=bool)
    queue   = deque()
    for x in range(w):
        queue.append((0,   x))
        queue.append((h-1, x))
    for y in range(h):
        queue.append((y, 0))
        queue.append((y, w-1))

    # エッジ周辺の代表色を取得（四隅平均）
    corners = [arr[5,5,:3], arr[5,-5,:3], arr[-5,5,:3], arr[-5,-5,:3]]
    bg_color = np.mean(corners, axis=0)

    def is_bg(y, x):
        pix = arr[y, x, :3]
        return float(np.max(np.abs(pix - bg_color))) < tolerance

    while queue:
        y, x = queue.popleft()
        if visited[y, x]:
            continue
        visited[y, x] = True
        if not is_bg(y, x):
            continue
        alpha[y, x] = 0
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                queue.append((ny, nx))

    result = arr.astype(np.uint8).copy()
    result[:, :, 3] = alpha
    return Image.fromarray(result, "RGBA")


# ============================================================
# 自動トリミング（透過ピクセルを除いたbbox）
# ============================================================
def auto_trim(img_rgba: Image.Image, padding: int = 4) -> Image.Image:
    bbox = img_rgba.getbbox()
    if not bbox:
        return img_rgba
    l, t, r, b = bbox
    h, w = img_rgba.height, img_rgba.width
    l = max(0, l - padding)
    t = max(0, t - padding)
    r = min(w, r + padding)
    b = min(h, b + padding)
    return img_rgba.crop((l, t, r, b))


# ============================================================
# キャラ切り出し定義
# 1024x1536、4行×3列のスプライト
# col幅≈341、row高さ≈384
# ============================================================
CROPS = [
    # name,                x1,   y1,   x2,   y2
    ("mikeru_tati",          0,    0,  400,  470),  # 左列Row1: ミケル全身
    ("mikeru_warai",         0,  520,  400,  860),  # 左列Row2: ミケル笑い（足アーチファクト回避）
    ("mikeru_yorokobi",      0,  880,  400, 1180),  # 左列Row3: ミケル喜び
    ("mikeru_odoroki",       0, 1200,  400, 1536),  # 左列Row4: ミケル驚き

    ("kuroe_tati",         420,    0,  750,  510),  # 中列Row1: クロエ全身(バンザイ)
    ("kuroe_tati2",        730,    0,  870,  390),  # 右列Row1-左半: クロエ全身
    ("kuroe_kanngaetyuu",  420,  520,  720,  870),  # 中列Row2: クロエ考え中
    ("kuroe_no_maru",      720,  520, 1024,  870),  # 右列Row2: クロエ○×
    ("kuroe_bust3",        420,  880,  720, 1230),  # 中列Row3
    ("kuroe_bust4",        720,  880, 1024, 1230),  # 右列Row3
    ("kuroe_bust5",        420, 1240,  720, 1536),  # 中列Row4
    ("kuroe_bust6",        720, 1240, 1024, 1536),  # 右列Row4
]


def main():
    print(f"Loading: {SRC}")
    src = Image.open(SRC).convert("RGBA")
    print(f"  Size: {src.size}")

    print("  背景除去中...")
    src_nobg = remove_bg(src, tolerance=40)

    for name, x1, y1, x2, y2 in CROPS:
        crop = src_nobg.crop((x1, y1, x2, y2))
        crop = auto_trim(crop, padding=6)

        # 中身がほぼ空なら保存しない
        arr = np.array(crop)
        if arr[:,:,3].sum() < 10000:
            print(f"  SKIP (空): {name}")
            continue

        out = f"{DEST}/{name}.png"
        crop.save(out)
        print(f"  → {out}  {crop.size}")

    print("Done!")


if __name__ == "__main__":
    main()
