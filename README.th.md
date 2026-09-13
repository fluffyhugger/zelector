# Zelector

[English](README.md) · **ภาษาไทย**

> ตัว inspector ที่ DevTools ควรจะเป็นตั้งแต่แรก

คลิกเลือก element ไหนก็ได้บนหน้าเว็บ — รวมถึงที่อยู่ใน **closed shadow root** —
แล้วรับ selector ทุกแบบที่เป็นไปได้ พร้อมคะแนนว่าแต่ละอันจะทนไปถึง deploy หน้าไหม
จากนั้น export เป็น Robot Framework, Playwright, Selenium, Puppeteer, Cypress หรือ CSS ดิบ

## ทำไมต้องมี

**Chrome Inspector มันกาก** สำหรับงานนี้ และคนที่เขียน automation รู้กันอยู่แล้ว

คลิกขวา → **Copy selector** มันโยน `div > div:nth-child(3) > button` ใส่มือแล้วเดินจากไป
selector แบบนี้ตายทันทีที่มีคนเอา flex container ไปครอบปุ่มเพิ่มอีกชั้น
DevTools ไม่รู้เลยว่า selector ไหนทน selector ไหนเปราะ — มันแค่คำนวณอันแรกที่ทำได้แล้วยัดให้
ปล่อยให้ test suite ไปพังเอาเองใน CI อีกสองอาทิตย์ถัดมา

และนั่นคือกรณีที่ยัง**เข้าถึง element ได้** ส่วนกรณีที่ DevTools ยอมแพ้:

| | Chrome DevTools | Zelector |
|---|---|---|
| เมนู hover, tooltip, popover | ปิดทันทีที่เอาเมาส์ไปที่ DevTools — โชคดีนะ | **Freeze DOM** ค้างไว้ให้ส่อง |
| `#shadow-root (closed)` | ตันสนิท มองไม่เห็นอะไรเลย | เดินเข้าไปได้ ผ่าน hook `attachShadow` ที่ติดตั้งตอน `document_start` |
| ความทนของ selector | ไม่มีความเห็นใด ๆ ทั้งสิ้น | คะแนน 0–100 พร้อมเหตุผลว่าโดนหักเพราะอะไร |
| class ที่ build tool สร้าง (`css-1x9d8f`, `Button_root__3kD9a`, `_ngcontent-…`) | ยื่นให้เหมือนมันจะอยู่ถาวร | จับได้ว่าเป็นของที่ generate มา แล้วหักคะแนน |
| virtualized list | แถวหลุด unmount ตอน scroll element หายกลางคัน | (v0.2) snapshot เก็บแถวไว้ |
| JSON field → element ที่แสดงค่านั้น | เปิดสองแท็บแล้วเพ่งเอาเอง | (v0.3) คลิกเดียว |

ทั้งหมดนี้ไม่ใช่เคสประหลาด มันคือวันอังคารธรรมดาของคนที่เขียนเทส Playwright หรือ
Robot Framework — แล้วเครื่องมือที่ติดมากับเบราว์เซอร์ก็ไม่ได้ช่วยอะไร

## ติดตั้ง (โหมด development)

```bash
npm install
npm run dev        # build ใหม่อัตโนมัติทุกครั้งที่แก้โค้ด
```

จากนั้น: `chrome://extensions` → เปิด **Developer mode** → **Load unpacked** →
เลือกโฟลเดอร์ `dist/`

> ⚠️ ต้องเลือก `dist/` ไม่ใช่โฟลเดอร์แม่ — เพราะ `manifest.json` ที่ใช้งานจริงอยู่ใน `dist/`

## วิธีใช้

| macOS | Windows / Linux | ทำอะไร |
|---|---|---|
| `⌥` `Z` | `Alt` `Z` | เปิด/ปิด element picker |
| `⌥` `⇧` `F` | `Alt` `Shift` `F` | freeze DOM — เมนู hover ไม่ปิดตอนกำลังส่อง |
| `↑` `↓` | `↑` `↓` | เลื่อนเลือก parent / child โดยไม่ต้องขยับเมาส์ |
| `Esc` | `Esc` | ยกเลิก |

บน macOS `⌥` คือปุ่ม **Option** — shortcut จับที่ `event.code` ไม่ใช่ `event.key`
เลยใช้ได้ทุก keyboard layout รวมถึงภาษาไทย (ถ้าจับ `event.key` กด Option+Z บน Mac
จะได้ `Ω` ไม่ใช่ `z`)

ถ้ากดแล้วไม่มีอะไรเกิดขึ้น แปลว่ามี extension อื่นจองปุ่มนั้นไว้ — เข้าไปเปลี่ยนที่
`chrome://extensions/shortcuts` หรือคลิกไอคอนบน toolbar แทนก็ได้

นอกจากนี้จะมีแท็บ **Zelector** โผล่ใน DevTools แสดงประวัติ element ที่เลือกไป

## Export ได้อะไรบ้าง

Robot Framework / SeleniumLibrary, Playwright (TS + Python), Selenium (Python + Java),
Puppeteer, Cypress, CSS ดิบ, XPath, JSON

### หมายเหตุเรื่อง Robot Framework

output ของ SeleniumLibrary เขียนจาก **libdoc 6.9.0** ตัวจริง ไม่ได้เขียนจากความจำ:

