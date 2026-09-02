#!/usr/bin/env python3
"""ZTS-versie (2 sep 2026, afgeleid van osm/build_cards.py via maak_zts_build_cards.py).
Bouwt de statische toolkaarten in index.html uit data.json, zodat de
directory indexeerbaar is zonder JavaScript. Draait in de GitHub Action
(sync-data.yml) na elke update van de centrale affiliate-database.

Telt daarnaast per tool de in-depth reviews op aibuildermarketplace.com
(data-tool-attributen op /b2b/) en toont die op de kaart met een link naar
de artikelen. Lukt het ophalen niet, dan valt het terug op reviews.json.

Gebruik: python3 build_cards.py
"""
import html
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import quote



# AIBM zet een KORT label in de badge; die heeft white-space:nowrap, dus een
# volle categorienaam schuift over de toolnaam heen.
KORT = {
    "Financial Operations": "Finance", "Finance & Accounting": "Accounting",
    "IT & Productivity": "IT", "HR & People": "HR", "Growth & Revenue": "Growth",
    "Sales & CRM": "CRM", "SEO & Marketing": "SEO", "Customer Support": "Support",
    "Communication & Voice": "Voice", "Operations & Workflow": "Ops",
    "Business Operations": "Ops", "Design & Content": "Design",
    "Content & Media": "Media", "Video & Audio": "Video",
}


def badge(cat):
    return KORT.get(cat, cat.split("&")[0].strip().split(" ")[0])


def tags(cat):
    """De categorie opgesplitst, zoals AIBM: 'Growth & Revenue' -> Growth, Revenue."""
    delen = [d.strip() for d in cat.split("&") if d.strip()]
    return "".join(f'<span class="tool-tag">{html.escape(d)}</span>' for d in delen)


