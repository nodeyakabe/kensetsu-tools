"""
sozai_3D.png 処理スクリプト
- 背景のチェッカーボード（市松模様）を除去（エッジflood fill）
- 各キャラクターを切り出してPNG保存

注意：元画像はRGBAだが全ピクセルがalpha=255
チェッカーボードは「焼き込み済みの背景ピクセル」として除去する
"""

from PIL import Image
import numpy as np
from collections import deque

SRC  = "photo/sozai_3D.png"
DEST = "apps/HP/public/images/characters"


def remove_checker_bg(img: Image.Image) -> Image.Image:
    """
    背景フラッドフィル方式で背景を除去。

    画像の四辺（エッジ）から背景をフラッドフィルで塗りつぶす。
    - 背景ピクセル: near-grayscale (range<=12) かつ mean>=165
    - 8方向接続でフラッドフィル → エッジから到達可能な背景を全て検出
    - 到達しなかったピクセル = キャラクター → 不透明のまま
    - 到達したピクセル = 背景 → 透過

    この方式のメリット:
      - キャラ内部の白い部分（ヘルメット等）はキャラ輪郭で囲まれており
        エッジから到達不可能なため正しく保持される
      - チェッカーボード境界のアンチエイリアスピクセルも
        エッジから連続しているため正しく背景として検出される
    """
    arr = np.array(img.convert("RGBA"), dtype=np.int32)
    h, w = arr.shape[:2]

    means  = np.mean(arr[:, :, :3], axis=2)
    ranges = (np.max(arr[:, :, :3], axis=2) - np.min(arr[:, :, :3], axis=2)).astype(float)

    # 背景として通過可能なピクセル:
    #   near-grayscale (range<=12) かつ mean>=165
    # 背景の暗灰色マス: range=0-8, mean~195-205
    # 背景の白マス: range=0-5, mean~250-255
    # 背景のアンチエイリアス: range=1-8, mean~195-255
    # キャラの色付きピクセル: range>12 → ブロック（フラッドフィル停止）
    bg_passable = (ranges <= 12) & (means >= 165)

    # 画像の四辺からフラッドフィル開始
    background = np.zeros((h, w), dtype=bool)
    queue = deque()

    # 上辺・下辺
    for x in range(w):
        for y in [0, h - 1]:
            if bg_passable[y, x] and not background[y, x]:
                background[y, x] = True
                queue.append((y, x))
    # 左辺・右辺
    for y in range(h):
        for x in [0, w - 1]:
            if bg_passable[y, x] and not background[y, x]:
                background[y, x] = True
                queue.append((y, x))

    # 8方向接続でフラッドフィル
    dirs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while queue:
        y, x = queue.popleft()
        for dy, dx in dirs:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not background[ny, nx]:
                if bg_passable[ny, nx]:
                    background[ny, nx] = True
                    queue.append((ny, nx))

    # 背景でないピクセル = キャラクター
    character = ~background

    result = arr.astype(np.uint8).copy()
    result[:, :, 3] = (character * 255).astype(np.uint8)
    return Image.fromarray(result, "RGBA")


def auto_trim(img_rgba: Image.Image, padding: int = 6) -> Image.Image:
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
# キャラ切り出し定義（1264x842）
# 上段左：ナツ（みけねこ・黄ヘルメット） と ウタ（黒猫・白ヘルメット）が並ぶ
# 右半分・下段：各ポーズの小さいカット
# ============================================================
CROPS = [
    # name,          x1,   y1,   x2,   y2
    ("natu_tati",     0,    0,   310,  430),  # ナツ全身（みけねこ・左）
    ("uta_tati",    375,    0,   600,  430),  # ウタ全身（黒猫・右）

    # 右列の小さいポーズ群
    ("natu_drill",  620,    0,   800,  210),  # ナツ+ドリル
    ("uta_tools",   800,    0,   970,  210),  # ウタ+工具
    ("uta_helmet",  970,    0,  1130,  210),  # ウタ+ヘルメット
    ("both_small", 1100,    0,  1264,  210),  # 2人小さい

    ("natu_measure", 620,  210,  800,  430),  # ナツ+測量機
    ("uta_plan",    800,  210,  970,  430),   # ウタ+図面
    ("natu_uta_2",  970,  210, 1264,  430),  # 2人

    # 下段
    ("natu_backhoe", 0,   430,  310,  650),  # ナツ+バックホー
    ("uta_shovel",  310,  430,  620,  650),  # ウタ+シャベル
    ("natu_crane",  620,  430,  800,  650),  # ナツ+クレーン
    ("uta_desk",    800,  430,  970,  650),  # ウタ+デスク
    ("both_work",   970,  430, 1264,  650),  # 作業中2人
]


def main():
    print(f"Loading: {SRC}")
    src = Image.open(SRC).convert("RGBA")
    print(f"  Size: {src.size}")

    print("  背景除去中（チェッカーボード）...")
    src = remove_checker_bg(src)

    for name, x1, y1, x2, y2 in CROPS:
        crop = src.crop((x1, y1, x2, y2))
        crop = auto_trim(crop, padding=6)

        arr = np.array(crop)
        if arr[:, :, 3].sum() < 10000:
            print(f"  SKIP (空): {name}")
            continue

        out = f"{DEST}/{name}.png"
        crop.save(out)
        print(f"  → {out}  {crop.size}")

    print("Done!")


if __name__ == "__main__":
    main()
