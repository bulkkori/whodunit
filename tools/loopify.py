"""배경음악 무한 반복용 편집: 마디 경계에서 반복 구간 A~B를 고르고, B 직전 한 마디를 A 직전 한 마디와 겹쳐(이퀄 파워 크로스페이드)
B→A로 넘어갈 때 끊김이 없게 만든다. 결과: 도입부 + 반복 구간까지 자른 mp3, 반복 지점 json.
사용: python loopify.py 입력.mp3 출력.mp3 출력.json"""
import sys, json, numpy as np, librosa, soundfile as sf

src, out_mp3, out_json = sys.argv[1:4]
y, sr = sf.read(src, always_2d=True)               # 원본 채널 그대로(스테레오)
mono = librosa.to_mono(y.T.astype(np.float32))
an_sr = 22050
m = librosa.resample(mono, orig_sr=sr, target_sr=an_sr)
HOP = 512
tempo, beats = librosa.beat.beat_track(y=m, sr=an_sr, hop_length=HOP)
beat_s = librosa.frames_to_samples(beats, hop_length=HOP) * sr // an_sr
onset = librosa.onset.onset_strength(y=m, sr=an_sr, hop_length=HOP)
# 4/4 가정: 마디 첫 박 위치(위상)를 온셋 세기로 고름
phase = max(range(4), key=lambda p: onset[beats[p::4]].sum())
bars = beat_s[phase::4]
bar_len = int(np.median(np.diff(bars)))

feat_hop = 2048
chroma = librosa.feature.chroma_cqt(y=m, sr=an_sr, hop_length=feat_hop)
mfcc = librosa.feature.mfcc(y=m, sr=an_sr, n_mfcc=13, hop_length=feat_hop)
rms = librosa.feature.rms(y=m, hop_length=feat_hop)[0]
def win(sample, before):
    a = int(sample * an_sr / sr / feat_hop); w = max(2, int(bar_len * an_sr / sr / feat_hop))
    sl = slice(max(0, a - w), a) if before else slice(a, a + w)
    c, f = chroma[:, sl].mean(1), mfcc[:, sl].mean(1)
    return np.r_[c / (np.linalg.norm(c) + 1e-9), f / (np.linalg.norm(f) + 1e-9)], rms[sl].mean() if rms[sl].size else 0
cos = lambda a, b: float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

L = len(mono); med = np.median(rms)
best = None
for i, A in enumerate(bars):
    if A < 6 * sr or A > 0.45 * L: continue                     # 도입부는 6초 이후, 앞쪽 45% 안
    fa_b, ea = win(A, True); fa_a, _ = win(A, False)
    for j in range(i + 8, len(bars)):                            # 최소 8마디
        B = bars[j]
        if B < 0.55 * L or B > L - bar_len: continue
        if (j - i) % 4: continue                                 # 4마디(프레이즈) 단위
        fb_b, eb = win(B, True); fb_a, eb2 = win(B, False)
        if eb < 0.6 * med: continue                              # 페이드아웃 구간 제외
        s = cos(fa_b, fb_b) + cos(fa_a, fb_a) - abs(np.log((ea + 1e-6) / (eb + 1e-6))) * 0.3 + (B - A) / L * 0.2
        if best is None or s > best[0]: best = (s, A, B, j - i)
if best is None: raise SystemExit('반복 지점을 찾지 못함')
score, A, B, nbars = best
X = bar_len                                                       # 크로스페이드 한 마디
t = np.linspace(0, np.pi / 2, X)[:, None]
out = y[:B].copy()
out[B - X:B] = y[B - X:B] * np.cos(t) + y[A - X:A] * np.sin(t)   # B 직전 → A 직전 소리로 서서히
peak = np.abs(out).max()
if peak > 0.99: out *= 0.99 / peak
sf.write(out_mp3, out.astype(np.float32), sr, format='MP3', compression_level=0.25)
json.dump({'loopStart': round(A / sr, 4), 'loopEnd': round(B / sr, 4), 'bpm': round(float(np.atleast_1d(tempo)[0]), 1), 'bars': int(nbars)}, open(out_json, 'w'))
print(f'BPM {float(np.atleast_1d(tempo)[0]):.1f} | 반복 {A/sr:.2f}s → {B/sr:.2f}s ({nbars}마디, {(B-A)/sr:.1f}초) | 원곡 {L/sr:.1f}s | 유사도 점수 {score:.2f}')