KAART_CSS = """/* FILTER */
.filter-bar{display:flex;justify-content:center;gap:8px;margin-bottom:40px;flex-wrap:wrap}
.filter-btn{background:var(--surface);border:1px solid var(--border);color:var(--text-2);padding:8px 16px;border-radius:999px;font-size:.85rem;font-weight:500;transition:all .15s}
.filter-btn:hover{border-color:var(--border-hi);color:var(--text)}
.filter-btn.active{background:var(--text);border-color:var(--text);color:var(--bg)}
/* TOOLS GRID */
.tools-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.tool-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:26px 26px 22px;transition:border-color .25s var(--ease),transform .25s var(--ease),box-shadow .25s var(--ease);display:flex;flex-direction:column;position:relative;overflow:hidden;box-shadow:var(--shadow-card)}
.tool-card:hover{border-color:var(--border-hi);transform:translateY(-3px);box-shadow:0 12px 32px -16px rgba(0,0,0,.6)}
.tool-card.featured{border-color:rgba(59,130,246,.4)}
.tool-card.featured::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 0% 0%,rgba(59,130,246,.08),transparent 50%);pointer-events:none}
.tool-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
.tool-card-header{display:flex;align-items:center;gap:14px;min-width:0}
.tool-logo{width:42px;height:42px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:#fff;letter-spacing:-.02em}
.tool-card h3{font-size:1.15rem;font-weight:700;letter-spacing:-.01em}
.tool-badge{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:4px 8px;border-radius:6px;white-space:nowrap;flex-shrink:0}
.tool-badge.pick{background:rgba(59,130,246,.12);color:var(--accent-2);border:1px solid rgba(59,130,246,.25)}
.tool-badge.deal{background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.22)}
.tool-rating{display:flex;align-items:center;gap:8px;margin-top:24px;margin-bottom:10px;font-size:.82rem;color:var(--text-2)}
.tool-rating .stars{color:var(--amber);letter-spacing:1px}
.tool-desc{color:var(--text-2);font-size:.92rem;line-height:1.6;flex-grow:1;margin-bottom:16px}
.tool-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px}
.tool-tag{font-size:.72rem;font-weight:500;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);padding:3px 9px;border-radius:6px}
.tool-cta-row{display:flex;gap:10px;align-items:center}
.tool-cta-primary{flex:1;background:var(--text);color:var(--bg);padding:11px 14px;border-radius:9px;font-weight:600;font-size:.88rem;text-align:center;transition:opacity .15s,transform .15s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.tool-cta-primary:hover{opacity:.88;transform:translateY(-1px)}
.tool-cta-secondary{color:var(--accent-2);font-size:.85rem;font-weight:600;transition:gap .15s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tool-cta-secondary:hover{gap:9px}
.tools-grid,.how-grid,.social-grid{grid-template-columns:repeat(2,1fr)}
.tools-grid,.social-grid{grid-template-columns:1fr}
@media(max-width:960px){.tools-grid,.how-grid,.social-grid{grid-template-columns:repeat(2,1fr)}
 .how-grid{grid-template-columns:1fr}
 .footer-inner{grid-template-columns:1fr 1fr 1fr}
 .compare-card{grid-template-columns:1fr;text-align:left}}
@media(max-width:720px){.nav-inner{flex-wrap:nowrap;gap:10px}
 .nav-links{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-wrap:nowrap;white-space:nowrap;mask-image:linear-gradient(90deg,#000 88%,transparent)}
 .nav-links::-webkit-scrollbar{display:none}
 .nav-links a{font-size:.78rem;margin-left:12px;flex-shrink:0}
 .nav-links a.nav-cta{display:none}
 .nav-links .nav-dd{display:contents}
 .nav-links .nav-dd-toggle{display:none}
 .nav-links .nav-dd-menu{display:contents !important;position:static;background:none;border:0;box-shadow:none;padding:0;margin:0}
 .nav-links .nav-dd-menu a{padding:0;border-radius:0;font-size:.78rem;margin-left:12px;flex-shrink:0}
 .hero{padding:130px 24px 60px}
 .stats-inner{grid-template-columns:repeat(2,1fr)}
 .stat-item:nth-child(2){border-right:none}
 .stat-item:nth-child(1),.stat-item:nth-child(2){border-bottom:1px solid var(--border)}
 .tools-grid,.social-grid{grid-template-columns:1fr}
 .section{padding:70px 24px 40px}
 .how-section{padding:70px 24px;margin-top:50px}
 .footer-inner{grid-template-columns:1fr 1fr;gap:28px}
 .footer-bottom{flex-direction:column;text-align:center}
 .cta-inner{padding:44px 24px}
 .mobile-cta{display:block}
 body{padding-bottom:76px}
 .trust-band-inner{font-size:.7rem;gap:14px}}\n/* zusters: het grid is smaller dan op AIBM (286px tegen ~380px), dus de\n   naam moet kunnen krimpen en afbreken -- anders valt de nowrap-badge er\n   overheen bij lange namen */\n.tool-card-header{min-width:0;flex:1 1 auto}\n.tool-card h3{min-width:0;overflow-wrap:anywhere;hyphens:auto}\n.tool-badge{flex:0 0 auto}\n#infrastructure .tools-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-width:1200px;margin:0 auto}\n@media(max-width:1024px){#infrastructure .tools-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:720px){#infrastructure .tools-grid{grid-template-columns:1fr}}\n#infrastructure .tool-card h3{font-size:1.15rem;margin:0}\n#infrastructure .tool-card p{margin:0 0 12px}\n#infrastructure .tool-card a{text-decoration:none}\n\n/* KAART_V2 (2 sep 2026): prijs, adder, best-for en twee knoppen */\n.tool-card{padding:24px 24px 20px;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0)) ,var(--surface)}\n.tool-card::after{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(135deg,rgba(129,140,248,.55),rgba(52,211,153,.25) 45%,rgba(129,140,248,0) 70%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .3s var(--ease);pointer-events:none}\n.tool-card:hover::after{opacity:1}\n.tool-card:hover{transform:translateY(-4px);box-shadow:0 22px 44px -18px rgba(99,102,241,.35),0 12px 32px -16px rgba(0,0,0,.7)}\n.tc-stripe{position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--accent),rgba(129,140,248,0) 80%);opacity:.9}\n.tool-logo{width:46px;height:46px;border-radius:12px;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 6px 16px -8px rgba(0,0,0,.8)}\n.tc-price{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px;margin:2px 0 12px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid var(--border)}\n.tc-price b{font-size:1.45rem;font-weight:800;letter-spacing:-.02em;color:var(--text);font-variant-numeric:tabular-nums}\n.tc-price span{font-size:.78rem;color:var(--text-3)}\n.tc-price em{font-style:normal;margin-left:auto;font-size:.66rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);border:1px solid var(--border);border-radius:999px;padding:2px 8px;white-space:nowrap}\n.tc-pw{font-size:.66rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:2px 8px;white-space:nowrap}\n.tc-pw.held{color:var(--green);border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.08)}\n.tc-pw.increase{color:#fb7185;border:1px solid rgba(251,113,133,.35);background:rgba(251,113,133,.08)}\n.tc-pw.decrease{color:var(--green);border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.08)}\n.tc-pw.restructure,.tc-pw.withdrawn{color:#c4b5fd;border:1px solid rgba(167,139,250,.35);background:rgba(167,139,250,.08)}\n.tool-desc{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:12px}\n.tc-catch,.tc-best{font-size:.84rem;line-height:1.5;margin:0 0 10px;padding-left:12px;border-left:2px solid var(--amber);color:var(--text-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}\n.tc-best{border-left-color:var(--green)}\n.tc-catch b,.tc-best b{font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-right:6px}\n.tc-best b{color:var(--green)}\n.tool-tags{margin-top:auto;margin-bottom:16px}\n.tool-card{container-type:inline-size}.tool-cta-row{gap:8px;flex-direction:column;align-items:stretch}.tool-cta-review{flex:1 1 auto}.tool-cta-primary{white-space:nowrap}.tc-catch{-webkit-line-clamp:3}\n/* KAART_V3: Atlas-chips en vlagkleur op de linkerrand */\n.tool-card{border-left:3px solid var(--border-hi)}\n.tool-card[data-flag=quote_only]{border-left-color:#f59e0b}\n.tool-card[data-flag=per_seat]{border-left-color:#60a5fa}\n.tool-card[data-flag=usage_metered]{border-left-color:#a78bfa}\n.tool-card[data-flag=renewal_jump]{border-left-color:#fb7185}\n.tool-card[data-flag=addons_extra]{border-left-color:#c084fc}\n.tool-card[data-flag=annual_lock]{border-left-color:#f472b6}\n.tool-card[data-flag=free_tier]{border-left-color:#34d399}\n.tc-flags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}\n.tc-flag{font-size:.72rem;font-weight:600;color:var(--text-2);background:rgba(255,255,255,.04);border:1px solid var(--border-hi);border-radius:999px;padding:3px 10px;white-space:nowrap}\n.tc-price .fp{font-size:.8rem;font-weight:700;color:var(--text-3);margin-right:2px}\n.tc-price b.na{font-size:.95rem;font-weight:700;color:var(--text-3)}\n/* KAART_V4: vaste hoogtes voor uitlijning tussen kaarten */\n.tc-price{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;row-gap:6px;align-items:baseline;min-height:74px}\n.tc-price b{grid-row:1;grid-column:1}\n.tc-price>span:not(.tc-pw):not(.tc-chips){grid-row:1;grid-column:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.tc-price .tc-chips{grid-row:2;grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:20px}\n.tc-price em{margin-left:auto}\n.tool-desc{-webkit-line-clamp:5;min-height:calc(1.6em*5)}\n.tc-catch{-webkit-line-clamp:3;min-height:calc(1.5em*3)}\n.tc-best{-webkit-line-clamp:3;min-height:calc(1.5em*3)}\n.tc-flags{min-height:26px}\n.tc-flag{font-size:.68rem;padding:2px 8px}\n.tool-tags{min-height:24px}\n/* KAART_V5 */.tc-alt{min-height:18px;margin:0 0 8px;font-size:.72rem;color:var(--text-3)}.tc-alt>div{margin:0!important}\n.tc-price b .fp{font-size:.78rem;font-weight:700;color:var(--text-3);margin-right:3px;letter-spacing:0}\n\n\n.tool-cta-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 8px 20px -10px rgba(99,102,241,.8)}\n.tool-cta-primary:hover{opacity:1;transform:translateY(-1px);box-shadow:0 12px 24px -10px rgba(99,102,241,.9)}\n.tool-cta-review{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 12px;border-radius:9px;border:1px solid var(--border-hi);color:var(--text);font-weight:600;font-size:.86rem;background:rgba(255,255,255,.02);transition:border-color .15s,background .15s,transform .15s;white-space:nowrap}\n.tool-cta-review:hover{border-color:var(--accent);background:rgba(129,140,248,.08);transform:translateY(-1px)}\n"""

