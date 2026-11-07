// 학교 자료 자동 갱신 스크립트
// - config.json 에 적힌 구글 시트(주간 업무계획, 월중 행사계획)를 엑셀로 내려받아 data/school.json 으로 바꿔요.
// - data/ 폴더에 학사일정 한글 파일(.hwpx)이 있으면 data/acad.json 으로 바꿔요.
// GitHub Actions 가 매일 자동으로 실행해요. 직접 실행: node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {parseDeptSheets, parseAcad} from './parsers.mjs';

globalThis.DOMParser = DOMParser;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, 'data', 'school.json');
const sameItems = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function loadWorkbook(kind, id) {
  // 테스트용: LOCAL_WEEKLY / LOCAL_ANNUAL 환경변수에 xlsx 파일 경로를 주면 그 파일을 씀
  const local = process.env['LOCAL_' + kind.toUpperCase()];
  let buf;
  if (local) buf = fs.readFileSync(local);
  else {
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    const res = await fetch(url, {redirect: 'follow'});
    if (!res.ok) throw new Error(`내려받기 실패 (${res.status}) — 시트 공유가 "링크가 있는 모든 사용자"인지 확인하세요`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('엑셀 파일이 아니에요 — 시트 공유 설정을 확인하세요');
  return XLSX.read(buf, {type: 'buffer'});
}

async function buildSheets(prev) {
  const out = {school: cfg.schoolName, schoolYear: cfg.schoolYear, generatedAt: prev?.generatedAt || null};
  let changed = false;
  for (const kind of ['weekly', 'annual']) {
    const id = cfg.sheets?.[kind];
    if (!id) { out[kind] = {items: [], cover: []}; continue; }
    try {
      const wb = await loadWorkbook(kind, id);
      const sheets = wb.SheetNames.map(n => ({name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: false, defval: ''})}));
      const r = parseDeptSheets(sheets, {schoolYear: cfg.schoolYear, kind, periods: cfg.periods || []});
      if (!r.items.length) throw new Error('시트에서 "일·요일·부서" 표를 찾지 못했어요');
      out[kind] = {items: r.items, cover: r.cover, sheets: r.sheets};
      if (!prev || !sameItems(prev[kind]?.items, r.items) || !sameItems(prev[kind]?.cover, r.cover)) changed = true;
      console.log(`✓ ${kind}: 시트 ${r.sheets}개, ${r.items.length}건`);
    } catch (e) {
      console.error(`✗ ${kind}: ${e.message} — 이전 자료를 그대로 둡니다`);
      out[kind] = prev?.[kind] || {items: [], cover: []};
      process.exitCode = 1;
    }
  }
  if (changed) out.generatedAt = new Date().toISOString();
  return {out, changed};
}

async function buildAcad() {
  const dir = path.join(ROOT, 'data');
  const file = cfg.acadFile ? path.join(ROOT, cfg.acadFile) : fs.readdirSync(dir).filter(f => /\.hwpx$/i.test(f)).map(f => path.join(dir, f))[0];
  if (!file || !fs.existsSync(file)) { console.log('- 학사일정 hwpx 파일 없음 (건너뜀)'); return; }
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const xmls = await Promise.all(names.map(n => zip.file(n).async('string')));
  const r = parseAcad(xmls, cfg.schoolYear);
  if (!r.items.length) { console.error('✗ 학사일정 표를 찾지 못했어요'); process.exitCode = 1; return; }
  const outPath = path.join(dir, 'acad.json');
  const data = {source: cfg.acadTitle || path.basename(file).replace(/\.hwpx$/i, ''), schoolYear: r.schoolYear, items: r.items};
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  if (prev && sameItems(prev.items, data.items) && prev.source === data.source) { console.log(`= 학사일정 변경 없음 (${r.items.length}건)`); return; }
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`✓ 학사일정: ${r.items.length}건${r.warn.length ? ' (확인 필요: ' + r.warn.join(', ') + ')' : ''}`);
}

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const {out, changed} = await buildSheets(prev);
if (changed) { fs.writeFileSync(OUT, JSON.stringify(out)); console.log('→ data/school.json 갱신'); }
else console.log('= 시트 변경 없음');
await buildAcad();
