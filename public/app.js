const $ = selector => document.querySelector(selector);
const dialog = $('#join-dialog');
const privacy = $('#privacy-dialog');
const form = $('#join-form');
let currentMember = null;
let submitting = false;
let toastTimer;
const markets = {
  usd: { symbol: 'DXY', value: '104.28', change: '+0.42%', points: [120,116,122,108,111,90,103,96,107,87,88,64,77,58,68,43,60,45,50,30,36,19,27,15], insight: 'Une inflation plus persistante peut repousser les baisses de taux et soutenir le dollar. Le prochain point à observer : le discours de la Fed.', chain: ['Inflation', 'Taux', 'Dollar'] },
  gold: { symbol: 'XAU', value: '2 345.60', change: '+0.76%', points: [125,109,117,112,90,96,104,82,70,83,67,80,52,61,48,59,47,34,49,38,26,32,19,22], insight: 'Une baisse des taux réels peut renforcer l’attrait de l’or. La demande de valeur refuge peut aussi peser dans la balance : deux forces à lire ensemble.', chain: ['Taux réels', 'Demande refuge', 'Or'] },
  index: { symbol: 'SPX', value: '5 218.40', change: '−0.31%', points: [30,26,39,35,54,44,40,63,56,69,60,77,71,88,82,74,97,89,101,85,108,99,116,106], insight: 'Des taux durablement élevés peuvent peser sur les valorisations. Les perspectives de bénéfices et la croissance restent essentielles pour nuancer ce scénario.', chain: ['Taux', 'Valorisations', 'Indices'] }
};
function showMarket(key) {
  const market = markets[key];
  document.querySelectorAll('[data-market]').forEach(button => { const selected = button.dataset.market === key; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  $('#market-panel').setAttribute('aria-labelledby', `tab-${key}`);
  $('#chart-symbol').textContent = market.symbol; $('#chart-value').textContent = market.value; $('#chart-change').textContent = market.change; $('#insight').textContent = market.insight;
  const points = market.points.map((y, i) => `${i * 20},${y}`);
  $('#line').setAttribute('d', `M${points.join(' L')}`); $('#area').setAttribute('d', `M${points.join(' L')} L460,165 L0,165Z`); $('#chart-dot').setAttribute('cx', '460'); $('#chart-dot').setAttribute('cy', market.points.at(-1));
  // The chart is intentionally normalized: avoid labeling every asset with the dollar index scale.
  document.querySelectorAll('.chart-axis').forEach(el => el.textContent = '');
  $('#signal-chain').replaceChildren(...market.chain.flatMap((label, i) => { const span = document.createElement('span'); span.textContent = label; if (!i) return [span]; const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true'); return [arrow, span]; }));
}
document.querySelectorAll('[data-market]').forEach((button, index, buttons) => {
  button.addEventListener('click', () => showMarket(button.dataset.market));
  button.addEventListener('keydown', event => { const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1; if (next >= 0) { event.preventDefault(); showMarket(buttons[next].dataset.market); buttons[next].focus(); } });
});
showMarket('usd');

const portraits = {
  Forex: { archetype: 'LE STRATÈGE DES ÉQUILIBRES', title: 'Entre deux devises, une vision du monde.', body: 'Vous regardez les devises comme le reflet de forces qui se répondent : décisions des banques centrales, inflation et mouvements de capitaux. Votre terrain, ce sont les écarts entre deux économies et les histoires qui les expliquent.', quote: 'Chaque devise raconte une économie. Chaque paire raconte une relation.' },
  Indices: { archetype: 'LE LECTEUR DES CYCLES', title: 'Derrière un indice, tout un cycle.', body: 'Vous cherchez la vue d’ensemble. Croissance, conditions financières, bénéfices : derrière le mouvement collectif des entreprises, vous voulez comprendre la phase du cycle et les forces qui la traversent.', quote: 'Voir le mouvement est un début. Comprendre ce qui le porte est une démarche.' },
  'Or & matières premières': { archetype: 'L’OBSERVATEUR DES FORCES RÉELLES', title: 'Une lecture ancrée dans le réel.', body: 'Votre regard se porte sur les ressources, la demande et les équilibres du monde. Entre taux réels, tensions géopolitiques et contraintes d’offre, vous cherchez ce qui donne du sens aux mouvements de l’or et des matières premières.', quote: 'Avant de devenir un prix, une matière première répond à un besoin.' },
  Crypto: { archetype: 'L’EXPLORATEUR DES NOUVEAUX FLUX', title: 'Un nouveau marché. Des forces profondes.', body: 'Vous explorez un marché en transformation, sans perdre de vue les forces qui le relient au reste du monde. Liquidité, appétit pour le risque et adoption : votre perspective relie les nouveaux récits aux grands mouvements de capitaux.', quote: 'Explorer de nouveaux marchés commence aussi par comprendre les anciens équilibres.' }
};
const horizons = { Intraday: 'À l’échelle de la séance, votre défi est de distinguer l’événement qui compte du bruit qui l’entoure.', Swing: 'Sur plusieurs séances, vous laissez à votre thèse le temps de se construire, puis vous observez ce qui la confirme ou la remet en cause.', 'Long terme': 'Votre horizon laisse de la place aux transformations profondes. Vous cherchez les tendances qui survivent à l’agitation du quotidien.', 'En exploration': 'Votre première force est la curiosité. Chaque lien compris entre l’économie et les marchés enrichit votre propre méthode.' };
function setStep(step) {
  $('#identity-fields').hidden = step !== 1; $('#identity-fields').disabled = step !== 1;
  $('#perspective-fields').hidden = step !== 2; $('#perspective-fields').disabled = step !== 2;
  $('#step-one').classList.toggle('active', step === 1); $('#step-two').classList.toggle('active', step === 2);
  $('#join-title').replaceChildren();
  const em = document.createElement('em'); em.textContent = step === 1 ? 'commence par un nom.' : 'Votre regard.';
  $('#join-title').append(document.createTextNode(step === 1 ? 'Chaque perspective' : 'Les mêmes marchés.'), document.createElement('br'), em);
  $('#join-intro').textContent = step === 1 ? 'Faites le premier pas. Votre signature vient ensuite.' : 'Quelques choix pour composer votre portrait.';
  $('#form-error').hidden = true;
}
function showView(view) { ['enrollment', 'member-view', 'received-view'].forEach(id => $(`#${id}`).hidden = id !== view); dialog.setAttribute('aria-labelledby', view === 'member-view' ? 'member-title' : view === 'enrollment' ? 'join-title' : 'received-title'); }
function renderMember(member) {
  currentMember = member;
  const portrait = portraits[member.market];
  $('#member-name').textContent = member.name; $('#member-monogram').textContent = member.name[0].toUpperCase(); $('#member-archetype').textContent = portrait.archetype;
  $('#member-number').textContent = `MEMBRE N° ${String(member.id).padStart(5, '0')}`; $('#member-market').textContent = `${member.market.toUpperCase()} / ${member.style.toUpperCase()}`;
  $('#story-title').textContent = portrait.title; $('#story-text').textContent = `${member.name}, ${portrait.body[0].toLowerCase()}${portrait.body.slice(1)} ${horizons[member.style]}`; $('#story-quote').textContent = `« ${portrait.quote} »`;
  $('#story-label').textContent = `LE PORTRAIT DE ${member.name.toUpperCase()}`;
  $('#delete-confirm').hidden = true; $('#member-error').hidden = true;
  const header = $('.header-cta'); header.replaceChildren(document.createTextNode('Mon accès ')); const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); header.append(arrow);
  showView('member-view');
}
function openJoin() { if (currentMember) renderMember(currentMember); else { setStep(1); showView('enrollment'); } dialog.showModal(); if (currentMember) $('#member-title').focus(); else $('#name').focus(); }
document.querySelectorAll('[data-join]').forEach(button => button.addEventListener('click', openJoin));
document.querySelectorAll('dialog').forEach(modal => { modal.querySelector('.dialog-close').addEventListener('click', () => modal.close()); modal.addEventListener('click', event => { if (event.target !== modal) return; const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); }); });
$('#privacy-open').addEventListener('click', () => privacy.showModal()); $('#form-privacy').addEventListener('click', () => privacy.showModal());
$('#next-step').addEventListener('click', () => { if (!$('#name').reportValidity() || !$('#email').reportValidity()) return; setStep(2); $('input[name=market]').focus(); });
$('#back-step').addEventListener('click', () => { setStep(1); $('#name').focus(); });
$('.close-received').addEventListener('click', () => dialog.close());
$('#received-view h2').id = 'received-title';
form.addEventListener('submit', async event => {
  event.preventDefault(); if (submitting) return;
  if (!$('#identity-fields').hidden) { $('#next-step').click(); return; }
  if (!form.reportValidity()) return;
  const data = { name: $('#name').value, email: $('#email').value, market: $('input[name=market]:checked')?.value, style: $('#style').value, consent: $('input[name=consent]').checked, website: $('#website').value };
  const submit = $('#submit-join'); submitting = true; submit.disabled = true; submit.textContent = 'Création de votre signature…'; $('#form-error').hidden = true;
  try {
    const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Impossible de vous inscrire pour le moment.');
    if (result.member) { renderMember(result.member); $('#member-title').focus(); }
    else { showView('received-view'); $('#received-title').tabIndex = -1; $('#received-title').focus(); }
  } catch (error) { $('#form-error').textContent = error instanceof TypeError ? 'La connexion a été interrompue. Vérifiez votre réseau et réessayez.' : error.message; $('#form-error').hidden = false; }
  finally { submitting = false; submit.disabled = false; submit.textContent = 'Créer ma signature ↗'; }
});
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
$('#delete-request').addEventListener('click', () => { $('#delete-confirm').hidden = false; $('#delete-cancel').focus(); });
$('#delete-cancel').addEventListener('click', () => { $('#delete-confirm').hidden = true; $('#delete-request').focus(); });
$('#delete-member').addEventListener('click', async () => {
  const button = $('#delete-member'); button.disabled = true;
  try { const response = await fetch('/api/member', { method: 'DELETE' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); currentMember = null; form.reset(); $('.header-cta').textContent = 'Demander mon accès ↗'; dialog.close(); toast('Votre inscription et vos données ont été supprimées.'); }
  catch (error) { $('#member-error').textContent = error.message || 'Impossible de retirer votre inscription.'; $('#member-error').hidden = false; }
  finally { button.disabled = false; }
});
fetch('/api/member').then(response => response.ok ? response.json() : null).then(result => { if (result?.member) renderMember(result.member); }).catch(() => {});