- locator ใช้รูปแบบ `strategy:value` ตามที่ doc แนะนำ ไม่ใช่ `strategy=value`
  เพราะแบบหลังชนกับ named-argument syntax ของ Robot เอง
- `data-testid="x"` กลายเป็น `data:testid:x` — strategy `data` ตัด `data-` ออกให้เอง
- keyword เลือกตามชนิด element: `Click Button` / `Click Link` / `Input Password` /
  `Select From List By Label` / `Select Checkbox` / `Choose File`
  เรื่องนี้สำคัญ เพราะ `Click Button` match `value` ด้วย `Click Link` match `href`
  กับ link text ส่วน `Click Element` รู้จักแค่ `id` กับ `name`
- `Select Radio Button` แยกเคสพิเศษ — signature จริงคือ `(group_name, value)`
  **ไม่ใช่** locator เลย render เป็นชื่อ group กับ value ของปุ่มแทน
- **SeleniumLibrary เจาะ shadow DOM ไม่ได้เลย** (grep ทั้ง libdoc — คำว่า "shadow"
  เจอ 0 ครั้ง) element ที่อยู่หลัง shadow boundary เลย export เป็น `dom:` expression
  พร้อมคอมเมนต์เตือน แทนที่จะเป็น `css:` locator ที่หาไม่เจอแบบเงียบ ๆ

snippet ทุกอันที่ generate ออกมาถูก parse ด้วย Robot Framework parser ตัวจริง —
ดูที่ `npm run test:robot`

## โครงสร้าง

MV3 ห้ามใช้ `chrome.*` ใน MAIN world และซ่อน closed shadow root จาก isolated world
งานเลยต้องแยกกัน:

```
main-world.js   MAIN, document_start
                ├─ hooks.ts    patch attachShadow / fetch / XHR ก่อน script ของเพจรัน
                ├─ picker.ts   overlay, deep elementFromPoint, freeze
                └─ hud.ts      การ์ดผลลัพธ์ (closed shadow root ของตัวเอง)
                      │ window.postMessage
content.js      ISOLATED — ตัวส่งสารล้วน ๆ ไม่มี DOM logic
                      │ chrome.runtime
background.js   คีย์ลัด, badge, ประวัติการเลือก
panel.js        DevTools panel
```

DOM logic ทั้งหมดอยู่ใน MAIN world เพราะเป็นที่เดียวที่เข้าถึง closed shadow root ได้
ส่วน isolated script มีไว้เพื่อเรียก `chrome.runtime` อย่างเดียว

### ทำไมไม่ใช้ innerHTML เลยสักที่

หน้าเว็บที่ส่ง header `require-trusted-types-for 'script'` — Chrome New Tab,
Google แทบทุกบริการ, GitHub, แอปธนาคารหลายเจ้า — จะ reject ทุก sink ที่รับ HTML string
ผลที่วัดได้จริงบนหน้าที่ส่ง header นั้น:

```
innerHTML                     TypeError: requires 'TrustedHTML'
insertAdjacentHTML            TypeError: requires 'TrustedHTML'
DOMParser.parseFromString     TypeError: requires 'TrustedHTML'
createElement + textContent   ok
<style>.textContent           ok, stylesheet ทำงาน
adoptedStyleSheets            ok, stylesheet ทำงาน
```

Zelector เลยสร้างทุก node ด้วยมือ (`src/main-world/dom-build.ts`) ผลพลอยได้คือ
ไม่ต้อง escape HTML อีกต่อไป เพราะ `textContent` จัดการให้เอง

## การให้คะแนน

`src/core/volatility.ts` ตัดสินว่า identifier ตัวไหนทน แบ่งเป็น 3 กลุ่ม:

- **volatile** — build tool สร้างจาก hash (`css-*`, `sc-*`, CSS-modules,
  Angular encapsulation, React `useId`, UUID, string ที่ entropy สูง) หักหนัก
- **utility** — ทนแต่ไม่บอกอะไรเลยว่าเป็น element ไหน (Tailwind, class จัด layout)
  ข้ามไปตอนสร้าง class selector
- **stable** — ที่เหลือ

`src/core/selector.ts` แล้วค่อยไล่สร้าง candidate ตามลำดับความชอบ:
test attribute → `id` → `getByRole` → `getByLabel` / `name=` → `aria-label` →
ข้อความ → attribute เชิงความหมายอื่น → ชุด class → path เชิงโครงสร้าง

## Roadmap

- [x] **v0.1** picker, closed shadow DOM, freeze, scoring, code export
- [ ] **v0.2** เดินข้าม iframe (same-origin), จับ pattern แถวใน virtualized list, snapshot DOM จริง
- [ ] **v0.3** คลิก JSON field ใน response ที่ดักไว้ → ได้ JSONPath; จับคู่ข้อความใน DOM ↔ field ใน API อัตโนมัติ
- [ ] **v0.4** Page Map export (สร้าง Page Object Model + TypeScript type จาก response จริง)
- [ ] **v0.5** template สำหรับ export ที่ผู้ใช้แก้เองได้

---

สร้างโดย **Sirapob Wuth** — [GitHub](https://github.com/fluffyhugger) ·
[LinkedIn](https://www.linkedin.com/in/sirapob/) · [MIT](LICENSE)
