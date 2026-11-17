const base='http://localhost:3000/api/items';
const items = [
  {type:'note', title:'A quieter capture flow', content:`Most note apps optimize for storage. The better target is retrieval under calm.\n\nThree rules for Blinko:\n\n1. Capture should cost one thought, not a decision.\n2. A blink becomes a note only when it earns structure.\n3. Tags should feel like margin notes, not folders.\n\n#product #writing`},
  {type:'blink', content:'The best ideas arrive in the shower, not at the desk. Keep a waterproof notebook? #ideas #rituals'},
  {type:'note', title:'On tiny tools', content:`A tool should disappear when you use it. The measure is not how many features it has, but how little friction sits between a thought and its keeping.\n\nBlinko is deliberately small. That is the feature.\n\n#design #philosophy`},
  {type:'blink', content:'What if a note-taking app felt less like a database and more like a desk you actually want to sit at? Warm paper, good type, nothing shouting for attention. #product #design'},
  {type:'blink', content:'Read: The Creative Act — Rick Rubin. The bit about the artist as a filter, not a source. #reading #creativity'},
  {type:'note', title:'Weekly review, Nov 17', content:`What moved:\n- Shipped the capture loop\n- Simplified tag filtering\n\nWhat is still sticky:\n- Deciding what belongs in Notes vs Blinks\n- The archive flow needs a lighter touch\n\nNext: a single small bet — make promote-to-note feel like turning a page.\n\n#review #product`},
  {type:'blink', content:'Idea for the tag system: let tags collect quietly at the edges instead of demanding a taxonomy upfront. #product #tags'},
  {type:'blink', content:'Small ritual: end each day by writing one sentence about what actually mattered. No metrics, just memory. #rituals'},
];
const pin = [];
for (const item of items) {
  const res = await fetch(base, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(item)});
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (item.title === 'A quieter capture flow' || data.content.startsWith('Idea for the tag system')) pin.push(data.id);
  await new Promise(r=>setTimeout(r,80));
}
for (const id of pin) {
  const res = await fetch(base + '/' + id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({isPinned:true})});
  if (!res.ok) throw new Error(await res.text());
}
console.log('seeded', items.length, 'pinned', pin.length);
