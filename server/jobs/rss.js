import { decodeEntities } from '../lib/util.js';

function tagValue(block, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(regex);
  if (!match) return '';
  return decodeEntities(match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim());
}

export function parseRssItems(xml) {
  const items = [];
  const regex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = regex.exec(String(xml || ''))) !== null) {
    const block = match[1];
    items.push({
      title: tagValue(block, 'title'),
      link: tagValue(block, 'link'),
      description: tagValue(block, 'description'),
      pubDate: tagValue(block, 'pubDate'),
      region: tagValue(block, 'region'),
      country: tagValue(block, 'country'),
      state: tagValue(block, 'state'),
      category: tagValue(block, 'category'),
      type: tagValue(block, 'type'),
      skills: tagValue(block, 'skills')
    });
  }
  return items;
}
