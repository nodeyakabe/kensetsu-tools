"""
キャラクター画像切り出しスクリプト
S__30310407.jpg (1024x1536px) から ミケル・クロエを切り出し、
白背景を透過にして個別PNGとして保存する
"""

from PIL import Image
import numpy as np
from collections import deque

SRC = r"C:/Users/ykb/Downloads/S__30310407.jpg"
OUT_MIKERU = r"C:/Users/ykb/Desktop/ykbb/myApps/apps/HP/public/images/characters/mikeru.png"
OUT_KUROE  = r"C:/Users/ykb/Desktop/ykbb/myApps/apps/HP/public/images/characters/kuroe.png"

def remove_bg_flood(img_rgb: Image.Image, tolerance: int = 20) -> Image.Image:
    """
    画像の四辺からflood fillで背景(白系)を検出し、透過にする。
    キャラ本体の白い毛は内部なので消えない。
    """
    arr = np.array(img_rgb.convert("RGB"), dtype=np.int32)
    h, w = arr.shape[:2]
    alpha = np.full((h, w), 255, dtype=np.uint8)

    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    # 四辺のピクセルを初期キューに追加
    for x in range(w):
        queue.append((0, x))
        queue.append((h - 1, x))
    for y in range(h):
        queue.append((y, 0))
        queue.append((y, w - 1))

    def is_white(y, x):
        r, g, b = arr[y, x]
        return r > (255 - tolerance) and g > (255 - tolerance) and b > (255 - tolerance)

    # BFS flood fill
    while queue:
        y, x = queue.popleft()
        if visited[y, x]:
            continue
        visited[y, x] = True
        if not is_white(y, x):
            continue
        alpha[y, x] = 0  # 透過
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                queue.append((ny, nx))

    rgba = np.dstack([arr.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA")


def process():
    print(f"Loading: {SRC}")
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    print(f"  Size: {w}x{h}")

    # 左半分=ミケル、右半分=クロエ
    # 少し内側にトリミングして枠ノイズを除去
    # Y方向: 上部余白(タイトルテキストなど)をスキップ → y=60〜 (調整可)
    y_top    = 60
    y_bottom = h  # 下端まで

    # ミケル: 左半分 x=0〜512
    mikeru_box = (0, y_top, w // 2, y_bottom)
    mikeru_crop = src.crop(mikeru_box)
    print(f"  ミケル crop: {mikeru_box}")
    mikeru_rgba = remove_bg_flood(mikeru_crop)
    mikeru_rgba.save(OUT_MIKERU)
    print(f"  → Saved: {OUT_MIKERU}  ({mikeru_rgba.size})")

    # クロエ: 右半分 x=512〜1024
    kuroe_box = (w // 2, y_top, w, y_bottom)
    kuroe_crop = src.crop(kuroe_box)
    print(f"  クロエ crop: {kuroe_box}")
    kuroe_rgba = remove_bg_flood(kuroe_crop)
    kuroe_rgba.save(OUT_KUROE)
    print(f"  → Saved: {OUT_KUROE}  ({kuroe_rgba.size})")

    print("Done!")


if __name__ == "__main__":
    process()
