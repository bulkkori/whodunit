"""생성한 바닥·벽 텍스처를 게임용으로: 그림에 들어간 조명 얼룩(가운데 밝고 가장자리 어두움 등)을 평탄화해
반복해 깔아도 밝고 어두운 띠가 생기지 않게 하고, 512px webp로 줄인다. 흐림은 wrap 모드라 이음새가 그대로 이어진다.
사용: python tools/texprep.py 입력폴더 public/assets/테마 [평탄화 세기 0~1, 기본 1]"""
import sys, os, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

src, dst = sys.argv[1], sys.argv[2]
k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
os.makedirs(dst, exist_ok=True)
for name in sorted(os.listdir(src)):
    if not name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')): continue
    im = np.asarray(Image.open(os.path.join(src, name)).convert('RGB'), np.float32) / 255
    h, w, _ = im.shape
    lum = im.mean(2)
    low = gaussian_filter(lum, sigma=min(h, w) / 14, mode='wrap')                 # 큰 범위 밝기(조명) 성분
    gain = (lum.mean() / np.maximum(low, 1e-3)) ** k                            # 그 성분만 나눠서 고르게
    out = np.clip(im * gain[..., None], 0, 1)
    size = 512 if h >= 512 else h
    img = Image.fromarray((out * 255).astype(np.uint8)).resize((size, round(size * h / w)), Image.LANCZOS)
    path = os.path.join(dst, os.path.splitext(name)[0] + '.webp')
    img.save(path, 'WEBP', quality=80, method=6)
    print(f'{name} → {os.path.basename(path)}  {os.path.getsize(path) // 1024}KB  밝기 편차 {low.std():.3f}')
