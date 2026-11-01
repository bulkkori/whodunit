// 글꼴을 외부(Google Fonts·jsDelivr) 대신 우리 서버에서 제공: 플레이어 IP가 외부 회사로 가지 않게.
// node_modules의 글꼴 패키지에서 woff2만 public/fonts/로 복사하고, 경로를 고친 fonts.css 하나로 합친다.
// 사용: npm run fonts (패키지를 올렸을 때만 다시 실행)
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), out = join(root, 'public/fonts');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const parts: string[] = ['/* 자동 생성(tools/fonts.ts). 글꼴 라이선스: SIL Open Font License 1.1 */'];

/** css 안의 url(./x.woff2)만 남기고(woff 대체는 버림) 파일을 sub 폴더로 복사, 경로를 바꿔 넣는다 */
function take(cssPath: string, sub: string) {
  const dir = dirname(cssPath); mkdirSync(join(out, sub), { recursive: true });
  const css = readFileSync(cssPath, 'utf8')
    .replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, '')
    .replace(/url\(\.\/([^)]+\.woff2)\)/g, (_, f: string) => {
      const name = f.split('/').pop()!; copyFileSync(join(dir, f), join(out, sub, name)); return `url(./${sub}/${name})`;
    });
  parts.push(css);
}
const nm = (p: string) => join(root, 'node_modules', p);
take(nm('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'), 'pretendard');
take(nm('@fontsource/nanum-myeongjo/700.css'), 'myeongjo');
take(nm('@fontsource/nanum-myeongjo/800.css'), 'myeongjo');
take(nm('@fontsource/nanum-pen-script/400.css'), 'pen');
take(nm('@fontsource/nanum-gothic-coding/700.css'), 'coding');
writeFileSync(join(out, 'fonts.css'), parts.join('\n'));
console.log('글꼴 복사 완료 → public/fonts/fonts.css');
