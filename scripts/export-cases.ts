/**
 * Elements to run every export target over.
 *
 * Deliberately awkward. An export is a template with a locator dropped into it,
 * so what breaks one is a locator carrying the quote character the template
 * happens to use — and the only way that shows up is by trying it.
 */
import type { PickResult, SelectorCandidate } from '@/core/types';

const base = { rect: { x: 0, y: 0, width: 0, height: 0 }, url: 'https://example.com', pickedAt: 0 };

const c = (
  kind: SelectorCandidate['kind'],
  engine: SelectorCandidate['engine'],
  value: string,
  score: number,
): SelectorCandidate => ({ kind, engine, value, score, matches: 1, notes: [] });

export const CASES: Array<[string, PickResult]> = [
  ['plain_id', {
    ...base, tagName: 'button', text: 'Save', attributes: { id: 'save' }, hops: [],
    candidates: [c('id', 'css', '#save', 85)],
  }],
  ['single_quote_in_value', {
    ...base, tagName: 'button', text: "It's fine", attributes: { 'data-testid': "o'brien" }, hops: [],
    candidates: [c('testid', 'css', '[data-testid="o\'brien"]', 95)],
  }],
  ['double_quote_in_value', {
    ...base, tagName: 'input', text: '', attributes: { placeholder: 'say "hi"' }, hops: [],
    candidates: [c('attr', 'css', '[placeholder="say \\"hi\\""]', 60)],
  }],
  ['backslash_in_value', {
    ...base, tagName: 'div', text: 'C:\\path', attributes: { class: 'path\\name' }, hops: [],
    candidates: [c('class', 'css', 'div.path\\\\name', 40)],
  }],
  ['link_text_shared', {
    ...base, tagName: 'a', text: 'View profile', attributes: { href: '/users/3' }, hops: [],
    linkTextMatches: 3,
    candidates: [c('attr', 'css', 'a[href="/users/3"]', 62)],
  }],
  ['link_text_unique', {
    ...base, tagName: 'a', text: 'Terms of Service', attributes: { href: '/tos' }, hops: [],
    linkTextMatches: 1,
    candidates: [c('attr', 'css', 'a[href="/tos"]', 62)],
  }],
  ['thai_text', {
    ...base, tagName: 'a', text: 'ยืนยันการสั่งซื้อ', attributes: { href: '/confirm' }, hops: [],
    candidates: [c('attr', 'css', 'a[href="/confirm"]', 60)],
  }],
  ['closed_shadow', {
    ...base, tagName: 'button', text: 'Pay', attributes: { class: 'pay' },
    hops: [{ type: 'shadow', hostSelector: 'pay-widget', closed: true }],
    candidates: [c('class', 'css', 'button.pay', 45)],
  }],
  ['inside_iframe', {
    ...base, tagName: 'input', text: '', attributes: { name: 'card' },
    hops: [{ type: 'iframe', hostSelector: '#checkout', reliable: true }],
    candidates: [c('name', 'css', '[name="card"]', 70)],
  }],
  ['no_candidates', {
    ...base, tagName: 'span', text: '', attributes: {}, hops: [], candidates: [],
  }],
];