PALET = "--bg:#020617;--bg-2:#0b1120;--surface:#0f172a;--surface-2:#1e293b;--border:#1e293b;--border-hi:#334155;--text:#f8fafc;--text-2:#cbd5e1;--text-3:#94a3b8;--accent:#818cf8;--accent-2:#a5b4fc;--green:#34d399;--amber:#fbbf24;--radius:16px;--radius-sm:11px;--max:1200px;--ease:cubic-bezier(.22,.68,.24,1);--shadow-card:0 1px 0 rgba(255,255,255,.035) inset,0 24px 48px -28px rgba(0,0,0,.75);--shadow-pop:0 20px 60px -18px rgba(0,0,0,.8);"

KNOP = ("filter-btn")


def filterknoppen(tools):
    """De knoppenrij uit dezelfde tools als de kaarten.

    Hardgecodeerd liep hij scheef zodra de snede veranderde: drie knoppen
    filterden naar nul kaarten en vier aanwezige categorieen hadden er geen.
    """
    kl = ("cat-btn px-6 py-2.5 rounded-full border border-slate-700/50 "
          "bg-slate-900/50 text-sm font-medium text-slate-400 hover:text-white "
          "hover:border-slate-500 transition-all duration-300 backdrop-blur-sm")
    cats = sorted({t["category"] for t in tools if t.get("category")})
    rij = [f'<button onclick="filterTools(\'All\')" data-cat="All" '
           f'class="{kl} active">All Tools</button>']
    for c in cats:
        v = html.escape(c, quote=True)
        rij.append(f'<button onclick="filterTools(\'{v}\')" data-cat="{v}" '
                   f'class="{kl}">{html.escape(c)}</button>')
    return "\n                ".join(rij)


