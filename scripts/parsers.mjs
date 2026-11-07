// 학교 캘린더 — 시트·학사일정 파서 (scripts/build.mjs 에서 사용)
// 웹앱(index.html) 안에도 같은 코드가 들어 있어요.

function csvRows(text,delim){
  delim=delim||',';const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=ch}
    else if(ch==='"'&&cell==='')q=true;
    else if(ch===delim){row.push(cell);cell=''}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
    else cell+=ch}
  if(cell!==''||row.length){row.push(cell);rows.push(row)}
  return rows;
}
function mdTableRows(text){
  return text.split(/\r?\n/).filter(l=>/^\s*\|/.test(l)&&!/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map(l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim().replace(/<br\s*\/?>/gi,'\n')));
}
/* text: "## Sheet name: X\n...csv..." blocks -> [{name, rows}] */
function splitSheets(text){
  const out=[];const re=/^##\s*Sheet name:\s*(.*)$/gm;let m;const marks=[];
  while((m=re.exec(text)))marks.push({name:m[1].trim(),start:m.index,body:re.lastIndex});
  marks.forEach((k,i)=>{const body=text.slice(k.body,i+1<marks.length?marks[i+1].start:text.length).replace(/^\r?\n/,'');
    const rows=/^\s*\|/m.test(body)&&!/^[^|\n]*,/.test(body.split('\n').find(l=>l.trim())||'')?mdTableRows(body):csvRows(body);
    out.push({name:k.name,rows})});
  return out;
}
function hashStr(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36)}
function splitItems(cell){
  const lines=String(cell??'').split(/\r?\n/);const items=[];let cur=null;
  for(let raw of lines){const l=raw.trim();if(!l)continue;
    if(/^[ㆍ·•▪◦]/.test(l)||cur===null){if(cur)items.push(cur);cur=l.replace(/^[ㆍ·•▪◦]\s*/,'')}
    else cur+=(/[(\[,/~-]$/.test(cur)||/^[)\],]/.test(l)?'':' ')+l}
  if(cur!=null)items.push(cur);
  return items.map(s=>s.replace(/\s+/g,' ').replace(/\(\s+/g,'(').replace(/\s+\)/g,')').trim()).filter(s=>s&&s!=='-'&&s!=='ㆍ');
}
/* Parse department-format sheets. opts: {schoolYear, kind, periods:[{n,start}]} -> {items, cover:[[from,to]], sheets} */
function parseDeptSheets(sheets,opts){
  const sy=opts.schoolYear;const yOf=mo=>mo>=3?sy:sy+1;
  const mk=(y,mo,d)=>{if(mo<1||mo>12||d<1||d>31)return null;const x=new Date(y,mo-1,d);if(x.getMonth()!==mo-1)return null;
    return `${x.getFullYear()}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
  const items=[],cover=[];let used=0;const seen={};
  for(const sh of sheets){
    const rows=sh.rows;const hi=rows.findIndex(r=>String(r[0]||'').trim()==='일'&&/요일/.test(String(r[1]||'')));
    if(hi<0)continue;
    const depts=rows[hi].map(c=>String(c||'').replace(/\s+/g,'').trim());
    const sm=(sh.name+' '+(rows[0]||[]).join(' ')).match(/(\d{1,2})\s*월/);if(!sm)continue;
    let month=+sm[1];let prevDay=0;let lo=null,hiD=null;used++;
    for(const r of rows.slice(hi+1)){
      const c0=String(r[0]??'').trim();let day=null;let m;
      if((m=c0.match(/^(\d{1,2})\s*[/.]\s*(\d{1,2})$/))){month=+m[1];day=+m[2]}
      else if(/^\d{1,2}$/.test(c0)){day=+c0;if(day<prevDay){month=month%12+1}}
      else continue;
      prevDay=day;const date=mk(yOf(month),month,day);if(!date)continue;
      if(!lo||date<lo)lo=date;if(!hiD||date>hiD)hiD=date;
      for(let j=2;j<r.length;j++){
        const dept=depts[j]||'';
        for(const t of splitItems(r[j])){
          let time='';let tm=t.match(/(^|[^\d])(\d{1,2}):(\d{2})/);
          if(tm&&+tm[2]>=7&&+tm[2]<=21)time=String(+tm[2]).padStart(2,'0')+':'+tm[3];
          else if((tm=t.match(/(\d{1,2})\s*(?:[~-]\s*\d{1,2}\s*)?교시/))&&opts.periods){const p=opts.periods.find(x=>x.n===+tm[1]);if(p)time=p.start}
          const key=opts.kind+'|'+date+'|'+dept+'|'+t;seen[key]=(seen[key]||0)+1;
          items.push({id:'g'+hashStr(key+'|'+seen[key]),kind:opts.kind,date,end:'',time,title:t,note:'',dept,src:'gsheet'});
        }
      }
    }
    if(lo)cover.push([lo,hiD]);
  }
  return{items,cover,sheets:used};
}


function hwpNodeText(n){let s='';for(const c of Array.from(n.childNodes)){if(c.nodeType===3)s+=c.nodeValue;else if(c.nodeType===1){const l=c.localName;if(l==='fwSpace'||l==='nbSpace'||l==='tab'||l==='lineBreak')s+=' ';else if(l!=='tbl')s+=hwpNodeText(c)}}return s}
function hwpTables(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const kids=(el,name)=>Array.from(el.childNodes).filter(c=>c.nodeType===1&&c.localName===name);
  return Array.from(doc.getElementsByTagNameNS('*','tbl')).map(tb=>{
    const g={};
    for(const tr of kids(tb,'tr'))for(const tc of kids(tr,'tc')){
      const a=kids(tc,'cellAddr')[0],sl=kids(tc,'subList')[0];if(!a)continue;
      const lines=sl?kids(sl,'p').map(p=>hwpNodeText(p).replace(/\s+/g,' ').trim()).filter(Boolean):[];
      g[a.getAttribute('rowAddr')+','+a.getAttribute('colAddr')]=lines;
    }
    return g;
  });
}
function parseAcad(xmls,schoolYear){
  const W='일월화수목금토';let sy=schoolYear;const out=[];const warn=[];
  for(const xml of xmls){const m=xml.match(/(20\d\d)\s*학년도/);if(m){sy=+m[1];break}}
  const yOf=mo=>mo>=3?sy:sy+1;
  const mk=(y,mo,d)=>{const x=new Date(y,mo-1,d);if(x.getMonth()!==mo-1)return null;return `${x.getFullYear()}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
  const nextDay=s=>{const[y,mo,d]=s.split('-').map(Number);const x=new Date(y,mo-1,d+1);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
  const clean=s=>s.replace(/\((?:자봉|자|동|진봉|진)\s*[\d,~\s]+\)/g,'').replace(/\s+/g,' ').replace(/\s+([,)])/g,'$1').trim();
  const range=(a,b,sep)=>{a=+a;b=b==null?a:+b;if(sep===','||sep==null)return b===a?[a]:[a,b];const r=[];for(let i=a;i<=b&&i<=12;i++)r.push(i);return r};
  function day(date,wd,lines){
    lines=lines.slice();let counter=null;
    if(lines.length){const m=lines[0].match(/^([월화수목금])(\d+)\s*(?:\(([^)]*)\))?\s*(.*)$/);
      if(m){counter={dow:W.indexOf(m[1]),n:+m[2],paren:m[3]||''};if(m[4])lines[0]=m[4];else lines.shift()}}
    const ls=[];for(const l of lines){if(/^\(/.test(l)&&ls.length)ls[ls.length-1]+=' '+l;else ls.push(l)}
    const rule={};const ev={};const main=[];const slotLbl=[];let cut=0;
    if(counter&&counter.dow!==wd)rule.dow=counter.dow;
    const baseDow=rule.dow!=null?rule.dow:wd;
    for(let l of ls){let m;
      if((m=l.match(/\(?\s*수업\s*\(?\s*([\d,\s]+?)\s*\)\)?/))){
        const ps=m[1].split(/[,\s]+/).filter(Boolean).map(Number);rule.map=rule.map||{};ps.forEach((p,i)=>rule.map[i+1]={dow:baseDow,p});
        rule.nmap=ps.length;l=l.replace(m[0],'').trim();if(!l)continue}
      if((m=l.match(/(\d+)\s*,\s*(\d+)\s*교시\s*-\s*([월화수목금])\s*(\d+)\s*,\s*(\d+)\s*교시/))){
        rule.map=rule.map||{};rule.map[+m[1]]={dow:W.indexOf(m[3]),p:+m[4]};rule.map[+m[2]]={dow:W.indexOf(m[3]),p:+m[5]};cut=Math.max(cut,+m[2]);rule.swap=true;continue}
      if((m=l.match(/^\(?\s*수업\s*\(?\s*([\d,\s]+)\)?\s*\)?$/))){
        const ps=m[1].split(/[,\s]+/).filter(Boolean).map(Number);rule.map=rule.map||{};ps.forEach((p,i)=>rule.map[i+1]={dow:baseDow,p});continue}
      if((m=l.match(/동아리\s*(\d+)\s*([,~])\s*(\d+)\s*교시/))){range(m[1],m[3],m[2]==='~'?'~':'-').forEach(n=>ev[n]={t:'동아리'});main.push(`동아리(${m[1]}·${m[3]}교시)`);continue}
      if((m=l.match(/^(\d+)\s*(?:([,~])\s*(\d+))?\s*교시\s*(.+)$/))){
        const lab=clean(m[4]);const sl=range(m[1],m[3],m[2]==='~'?'~':m[2]===','?'-':null);
        sl.forEach(n=>ev[n]={t:lab});slotLbl.push(lab);if(rule.swap)cut=Math.max(cut,sl[sl.length-1]);continue}
      if((m=l.match(/\((\d+)\s*~\s*(\d+)\s*교시\)/))){
        const lab=clean(l.replace(m[0],''));const gm=lab.match(/(\d)\s*학년/);const g=gm?[+gm[1]]:null;
        range(m[1],m[2],'~').forEach(n=>ev[n]=g?{t:lab,g}:{t:lab});main.push(lab);continue}
      main.push(clean(l));
    }
    if(counter&&counter.paren&&!/스포츠|주선/.test(counter.paren)&&!ls.some(x=>x.includes(counter.paren+'')&&x!==ls[0]||slotLbl.some(y=>y.includes(counter.paren))))main.unshift(counter.paren);
    if(rule.dow!=null)main.push(`(${W[rule.dow]}요일 시간표)`);
    // event slot labels prefixed with main title (e.g. 현장체험학습 · 진로)
    const mt=main.filter(x=>!/^\d학년|^\(/.test(x)).join(' · ');
    if(mt&&Object.keys(ev).length)for(const k in ev)if(ev[k].t!=='동아리'&&!ev[k].g&&!ev[k].t.includes(mt))ev[k].t=`${mt} · ${ev[k].t}`;
    if(rule.nmap&&mt&&!/동아리/.test(mt)){for(let n=rule.nmap+1;n<=7;n++)if(!ev[n])ev[n]={t:mt}}
    delete rule.nmap;
    if(Object.keys(ev).length)rule.ev=ev;
    if(cut&&rule.swap)rule.cut=cut;delete rule.swap;
    const title=(main.length?main:slotLbl).filter(Boolean).join(' · ');
    const noClass=!counter&&ls.length>0;
    if(!title&&!Object.keys(rule).length)return;
    out.push({date,end:'',title,note:lines.join(' / '),noClass,rule:Object.keys(rule).length?rule:null,counter:counter?W[counter.dow]+counter.n:''});
  }
  for(const xml of xmls)for(const g of hwpTables(xml)){
    const cell=(r,c)=>g[r+','+c]||[];const txt=(r,c)=>cell(r,c).join(' ').trim();
    let r0=-1;for(let r=0;r<6;r++)if(txt(r,0)==='월'&&txt(r,1)==='주'){r0=r;break}
    if(r0<0)continue;
    const cols={};for(let c=2;c<20;c++){const t=txt(r0,c);const i='월화수목금토'.indexOf(t);if(t.length===1&&i>=0)cols[i+1]=c}
    if(!cols[1]||!cols[5])continue;
    let month=null;
    for(let r=r0+1;r<200;r++){
      if(!Object.keys(g).some(k=>k.startsWith(r+',')))break;
      const c0=txt(r,0);if(/^수업/.test(c0))break;
      if(/^\d{1,2}$/.test(c0))month=+c0;
      if(!month)continue;
      let mo=month,prev=0,fri=null;
      for(let wd=1;wd<=5;wd++){const dc=cols[wd];const d=txt(r,dc);if(!/^\d{1,2}$/.test(d))continue;
        let dn=+d;if(dn<prev)mo=mo%12+1;prev=dn;const date=mk(yOf(mo),mo,dn);if(!date)continue;
        const real=new Date(date.replace(/-/g,'/')).getDay();if(real!==wd)warn.push(date+' 요일 불일치');
        if(wd===5)fri=date;day(date,wd,cell(r,dc+1));}
      if(cols[6]&&fri){const st=txt(r,cols[6]);if(st&&!/토요휴업/.test(st))out.push({date:nextDay(fri),end:'',title:st,note:st,noClass:true,rule:null,counter:''})}
    }
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  // vacations: extend "...방학" (Saturday column) to the day before the next class day
  for(const it of out)if(it.noClass&&/방학$/.test(it.title)&&it.title!=='방학'){
    const nx=out.find(x=>x.date>it.date&&x.counter);
    if(nx){let e=nx.date;const[y,mo,d]=e.split('-').map(Number);const x=new Date(y,mo-1,d-1);it.end=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}
    else it.end=`${sy+1}-02-28`;
    if(it.end<=it.date)it.end='';}
  // merge consecutive no-class ranges with same title
  const merged=[];const gap=(a,b)=>(new Date(b.replace(/-/g,'/'))-new Date(a.replace(/-/g,'/')))/864e5;
  const sameT=(a,b)=>a===b||(a==='방학'&&/방학$/.test(b))||(b==='방학'&&/방학$/.test(a));
  for(const it of out){
    if(it.noClass&&!it.rule){const last=merged.filter(x=>x.noClass&&!x.rule&&sameT(x.title,it.title)).pop();
      if(last&&gap(last.end||last.date,it.date)<=3){
        if(it.date<last.date)last.date=it.date;const e=it.end||it.date;if(e>(last.end||last.date))last.end=e;
        if(it.title.length>last.title.length)last.title=it.title;continue}}
    merged.push(it)}
  // "방학" weekday run followed by "여름방학" etc: absorb backwards
  for(let i=merged.length-1;i>0;i--){const a=merged[i-1],b=merged[i];
    if(a.noClass&&b.noClass&&!a.rule&&!b.rule&&sameT(a.title,b.title)&&gap(a.end||a.date,b.date)<=3){a.end=b.end||b.date;if(b.title.length>a.title.length)a.title=b.title;merged.splice(i,1)}}
  merged.forEach((x,i)=>x.id='a'+x.date.replace(/-/g,'')+'_'+i);
  return{items:merged,schoolYear:sy,warn};
}

export {splitSheets,parseDeptSheets,parseAcad,hwpTables};
