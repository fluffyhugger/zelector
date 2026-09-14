import { toCode } from '@/core/export';
import { robotActionsFor } from '@/core/robot';
import { toRobotSuite, type RecordedStep, type Recording } from '@/core/recording';
import type { PickResult } from '@/core/types';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = { rect: { x:0,y:0,width:0,height:0 }, url: '', pickedAt: 0, hops: [] as PickResult['hops'] };
const cases: Array<[string, PickResult]> = [
  ['testid_button', { ...base, tagName: 'button', text: 'ยืนยันการสั่งซื้อ', attributes: { 'data-testid': 'confirm-order', type: 'submit' }, candidates: [{ kind:'testid', engine:'css', value:'[data-testid="confirm-order"]', score:98, matches:1, notes:[] }] }],
  ['password', { ...base, tagName: 'input', text: '', attributes: { type:'password', name:'password', id:'login-pw' }, candidates: [{ kind:'id', engine:'css', value:'#login-pw', score:85, matches:1, notes:[] }] }],
  ['select', { ...base, tagName: 'select', text: '', attributes: { name:'country', id:'country-select' }, candidates: [{ kind:'id', engine:'css', value:'#country-select', score:85, matches:1, notes:[] }] }],
  ['link', { ...base, tagName: 'a', text: 'Terms of Service', attributes: { href:'/tos' }, candidates: [{ kind:'attr', engine:'css', value:'a[href="/tos"]', score:60, matches:1, notes:[] }] }],
  ['checkbox', { ...base, tagName: 'input', text: '', attributes: { type:'checkbox', 'data-cy':'accept-terms' }, candidates: [{ kind:'testid', engine:'css', value:'[data-cy="accept-terms"]', score:98, matches:1, notes:[] }] }],
  ['radio', { ...base, tagName: 'input', text: '', attributes: { type:'radio', name:'shipping_method', value:'express', id:'ship-express' }, candidates: [{ kind:'id', engine:'css', value:'#ship-express', score:85, matches:1, notes:[] }] }],
  ['file', { ...base, tagName: 'input', text: '', attributes: { type:'file', id:'avatar' }, candidates: [{ kind:'id', engine:'css', value:'#avatar', score:85, matches:1, notes:[] }] }],
  ['shadow_closed', { ...base, tagName: 'button', text: 'Pay now', attributes: { class:'pay-btn' }, hops: [{ type:'shadow', hostSelector:'checkout-widget', closed:true }], candidates: [{ kind:'class', engine:'css', value:'button.pay-btn', score:45, matches:1, notes:[] }] }],
  ['path_only', { ...base, tagName: 'div', text: 'Total', attributes: { class:'flex items-center text-sm' }, candidates: [{ kind:'path', engine:'css', value:'main > div:nth-of-type(3)', score:16, matches:1, notes:[] }] }],
  ['iframe_button', { ...base, tagName: 'button', text: 'Pay now', attributes: { id:'pay-now' }, hops: [{ type:'iframe', hostSelector:'#checkout-frame', reliable:true }], candidates: [{ kind:'id', engine:'css', value:'#pay-now', score:85, matches:1, notes:[] }] }],
  ['iframe_cross_origin', { ...base, tagName: 'input', text: '', attributes: { name:'card_number' }, hops: [{ type:'iframe', hostSelector:'iframe[src*="/pay"]', reliable:false }], candidates: [{ kind:'name', engine:'css', value:'[name="card_number"]', score:70, matches:1, notes:[] }] }],
  ['iframe_nested_shadow', { ...base, tagName: 'button', text: 'Confirm', attributes: { class:'confirm' }, hops: [{ type:'iframe', hostSelector:'#outer-frame', reliable:true }, { type:'shadow', hostSelector:'pay-widget', closed:true }], candidates: [{ kind:'class', engine:'css', value:'button.confirm', score:45, matches:1, notes:[] }] }],
  ['iframe_radio', { ...base, tagName: 'input', text: '', attributes: { type:'radio', name:'card_type', value:'visa', id:'visa' }, hops: [{ type:'iframe', hostSelector:'#checkout-frame', reliable:true }], candidates: [{ kind:'id', engine:'css', value:'#visa', score:85, matches:1, notes:[] }] }],
  ['thai_text_only', { ...base, tagName: 'span', text: 'ราคารวมทั้งหมด', attributes: {}, candidates: [{ kind:'path', engine:'css', value:'span', score:10, matches:1, notes:[] }] }],
];

mkdirSync('rf', { recursive: true });
// Every alternative keyword, not just the primary one — each renders its own
// argument columns and keyword name, so each is its own chance to emit
// something the parser rejects.
let written = 0;
for (const [name, pick] of cases) {
  for (const action of robotActionsFor(pick)) {
    const slug = action.keyword.toLowerCase().replace(/\s+/g, '_');
    writeFileSync(`rf/${name}__${slug}.robot`, toCode(pick, 'robot', action.keyword) + '\n');
    written += 1;
  }
}
console.log(`wrote ${written} .robot files`);

