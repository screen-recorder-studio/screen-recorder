from pathlib import Path
import json, re, ssl, urllib.parse, urllib.request

ROOT = Path('packages/extension/static/_locales')
LOCALES = ['nl', 'pl', 'sv', 'fi', 'da', 'no', 'cs', 'hu', 'ro', 'uk']
BRAND_KEYS = {'studio_headerTitle', 'launcher_pageTitle', 'launcher_title'}
TERM_FIXES = {
    'nl': {'recordings': 'Opnames', 'recent': 'Recente opnames', 'open_recordings': 'Opnames openen', 'open_full': 'Volledige opnamelijst openen', 'open_manager': 'Opnamebeheer openen', 'prefix': 'Schermopname'},
    'pl': {'recordings': 'Nagrania', 'recent': 'Ostatnie nagrania', 'open_recordings': 'Otwórz nagrania', 'open_full': 'Otwórz pełną listę nagrań', 'open_manager': 'Otwórz menedżer nagrań', 'prefix': 'Nagranie ekranu'},
    'sv': {'recordings': 'Inspelningar', 'recent': 'Senaste inspelningar', 'open_recordings': 'Öppna inspelningar', 'open_full': 'Öppna hela inspelningslistan', 'open_manager': 'Öppna inspelningshanteraren', 'prefix': 'Skärminspelning'},
    'fi': {'recordings': 'Tallenteet', 'recent': 'Viimeisimmät tallenteet', 'open_recordings': 'Avaa tallenteet', 'open_full': 'Avaa kaikki tallenteet', 'open_manager': 'Avaa tallenteiden hallinta', 'prefix': 'Näytöntallenne'},
    'da': {'recordings': 'Optagelser', 'recent': 'Seneste optagelser', 'open_recordings': 'Åbn optagelser', 'open_full': 'Åbn alle optagelser', 'open_manager': 'Åbn optagelsesmanageren', 'prefix': 'Skærmoptagelse'},
    'no': {'recordings': 'Opptak', 'recent': 'Siste opptak', 'open_recordings': 'Åpne opptak', 'open_full': 'Åpne alle opptak', 'open_manager': 'Åpne opptaksbehandlingen', 'prefix': 'Skjermopptak'},
    'cs': {'recordings': 'Nahrávky', 'recent': 'Nedávné nahrávky', 'open_recordings': 'Otevřít nahrávky', 'open_full': 'Otevřít celý seznam nahrávek', 'open_manager': 'Otevřít správce nahrávek', 'prefix': 'Záznam obrazovky'},
    'hu': {'recordings': 'Felvételek', 'recent': 'Legutóbbi felvételek', 'open_recordings': 'Felvételek megnyitása', 'open_full': 'Összes felvétel megnyitása', 'open_manager': 'Felvételkezelő megnyitása', 'prefix': 'Képernyőfelvétel'},
    'ro': {'recordings': 'Înregistrări', 'recent': 'Înregistrări recente', 'open_recordings': 'Deschide înregistrările', 'open_full': 'Deschide toate înregistrările', 'open_manager': 'Deschide managerul de înregistrări', 'prefix': 'Înregistrare de ecran'},
    'uk': {'recordings': 'Записи', 'recent': 'Останні записи', 'open_recordings': 'Відкрити записи', 'open_full': 'Відкрити всі записи', 'open_manager': 'Відкрити менеджер записів', 'prefix': 'Запис екрана'},
}
PH_RE = re.compile(r'\$[A-Z_]+\$')
SEP = '[[[AUGSEP123]]]' 
CTX = ssl._create_unverified_context()

def protect(text):
    mp = {}
    def repl(m):
        t = f'__PH{len(mp)}__'
        mp[t] = m.group(0)
        return t
    return PH_RE.sub(repl, text), mp

def restore(text, mp):
    for k, v in mp.items():
        text = text.replace(k, v)
    return text

def fetch(texts, tl):
    enc, maps = [], []
    for t in texts:
        p, mp = protect(t)
        enc.append(p)
        maps.append(mp)
    q = f'\n{SEP}\n'.join(enc)
    url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t&tl=' + tl + '&q=' + urllib.parse.quote(q)
    with urllib.request.urlopen(url, timeout=60, context=CTX) as r:
        data = json.loads(r.read().decode('utf-8'))
    out = ''.join(part[0] for part in data[0]).split(SEP)
    out = [restore(x.strip(), mp) for x, mp in zip(out, maps)]
    if len(out) != len(texts):
        raise RuntimeError(f'translation split mismatch for {tl}: {len(out)} != {len(texts)}')
    return out

def key_order_and_blanks(raw):
    order, blanks, last = [], set(), None
    for line in raw.splitlines():
        s = line.strip()
        if s.startswith('"'):
            last = s.split('"', 2)[1]
            order.append(last)
        elif s == '' and last:
            blanks.add(last)
            last = None
    return order, blanks

en_raw = (ROOT / 'en' / 'messages.json').read_text(encoding='utf-8')
en = json.loads(en_raw)
order, blanks = key_order_and_blanks(en_raw)
base = json.loads((ROOT / 'nl' / 'messages.json').read_text(encoding='utf-8'))
same_keys = [k for k in order if base[k]['message'] == en[k]['message']]
msgs, seen = [], set()
for k in same_keys:
    m = en[k]['message']
    if m not in seen:
        seen.add(m)
        msgs.append(m)
for loc in LOCALES:
    data = json.loads((ROOT / loc / 'messages.json').read_text(encoding='utf-8'))
    trans = {}
    for i in range(0, len(msgs), 40):
        chunk = msgs[i:i+40]
        vals = fetch(chunk, loc)
        trans.update(dict(zip(chunk, vals)))
    for k in same_keys:
        data[k]['message'] = trans[en[k]['message']]
    t = TERM_FIXES[loc]
    for k in BRAND_KEYS:
        data[k]['message'] = 'Screen Recorder Studio'
    for k in ['control_openDriveTooltip', 'studio_driveTooltip', 'webRecord_openDriveTooltip']:
        data[k]['message'] = t['open_manager']
    for k in ['studio_driveText', 'launcher_drive', 'webRecord_driveBtn', 'studio_recentRecordings']:
        data[k]['message'] = t['recordings']
    data['studio_emptyOpenDrive']['message'] = t['open_recordings']
    data['drive_drawerOpenFull']['message'] = t['open_full']
    data['drive_drawerTitle']['message'] = t['recent']
    data['drive_recordingNamePrefix']['message'] = t['prefix']
    data['launcher_studio']['message'] = 'Studio'
    out = ['{']
    for i, k in enumerate(order):
        obj = {'message': data[k]['message']}
        if 'placeholders' in data[k]:
            obj['placeholders'] = data[k]['placeholders']
        line = f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(obj, ensure_ascii=False)}'
        if i < len(order) - 1:
            line += ','
        out.append(line)
        if k in blanks and i < len(order) - 1:
            out.append('')
    out.append('}')
    (ROOT / loc / 'messages.json').write_text('\n'.join(out) + '\n', encoding='utf-8')
    print('updated', loc)

