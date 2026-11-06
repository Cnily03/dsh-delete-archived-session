#!/usr/bin/env python3
"""Generate the README screenshots from real DSH icons and tokens.

Produces four PNGs (en/zh x normal/armed) rendered from HTML via headless
chromium. Run from the plugin root; writes into assets/.
"""
import html
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
WORK = Path("/tmp/adsd-shotgen")
WORK.mkdir(exist_ok=True)

# Real DSH icon inner markup (viewBox 0 0 16 16), stroke-width 1.3 at 14-16px.
ICONS = {
    "search": '<path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z" stroke="currentColor"/><path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor"/>',
    "sliders": '<path d="M2.3 5h5.85M12.05 5h1.65" stroke="currentColor"/><circle cx="9.95" cy="5" r="1.45" stroke="currentColor"/><path d="M2.3 11h1.65M7.85 11h5.85" stroke="currentColor"/><circle cx="5.75" cy="11" r="1.45" stroke="currentColor"/>',
    "projectadd": '<path d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z" fill="currentColor"/><path d="M9.75977 4.50208H14.5509" stroke="currentColor"/><path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor"/>',
    "folder": '<path d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z" stroke="currentColor"/><path d="M3.63501 7.66614H12.3647" stroke="currentColor"/>',
    "ellipsis": '<path d="M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z" fill="currentColor"/><path d="M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" fill="currentColor"/><path d="M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z" fill="currentColor"/>',
    "archive": '<path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor"/><path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5" stroke="currentColor"/><path d="M6.5 9.5H9.5" stroke="currentColor"/>',
    "trash": '<path d="M1.28149 3.88831H14.7187" stroke="currentColor"/><path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" stroke="currentColor"/><path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" stroke="currentColor"/><path d="M6.44946 6.98926V11.1238" stroke="currentColor"/><path d="M9.55054 6.98926V11.1238" stroke="currentColor"/>',
}

STRINGS = {
    "en": {
        "workspaces": "Workspaces",
        "default": "Default workspace",
        "active": "DeepSeek 💙🧡 Claude",
        "time_active": "5min",
        "archived": "Never gonna make you cry",
        "time_archived": "20h",
        "hover": "Never gonna say good bye",
        "tip_normal": "Delete archived session",
        "tip_armed": "Permanently delete",
    },
    "zh": {
        "workspaces": "工作区",
        "default": "默认工作区",
        "active": "DeepSeek 💙🧡 Claude",
        "time_active": "5分钟",
        "archived": "如何拯救被严格管束的美国千金女孩",
        "time_archived": "20小时",
        "hover": "母猪的产后护理教程",
        "tip_normal": "删除归档会话",
        "tip_armed": "彻底删除",
    },
}


def svg(inner, size=14, stroke="currentColor", sw="1.3", extra=""):
    return (
        f'<svg viewBox="0 0 16 16" fill="none" stroke-width="{sw}" '
        f'stroke-linecap="round" stroke-linejoin="round" {extra}>{inner}</svg>'
    )


def page(lang, armed):
    s = STRINGS[lang]
    del_cls = "slot del armed" if armed else "slot del"
    tip_cls = "tip armed" if armed else "tip normal"
    tip_txt = s["tip_armed"] if armed else s["tip_normal"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
:root {{
  --bg:#212121; --row-hover:#313131; --label-primary:#ffffff;
  --label-tertiary:#8b8c8e; --label-caption:#8b8c8e;
  --deepseek:#4D6BFE; --tooltip-bg:#46474b; --tooltip-fg:#ffffff; --error:#ff5c5c;
}}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{background:transparent}}
.shot{{width:360px;height:280px;position:relative;background:var(--bg);border-radius:10px;overflow:hidden;
  font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}}
.hdr{{position:absolute;top:15px;left:16px;color:var(--label-tertiary);font-size:13px;font-weight:500}}
.hdr-icons{{position:absolute;top:18px;right:16px;display:flex;gap:14px;color:var(--label-tertiary)}}
.hdr-icons svg{{width:16px;height:16px}}
.folder{{position:absolute;top:52px;left:16px;display:flex;align-items:center;gap:9px}}
.folder svg{{width:16px;height:16px;color:var(--deepseek)}}
.folder span{{color:var(--label-primary);font-size:14px;font-weight:500}}
.row{{position:absolute;left:8px;width:344px;height:32px;border-radius:8px;display:flex;align-items:center;padding:0 16px}}
.row.active{{top:86px;background:var(--row-hover)}}
.row.arch1{{top:122px}}
.row.arch2{{top:158px;background:var(--row-hover)}}
.row .title{{font-size:14px;line-height:20px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.row.active .title{{color:var(--label-primary)}}
.row.arch1 .title,.row.arch2 .title{{color:var(--label-caption)}}
.row .time{{color:var(--label-tertiary);font-size:10px;line-height:16px;margin-left:8px}}
.actions{{display:flex;align-items:center;gap:13px;color:var(--label-tertiary)}}
.actions .slot{{width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center}}
.actions .slot svg{{width:14px;height:14px;display:block}}
.slot.del{{color:#d6d6d8}}
.slot.del.armed{{color:var(--error)}}
.tip{{position:absolute;top:198px;right:10px;height:24px;border-radius:6px;background:var(--tooltip-bg);
  color:var(--tooltip-fg);font-size:12.5px;line-height:24px;padding:0 9px;white-space:nowrap}}
</style></head><body>
<div class="shot">
  <div class="hdr">{html.escape(s["workspaces"])}</div>
  <div class="hdr-icons">{svg(ICONS["search"])}{svg(ICONS["sliders"])}{svg(ICONS["projectadd"])}</div>
  <div class="folder">{svg(ICONS["folder"])}<span>{html.escape(s["default"])}</span></div>
  <div class="row active"><div class="title">{html.escape(s["active"])}</div><div class="time">{html.escape(s["time_active"])}</div></div>
  <div class="row arch1"><div class="title">{html.escape(s["archived"])}</div><div class="time">{html.escape(s["time_archived"])}</div></div>
  <div class="row arch2"><div class="title">{html.escape(s["hover"])}</div>
    <div class="actions"><span class="slot">{svg(ICONS["ellipsis"])}</span>
      <span class="slot">{svg(ICONS["archive"])}</span>
      <span class="{del_cls}">{svg(ICONS["trash"])}</span></div></div>
  <div class="{tip_cls}">{html.escape(tip_txt)}</div>
</div></body></html>"""


def render(name, htmltext):
    src = WORK / f"{name}.html"
    out = ASSETS / f"{name}.png"
    src.write_text(htmltext, encoding="utf-8")
    subprocess.run(
        [
            "chromium", "--headless", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=2", "--window-size=360,280",
            "--default-background-color=00000000",
            f"--screenshot={out}", f"file://{src}",
        ],
        check=True, stderr=subprocess.DEVNULL,
    )
    print("wrote", out)


def main():
    ASSETS.mkdir(exist_ok=True)
    render("row-delete.en", page("en", armed=False))
    render("row-confirm.en", page("en", armed=True))
    render("row-delete.zh", page("zh", armed=False))
    render("row-confirm.zh", page("zh", armed=True))


if __name__ == "__main__":
    sys.exit(main())