FILTER_JS = """<script id="aibm-filter">
window.filterTools = function (c) {
  document.querySelectorAll('.cat-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.cat === c);
  });
  document.querySelectorAll('article.tool-card').forEach(function (k) {
    k.style.display = (c === 'All' || k.dataset.category === c) ? '' : 'none';
  });
};
</script>"""

def _kaart_desc(t, grens=300):
    """Kaarttekst afklemmen op zinsgrens.

    4 aug 2026: het desc-veld uit de affiliate-database wordt hier letterlijk
    gerenderd. De mediaan is 152 tekens, maar verrijking heeft er bij zestien
    tools een alinea van gemaakt — Amplemarket stond op 2.269 en trok de hele
    grid scheef. De volledige tekst blijft in de database staan (hij komt
    nergens anders voor); alleen de kaart toont een kortere versie.

    Zoveel hele zinnen als er binnen de limiet passen. Past er geen enkele hele
    zin, dan knippen op een woordgrens met één beletselteken — maar niet als de
    knip al op interpunctie eindigt, want "wint.…" leest als een typefout.
    """
    d = (t.get("desc") or "").strip()
    if len(d) <= grens:
        return d
    kort = d[:grens]
    zinseindes = [m.end() for m in re.finditer(r"[.!?](?:\s|$)", kort)]
    if zinseindes:
        return kort[:zinseindes[-1]].strip()
    knip = kort.rsplit(" ", 1)[0].rstrip(",;:— ")
    return knip if knip.endswith((".", "!", "?")) else knip + "\u2026"



START = "<!-- TOOLS:START (auto-generated by build_cards.py — niet handmatig bewerken) -->"
END = "<!-- TOOLS:END -->"
AIBM_B2B = "https://aibuildermarketplace.com/b2b/"

