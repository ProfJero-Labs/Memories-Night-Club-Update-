const GHS = p => `GHS ${(p / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const h = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const params = new URLSearchParams(location.search);
const st = params.get('s');
if (st) document.getElementById('mnOrder').href = `counter.html?s=${encodeURIComponent(st)}`;
document.getElementById('mnCta').hidden = !st && false;

const CAT_ORDER = ['Bottle service', 'Cocktails', 'Shots', 'Ready to drink', 'Water & soft drinks'];
const catIndex = c => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };

let allData = [];

async function load() {
  try {
    const r = await fetch('/api/menu');
    if (!r.ok) throw new Error('Menu unavailable right now.');
    const { categories } = await r.json();
    allData = categories.sort((a, b) => catIndex(a.category) - catIndex(b.category) || a.category.localeCompare(b.category));
    render(allData, '');
    document.getElementById('mnCta').hidden = false;
  } catch (e) {
    document.getElementById('mnList').innerHTML = `<p style="color:var(--muted);padding:32px 0;text-align:center">${h(e.message)}</p>`;
  }
}

function render(cats, q) {
  const list = document.getElementById('mnList');
  const empty = document.getElementById('mnEmpty');
  const filtered = cats.map(c => ({ ...c, items: q ? c.items.filter(i => i.name.toLowerCase().includes(q)) : c.items })).filter(c => c.items.length > 0);
  if (!filtered.length && q) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  list.innerHTML = filtered.map((c, idx) => `
    <details class="mn-cat" data-cat="${h(c.category)}"${idx === 0 ? ' open' : ''}>
      <summary>
        <span class="cat-title">${h(c.category)}</span>
        <span class="cat-count">${c.items.length} ${c.items.length === 1 ? 'drink' : 'drinks'}</span>
        <span class="cat-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m2 5 5 5 5-5"/></svg>
        </span>
      </summary>
      <div class="mn-items">${c.items.map(i => `
        <div class="mn-item">
          <span class="name">${h(i.name)}</span>
          <span class="price">${GHS(i.pricePesewas)}<small>per ${h(i.unit || 'serving')}</small></span>
        </div>`).join('')}
      </div>
    </details>`).join('');
}

let debounce;
document.getElementById('mnQ').addEventListener('input', e => {
  clearTimeout(debounce);
  debounce = setTimeout(() => render(allData, e.target.value.toLowerCase().trim()), 160);
});

load();
