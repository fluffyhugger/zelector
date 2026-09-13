import { toCode } from '@/core/export';
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
  ['thai_text_only', { ...base, tagName: 'span', text: 'ราคารวมทั้งหมด', attributes: {}, candidates: [{ kind:'path', engine:'css', value:'span', score:10, matches:1, notes:[] }] }],
];

mkdirSync('rf', { recursive: true });
for (const [name, pick] of cases) {
  writeFileSync(`rf/${name}.robot`, toCode(pick, 'robot') + '\n');
}
console.log(`wrote ${cases.length} .robot files`);