CARD = """\
<article class="tool-card fade-in" data-category="{category_attr}"{flag_attr}>
 <span class="tc-stripe" aria-hidden="true"></span>
 <div class="tool-card-top">
  <div class="tool-card-header">
   <div class="tool-logo" style="background:#fff;box-sizing:border-box;padding:6px">
    <img src="https://logo.clearbit.com/{domain}" alt="{name}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain" onerror="this.onerror=null;this.src='https://www.google.com/s2/favicons?domain={domain}&amp;sz=64'">
   </div>
   <h3>{name}</h3>
  </div>
  <span class="tool-badge pick">{badge}</span>
 </div>\n <div class="tc-alt">{alt_row}</div>{reviews_row}{price_row}
 <p class="tool-desc">{desc}</p>{best_row}{catch_row}{flags_row}
 <div class="tool-tags">{tags}</div>
 <div class="tool-cta-row">
  <a href="{link}" target="_blank" rel="sponsored noopener noreferrer" class="tool-cta-primary">Visit {name} <span aria-hidden="true">&rarr;</span></a>
  {review_link}
 </div>
</article>"""

# rel=nofollow sinds 12 aug 2026: dit zijn ~350 kruislinks naar een site van
# dezelfde eigenaar. Ze mogen lezers sturen (dat doen ze goed: 14,9 pagina's
# per sessie), maar geen ranking-signaal dragen.
REVIEWS_ROW = """
                    <a href="{reviews_url}" target="_blank" rel="nofollow noopener" class="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white mb-3 transition-colors"><span class="text-emerald-400">&#9679;</span> {n} in-depth review{s} &rarr;</a>"""


# Tools met een handgebouwde single-page hero op AIBM (niet in de auto-gegenereerde
# /b2b/-index, dus tel-mechanisme vindt ze niet). Directe koppeling + telling.
DIRECT_REVIEWS = {
    "Aspire": ("https://aibuildermarketplace.com/b2b/aspire-review/", 1),
    "1Password": ("https://aibuildermarketplace.com/b2b/1password-review/", 1),
    "Payoneer": ("https://aibuildermarketplace.com/b2b/payoneer-review/", 1),
    "NordVPN": ("https://aibuildermarketplace.com/b2b/nordvpn-review/", 1),
    "Apollo": ("https://aibuildermarketplace.com/b2b/apollo-review/", 1),
    "Streak": ("https://aibuildermarketplace.com/b2b/streak-review/", 1),
    "AWeber": ("https://aibuildermarketplace.com/b2b/aweber-review/", 1),
}


ALT_ROW = """\n                    <div class="text-[11px] text-slate-500 mb-3">&#8596; Alternative to <span class="text-slate-300 font-medium">{leader}</span></div>"""


