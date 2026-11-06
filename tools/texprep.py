"""생성한 그림을 게임용으로 변환해 webp로 저장한다. 파일 이름으로 처리 방식을 고른다.
- floor-*, wall-*  : 반복 텍스처. 그림에 들어간 조명 얼룩을 평탄화(흐림은 wrap 모드라 이음새 유지), 512px
                     벽은 가로 방향 얼룩만(걸레받이·장식 띠 같은 세로 구조는 그대로)
- r0~, back        : 카드 그림. 긴 변 640px로 줄이기만
- s0~, d0~, w0~    : 인물(용의자 s·오리지널 탐정 d) 전신·흉기 그림. 마젠타(#FF00FF) 배경을 투명하게 빼고 줄이기(인물 1280px, 흉기 640px)
사용: python tools/texprep.py 입력폴더 public/assets/테마 [평탄화 세기 0~1, 기본 1]"""
import sys, os, re, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d

src, dst = sys.argv[1], sys.argv[2]
k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
os.makedirs(dst, exist_ok=True)


def flatten(im, wall):
    h, w, _ = im.shape
    lum = im.mean(2)
    if wall:
        col = gaussian_filter1d(lum.mean(0), sigma=w / 14, mode='wrap')
        low = np.broadcast_to(col, lum.shape)
    else:
        low = gaussian_filter(lum, sigma=min(h, w) / 14, mode='wrap')            # 큰 범위 밝기(조명) 성분
    gain = (lum.mean() / np.maximum(low, 1e-3)) ** k                           # 그 성분만 나눠서 고르게
    return np.clip(im * gain[..., None], 0, 1)


def unmagenta(img):
    """마젠타 배경 → 투명. 경계의 분홍 번짐도 줄인다(마젠타 성분만큼 알파를 낮추고 색에서 빼기)"""
    a = np.asarray(img.convert('RGB'), np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.clip((np.minimum(r, b) - g) * 2.2, 0, 1)                             # 마젠타다움 0~1
    alpha = 1 - m
    rgb = np.clip((a - m[..., None] * np.array([1, 0, 1])) / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    return Image.fromarray((np.dstack([rgb, alpha]) * 255).astype(np.uint8), 'RGBA')


for name in sorted(os.listdir(src)):
    base, ext = os.path.splitext(name)
    if ext.lower() not in ('.png', '.jpg', '.jpeg', '.webp'): continue
    if not re.fullmatch(r'(floor|wall)-.+|[swrd]\d+|back|thumb', base):
        print(f'{name}: 이름 규칙에 없는 파일이라 건너뜀'); continue
    img = Image.open(os.path.join(src, name))
    if base.startswith(('floor-', 'wall-')):
        im = np.asarray(img.convert('RGB'), np.float32) / 255
        img = Image.fromarray((flatten(im, base.startswith('wall-')) * 255).astype(np.uint8))
        size = min(512, img.width)
        img = img.resize((size, round(size * img.height / img.width)), Image.LANCZOS)
    else:
        img = unmagenta(img) if base[0] in 'swd' else img.convert('RGB')   # 인물·탐정(전신)·흉기는 마젠타 배경 제거
        img.thumbnail((1024, 1024) if base == 'thumb' else (640, 1280) if base[0] in 'sd' else (640, 640), Image.LANCZOS)
    path = os.path.join(dst, base + '.webp')
    img.save(path, 'WEBP', quality=82, method=6)
    print(f'{name} → {base}.webp  {img.width}×{img.height}  {os.path.getsize(path) // 1024}KB')