// ── A recorded flow ──────────────────────────────────────────────────────────
// The suite generator has to survive things a single-element export never sees:
// the same element twice, a locator-less radio keyword, values carrying Robot
// syntax, and a wait pointing at an element the step itself never touches.

const el = (
  tagName: string,
  attributes: Record<string, string>,
  text = '',
  value = '',
): PickResult => ({
  ...base,
  tagName,
  text,
  attributes,
  candidates: [{ kind: 'id', engine: 'css', value: value || `${tagName}`, score: 80, matches: 1, notes: [] }],
});

const spinner = el('div', { class: 'loading-spinner' }, '', '.loading-spinner');
const step = (s: Omit<RecordedStep, 'id' | 'at'>, i: number): RecordedStep => ({ ...s, id: `s${i}`, at: i });

const flow: Recording = {
  active: false,
  startedAt: Date.UTC(2026, 8, 14),
  startUrl: 'https://shop.example.com/login',
  // Both carry things a cell would otherwise eat: a run of spaces and a ${.
  name: '  Order Is Shipped   After Checkout  ',
  doc: 'Signs in, filters to shipped orders and checks the  total against ${EXPECTED}.',
  steps: [
    { kind: 'input', target: el('input', { id: 'username', type: 'text' }), value: 'somebody@example.com',
      wait: { kind: 'visible', target: el('input', { id: 'username', type: 'text' }), timeoutS: 10, reason: '' } },
    { kind: 'input', target: el('input', { id: 'password', type: 'password' }), value: 'hunter2  ${NOT_A_VAR}',
      wait: { kind: 'none', timeoutS: 10, reason: '' } },
    { kind: 'click', target: el('button', { id: 'sign-in', type: 'submit' }, 'Sign in'),
      wait: { kind: 'not-visible', target: spinner, timeoutS: 15, reason: '' } },
    { kind: 'click', target: el('a', { href: '/orders' }, 'My Orders'),
      wait: { kind: 'location', urlFragment: '/dashboard', timeoutS: 20, reason: '' } },
    { kind: 'select', target: el('select', { name: 'status' }), value: 'Shipped',
      wait: { kind: 'contains', target: el('table', { id: 'orders' }), timeoutS: 10, reason: '' } },
    { kind: 'check', target: el('input', { type: 'checkbox', 'data-testid': 'select-all' }),
      wait: { kind: 'sleep', seconds: 2, timeoutS: 10, reason: '' } },
    { kind: 'check', target: el('input', { type: 'radio', name: 'shipping', value: 'express', id: 'ship-x' }),
      wait: { kind: 'enabled', target: el('input', { type: 'radio', name: 'shipping', value: 'express', id: 'ship-x' }), timeoutS: 10, reason: '' } },
    // The same button again: one variable, one keyword, two calls.
    { kind: 'click', target: el('button', { id: 'sign-in', type: 'submit' }, 'Sign in'),
      wait: { kind: 'none', timeoutS: 10, reason: '' } },
    { kind: 'navigate', target: el('html', {}), value: 'https://shop.example.com/receipt',
      wait: { kind: 'none', timeoutS: 10, reason: '' } },
    { kind: 'assert', target: el('span', { 'data-testid': 'order-total' }, '฿1,240.00'),
      keyword: 'Element Text Should Be', value: '฿1,240.00',
      wait: { kind: 'visible', target: el('span', { 'data-testid': 'order-total' }), timeoutS: 10, reason: '' } },
  ].map(step),
};

writeFileSync('rf/_recorded_flow.robot', toRobotSuite(flow, { name: 'Order Is Shipped' }));

// A flow that reaches into a payment iframe: the step acts in the frame, and
// so does the spinner it waits on.
const framed = (attributes: Record<string, string>, tagName = 'button', value = ''): PickResult => ({
  ...el(tagName, attributes, '', value),
  hops: [{ type: 'iframe', hostSelector: '#checkout-frame', reliable: true }],
});

const iframeFlow: Recording = {
  active: false,
  startedAt: Date.UTC(2026, 8, 14),
  startUrl: 'https://shop.example.com/checkout',
  name: 'Pay With Card',
  steps: [
    { kind: 'input', target: framed({ name: 'card_number' }, 'input'), value: '4111111111111111',
      wait: { kind: 'visible', target: framed({ name: 'card_number' }, 'input'), timeoutS: 10, reason: '' } },
    // The spinner lives in the same frame as the button.
    { kind: 'click', target: framed({ id: 'pay-now' }),
      wait: { kind: 'not-visible', target: framed({ class: 'spinner' }, 'div', '.spinner'), timeoutS: 20, reason: '' } },
    // …and this one waits on something out in the top document.
    { kind: 'click', target: framed({ id: 'confirm' }),
      wait: { kind: 'visible', target: el('div', { id: 'receipt' }, '', '#receipt'), timeoutS: 15, reason: '' } },
  ].map(step),
};

writeFileSync('rf/_recorded_iframe.robot', toRobotSuite(iframeFlow));
console.log('wrote rf/_recorded_flow.robot, rf/_recorded_iframe.robot');