def alt_row_for(t):
    """Op ZTS: link naar de eigen case-study-pagina (pylon.html, surveysparrow.html)
    als die bestaat, zodat die pagina's hun inkomende link houden."""
    sl = re.sub(r"[^a-z0-9]+", "-", t["name"].lower()).strip("-")
    CASE = {"800.com": "800.html"}  # bestandsnaam wijkt af van de slug
    bestand = CASE.get(t["name"], f"{sl}.html")
    hier = Path(__file__).parent / bestand
    if hier.is_file():
        return (f'\n <div style="font-size:.74rem;color:var(--text-3);margin:0 0 10px">'
                f'<a href="/{bestand}" style="color:var(--accent-2)">Read the case study &rarr;</a></div>')
    r = t.get("replaces")
    if not r:
        return ""
    return _alt_met_link(ALT_ROW.format(leader=html.escape(r)))


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def fetch_review_counts(root):
    """Tel data-tool-voorkomens op de live AIBM-reviewsindex; cache in reviews.json."""
    cache = root / "reviews.json"
    try:
        with urllib.request.urlopen(AIBM_B2B, timeout=20) as r:
            page = r.read().decode("utf-8", errors="replace")
        counts = {}
        for tool in re.findall(r'data-tool="([^"]+)"', page):
            counts[tool] = counts.get(tool, 0) + 1
        if counts:
            cache.write_text(json.dumps(counts, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            return counts
    except Exception as e:
        print(f"waarschuwing: AIBM-fetch mislukt ({e}); gebruik cache")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    return {}



SITEMAP = "https://aibuildermarketplace.com/sitemap.xml"


def fetch_review_slugs(root):
    """Welke reviewpagina's bestaan er op AIBM? Uit de sitemap, met cache.

    Waarom niet het bestandssysteem: de oude aanpak keek naar een map naast
    deze repo, en die bestaat alleen lokaal. In de GitHub Action was hij altijd
    leeg, waardoor 310 tools geen deeplink kregen en er maar 7 overbleven uit
    een handmatig lijstje.
    """
    cache = root / "review_slugs.json"
    try:
        with urllib.request.urlopen(SITEMAP, timeout=25) as r:
            xml = r.read().decode("utf-8", errors="replace")
        slugs = sorted(set(re.findall(r"/b2b/([a-z0-9-]+-review)/", xml)))
        if slugs:
            cache.write_text(json.dumps(slugs, indent=1), encoding="utf-8")
            return set(slugs)
    except Exception as e:
        print(f"waarschuwing: sitemap-fetch mislukt ({e}); gebruik cache")
    if cache.exists():
        return set(json.loads(cache.read_text(encoding="utf-8")))
    return set()

# ── De snede van deze site ────────────────────────────────────────────────
# 1 sep 2026: deze pagina toonde alle 424 tools uit de centrale database --
# 420 koppen en 413 sponsored links op een pagina van 19.301 woorden, oftewel
# 46 woorden per tool. Dat is precies de dunne-affiliate-vorm die AIBM in juni
# heeft geraakt, en de enige zustersite die wel indexeert (ZTS) is toevallig
# ook de enige zonder zo'n mega-pagina.
#
# Office Software Marketplace houdt daarom de categorieen die bij zijn naam
# horen: kantoor, productiviteit, IT en finance. De rest blijft gewoon op
# aibuildermarketplace.com staan, waar het dossier hoort -- dit is een keuze
# over waar iets thuishoort, niet over wat we publiceren.
SNEDE = {
    "Communication & Voice",
    "Customer Support",
}


def in_snede(t):
    return t.get("category") in SNEDE


EIGEN_REVIEW_ROW = (
    '<div class="tool-rating"><span style="color:var(--accent-2)">'
    '&#9679;</span> our own {name} review</div>'
)

REVIEW_LINK = (
    '<a href="{url}"{rel} class="tool-cta-review">Honest review '
    '<span aria-hidden="true">&rarr;</span></a>'
)


def eigen_review(root, naam):
    """Pad naar onze eigen reviewpagina op deze site, of None."""
    slug = re.sub(r"[^a-z0-9]+", "-", naam.lower()).strip("-") + "-review"
    return f"{slug}.html" if (root / f"{slug}.html").is_file() else None


def _alt_met_link(html_uit, root=None):
    """Maak 'Alternative to X' klikbaar als we een review over X hebben.

    Platte tekst is hier zonde: dit is precies de vergelijking waar de lezer
    naar op zoek is. Alleen linken als de pagina bestaat -- een dode link is
    erger dan geen link.
    """
    m = re.search(r'<span[^>]*>([^<]+)</span>', html_uit)
    if not m:
        return html_uit
    naam = m.group(1).strip()
    sl = re.sub(r"[^a-z0-9]+", "-", naam.lower()).strip("-") + "-review"
    hier = Path(__file__).parent / f"{sl}.html"
    if hier.is_file():
        doel, rel = f"/{sl}.html", ""
    elif sl in _AIBM_REVIEWS:
        doel = f"https://aibuildermarketplace.com/b2b/{sl}/"
        rel = ' target="_blank" rel="nofollow noopener"'
    else:
        return html_uit
    return html_uit.replace(
        m.group(0),
        f'<a href="{doel}"{rel} class="underline decoration-dotted '
        f'hover:text-indigo-300">{m.group(1)}</a>')


_AIBM_REVIEWS = set()


# ── KAART_V2: extra velden uit cards_extra.json (build_zuster_kaartdata.py) ──
_MAAND_KORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _datum_kort(s):
    try:
        j, m, d = str(s).split("-")
        return f"{int(d)} {_MAAND_KORT[int(m)]} {j}"
    except (ValueError, IndexError):
        return str(s)


def price_row(e):
    """Prijsregel met datumchip en Price Watch-stand; leeg zonder prijs."""
    if not e.get("price"):
        return _leeg_prijsblok(e)
    chips = ""
    if e.get("pw"):
        chips += f'<span class="tc-pw {html.escape(e.get("pw_soort", "held"))}">{html.escape(e["pw"])}</span>'
    if e.get("verified"):
        chips += f'<em>read {html.escape(_datum_kort(e["verified"]))}</em>'
    fp = '<span class="fp">from ~</span>' if str(e.get("price_note", "")).startswith("from") else ""
    note = str(e.get("price_note", "")).replace("from · ", "")
    return (f'\n <div class="tc-price"><b>{fp}{html.escape(e["price"])}</b>'
            f'<span>{html.escape(note)}</span><span class="tc-chips">{chips}</span></div>')


def catch_row(e):
    return (f'\n <p class="tc-catch"><b>The catch</b>{html.escape(e["catch"])}</p>'
            if e.get("catch") else "")


def best_row(e):
    return (f'\n <p class="tc-best"><b>Best for</b>{html.escape(e["best"])}</p>'
            if e.get("best") else "")


def lees_extra(root):
    p = root / "cards_extra.json"
    if p.is_file():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


# ── KAART_V3: Atlas-chips ──
def flags_row(e):
    fl = e.get("flags") or []
    if not fl:
        return ""
    chips = "".join(f'<span class="tc-flag" title="{html.escape(k, quote=True)}">'
                    f'{html.escape(i)} {html.escape(l)}</span>' for i, l, k in fl)
    return f'\n <div class="tc-flags">{chips}</div>'


def flag_attr(e):
    fl = e.get("flags") or []
    return f' data-flag="{html.escape(fl[0][2], quote=True)}"' if fl else ""


# ── KAART_V4: prijsblok altijd even hoog ──
def _leeg_prijsblok(e):
    if e.get("price_state") == "quote-only":
        return '\n <div class="tc-price"><b class="na">quote-only</b><span>no public price list</span><span class="tc-chips"></span></div>'
    chips = f'<span class="tc-pw {html.escape(e.get("pw_soort", "held"))}">{html.escape(e["pw"])}</span>' if e.get("pw") else ""
    return f'\n <div class="tc-price"><b class="na">see the review</b><span>pricing read on the vendor page</span><span class="tc-chips">{chips}</span></div>'


def main():
    root = Path(__file__).parent
    tools = json.loads((root / "data.json").read_text(encoding="utf-8"))
    voor = len(tools)
    tools = [t for t in tools if in_snede(t)]
    tools.sort(key=lambda t: t["name"].lower())
    extra = lees_extra(root)
    print(f"snede: {len(tools)} van {voor} tools "
          f"({', '.join(sorted(SNEDE))})")

    raw_counts = fetch_review_counts(root)
    counts = {norm(k): (k, v) for k, v in raw_counts.items()}

    # De reviewpagina's uit de sitemap in plaats van uit een map naast deze
    # repo — dat pad bestaat niet in de GitHub Action, waardoor hier jarenlang
    # een lege verzameling stond en vrijwel geen tool een deeplink kreeg.
    review_folders = fetch_review_slugs(root)
    aibm_b2b = root.parent / "aibuildermarketplace-main" / "b2b"
    if aibm_b2b.is_dir():
        review_folders |= {p.name for p in aibm_b2b.iterdir() if p.is_dir()}
    _AIBM_REVIEWS.update(review_folders)

    def _rslug(name):
        return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + "-review"

    # ecosysteem-UTM zodat cross-site clicks naar AIBM als 'ecosystem' attribueren
    # i.p.v. (direct)/(none) in GA4
    def _eco(u):
        return u + ("&" if "?" in u else "?") + "utm_source=zerotouchsupport&utm_medium=ecosystem"

    def review_link(t):
        """De tweede knop in de CTA-rij: naar onze eigen review, of naar AIBM."""
        _eigen = eigen_review(root, t["name"])
        if _eigen:
            return REVIEW_LINK.format(url=_eigen, rel="")
        rs = _rslug(t["name"])
        if rs in review_folders:
            return REVIEW_LINK.format(
                url=_eco(f"https://aibuildermarketplace.com/b2b/{rs}/"),
                rel=' target="_blank" rel="nofollow noopener"')
        return ""

    def reviews_row(t):
        """Leeg: REVIEWTELLER WEG (1 sep 2026).

        Hier stond "N in-depth reviews". Dat getal kwam uit een cache van een
        meting die niet meer werkt -- /b2b/ heeft geen data-tool-attributen
        meer -- en elke tool heeft er sowieso maar een. De Review-knop in de
        CTA-rij is de enige link die we nodig hebben.
        """
        return ""

    cards = "\n".join(
        CARD.format(
            category_attr=html.escape(t["category"], quote=True),
            category=html.escape(t["category"]),
            domain=html.escape(t.get("domain", "example.com"), quote=True),
            name=html.escape(t["name"]),
            desc=html.escape(_kaart_desc(t)),
            link=html.escape(t["link"], quote=True),
            reviews_row=reviews_row(t),
            alt_row=alt_row_for(t),
            badge=html.escape(badge(t["category"])),
            tags=tags(t["category"]),
            review_link=review_link(t),
            price_row=price_row(extra.get(t["name"], {})),
            catch_row=catch_row(extra.get(t["name"], {})),
            best_row=best_row(extra.get(t["name"], {})),
            flags_row=flags_row(extra.get(t["name"], {})),
            flag_attr=flag_attr(extra.get(t["name"], {})),
        )
        for t in tools
    )

    index = (root / "index.html").read_text(encoding="utf-8")
    # het onaangeroerde origineel bewaren: de injectie hieronder wijzigt
    # `index`, en dan zou de vergelijking aan het eind zijn eigen
    # wijziging niet meer zien
    _origineel = index

    # kaart-CSS van AIBM, in het palet van deze site. Gemarkeerd blok, zodat een
    # herbouw hem vervangt in plaats van er nog een toe te voegen.
    _css = (f"<style id=\"aibm-kaarten\">#infrastructure{{{PALET}}}\n{KAART_CSS}</style>\n{FILTER_JS}")
    # eerst alle eerder ingespoten blokken weg, anders stapelen ze op
    for _pat in (r'<style id="aibm-kaarten">.*?</style>',
                 r'<script id="aibm-filter">.*?</script>',
                 r'<script>\s*document\.querySelectorAll\(\'\.filter-btn\'\).*?</script>'):
        index = re.sub(_pat, "", index, flags=re.S)
    index = index.replace("</head>", _css + "\n</head>", 1)

    # knoppenrij uit dezelfde tools als de kaarten
    _knoppen = filterknoppen(tools)
    # de rij bevat alleen <button>-elementen, dus dit sluit exact af
    index, _n = re.subn(
        r'(<div[^>]*id="filter-buttons">)(?:\s*<button\b.*?</button>)+(\s*</div>)',
        lambda m: m.group(1) + "\n                " + _knoppen + m.group(2),
        index, count=1, flags=re.S)
    if not _n:
        print("  let op: knoppenrij niet vervangen")
    pattern = re.compile(re.escape(START) + ".*?" + re.escape(END), re.S)
    block = f"{START}\n{cards}\n                {END}"
    if not pattern.search(index):
        raise SystemExit("Markers TOOLS:START/TOOLS:END niet gevonden in index.html")
    new_index = pattern.sub(lambda m: block, index)

    # JSON-LD ItemList synchroon houden
    items = [
        {
            "@type": "ListItem",
            "position": i + 1,
            "name": t["name"],
            "url": f"https://{t['domain']}" if t.get("domain") else None,
        }
        for i, t in enumerate(tools)
    ]
    for it in items:
        if it["url"] is None:
            del it["url"]
    itemlist = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "ZeroTouch Support directory",
            "numberOfItems": len(tools),
            "itemListElement": items,
        },
        ensure_ascii=False,
    )
    new_index = re.sub(
        r'(<script type="application/ld\+json" id="itemlist-schema">).*?(</script>)',
        lambda m: m.group(1) + itemlist + m.group(2),
        new_index,
        flags=re.S,
    )

    if new_index != _origineel:
        (root / "index.html").write_text(new_index, encoding="utf-8")
        print(f"index.html bijgewerkt: {len(tools)} kaarten")
    else:
        print(f"geen wijzigingen ({len(tools)} kaarten)")


if __name__ == "__main__":
    main()
