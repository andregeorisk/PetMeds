const nodes = [
  { id: 'login', code: 'A1', title: 'Entrar', group: 'access', kind: 'auth', col: 3, row: 0, caption: 'e-mail + senha' },
  { id: 'register', code: 'A2', title: 'Criar conta', group: 'access', kind: 'auth', col: 4, row: 0, caption: 'nome + dados de acesso' },
  { id: 'forgot', code: 'A3', title: 'Recuperar senha', group: 'access', kind: 'form', col: 2, row: 0, caption: 'solicita código por e-mail' },
  { id: 'email', code: 'A4', title: 'E-mail recebido', group: 'access', kind: 'email', col: 1, row: 0, modal: true, caption: 'simulador do código temporário' },
  { id: 'reset', code: 'A5', title: 'Redefinir senha', group: 'access', kind: 'form', col: 0, row: 0, caption: 'código + nova senha' },
  { id: 'pets', code: 'B1', title: 'Meus pets', group: 'care', kind: 'list', col: 0, row: 1, caption: 'ativos / não ativos' },
  { id: 'meds', code: 'B2', title: 'Medicamentos', group: 'care', kind: 'list', col: 1, row: 1, caption: 'estoque + validade' },
  { id: 'dashboard', code: 'B3', title: 'Painel', group: 'care', kind: 'dashboard', col: 2, row: 1, caption: 'agenda + histórico' },
  { id: 'treatments', code: 'B4', title: 'Tratamentos', group: 'care', kind: 'list', col: 3, row: 1, caption: 'ativos / pausados / concluídos' },
  { id: 'settings', code: 'B5', title: 'Família e configurações', group: 'team', kind: 'settings', col: 4, row: 1, caption: 'membros + preferências' },
  { id: 'profile', code: 'B6', title: 'Perfil do usuário', group: 'team', kind: 'profile', col: 5, row: 1, caption: 'dados + notificações' },
  { id: 'pet-form', code: 'C1', title: 'Cadastrar / editar pet', group: 'care', kind: 'form', col: 0, row: 2, modal: true, caption: 'dados, foto e status' },
  { id: 'weight', code: 'C2', title: 'Histórico de peso', group: 'care', kind: 'chart', col: 1, row: 2, modal: true, caption: 'gráfico + novo registro' },
  { id: 'single-dose', code: 'C3', title: 'Registrar dose única', group: 'care', kind: 'form', col: 2, row: 2, modal: true, caption: 'pet + medicamento + hora' },
  { id: 'confirm-dose', code: 'C4', title: 'Confirmar administração', group: 'care', kind: 'form', col: 3, row: 2, modal: true, caption: 'horário + responsável' },
  { id: 'day-details', code: 'C5', title: 'Detalhes do dia', group: 'care', kind: 'list', col: 4, row: 2, modal: true, caption: 'doses da data selecionada' },
  { id: 'med-form', code: 'C6', title: 'Cadastrar medicamento', group: 'care', kind: 'form', col: 5, row: 2, modal: true, caption: 'estoque + datas' },
  { id: 'treatment-form', code: 'C7', title: 'Novo tratamento', group: 'care', kind: 'form', col: 6, row: 2, modal: true, caption: 'posologia + horários' },
  { id: 'dose-edit', code: 'D1', title: 'Editar registro de dose', group: 'care', kind: 'form', col: 3, row: 3, modal: true, caption: 'administrada / não dada / pendente' },
  { id: 'restock', code: 'D2', title: 'Registrar reposição', group: 'care', kind: 'form', col: 5, row: 3, modal: true, caption: 'quantidade + validade' },
  { id: 'alert', code: 'D3', title: 'Aviso / erro', group: 'team', kind: 'alert', col: 6, row: 3, modal: true, caption: 'confirmação ou falha' }
];

const links = [
  ['login', 'register', 'cadastrar', 'nav'],
  ['login', 'forgot', 'esqueci a senha', 'nav', 'top'],
  ['forgot', 'email', 'enviar código', 'action'],
  ['email', 'reset', 'abrir redefinição', 'nav'],
  ['login', 'dashboard', 'entrar', 'action'],
  ['register', 'dashboard', 'conta criada', 'action'],
  ['reset', 'dashboard', 'senha redefinida', 'action'],
  ['pets', 'meds', 'menu inferior', 'nav', 'both'],
  ['meds', 'dashboard', 'menu inferior', 'nav', 'both'],
  ['dashboard', 'treatments', 'menu inferior', 'nav', 'both'],
  ['treatments', 'settings', 'menu inferior', 'nav', 'both'],
  ['dashboard', 'profile', 'avatar', 'nav', 'top'],
  ['dashboard', 'single-dose', 'dose única', 'action'],
  ['dashboard', 'confirm-dose', 'confirmar dose', 'action'],
  ['dashboard', 'day-details', 'selecionar dia', 'action'],
  ['pets', 'pet-form', 'cadastrar / editar', 'action'],
  ['pets', 'weight', 'histórico de peso', 'action'],
  ['meds', 'med-form', 'cadastrar', 'action'],
  ['med-form', 'restock', 'adicionar estoque', 'action'],
  ['treatments', 'treatment-form', 'novo tratamento', 'action'],
  ['treatments', 'confirm-dose', 'registrar dose', 'action'],
  ['day-details', 'dose-edit', 'abrir registro', 'action'],
  ['settings', 'alert', 'ações da família', 'system'],
  ['profile', 'alert', 'salvar alterações', 'system']
].map(([from, to, label, type, route]) => ({ from, to, label, type, route }));

const board = document.getElementById('board');
const nodeLayer = document.getElementById('nodes');
const svg = document.getElementById('connections');
const viewport = document.getElementById('viewport');
const zoomOutput = document.getElementById('zoom-level');
const dimensions = { width: 212, height: 287, left: 44, top: 60, stepX: 255, stepY: 325 };
const positions = new Map();
let zoom = 1;
let panX = 0;
let panY = 0;
let activeFilter = 'all';
let selectedNode = null;
let drag = null;

function nodePosition(node) {
  return { x: dimensions.left + node.col * dimensions.stepX, y: dimensions.top + node.row * dimensions.stepY };
}

function wireframe(kind) {
  const top = '<div class="wf-top"><i class="wf-brand"></i><i class="wf-avatar"></i></div>';
  const copy = '<div class="wf-copy"></div><div class="wf-copy short"></div>';
  const fields = '<div class="wf-field"></div><div class="wf-field"></div><div class="wf-button full"></div>';
  const rows = count => Array.from({ length: count }, () => '<div class="wf-row"><i class="wf-avatar-small"></i><span class="wf-row-lines"><i></i><i></i></span><i class="wf-tag"></i></div>').join('');
  const schedule = '<div class="wf-calendar">' + '<i></i>'.repeat(14) + '</div><div class="wf-dose"><i class="wf-time"></i><i class="wf-dose-lines"></i><i class="wf-pill"></i></div><div class="wf-dose"><i class="wf-time"></i><i class="wf-dose-lines"></i><i class="wf-pill"></i></div>';
  if (kind === 'auth') return `${top}<div class="wf-title"></div>${copy}${fields}`;
  if (kind === 'form') return `${top}<div class="wf-title short"></div>${fields}<div class="wf-copy tiny"></div>`;
  if (kind === 'dashboard') return `${top}<div class="wf-title short"></div>${schedule}`;
  if (kind === 'list') return `${top}<div class="wf-title short"></div><div class="wf-row"><i class="wf-avatar-small"></i><span class="wf-row-lines"><i></i><i></i></span><i class="wf-tag"></i></div>${rows(3)}`;
  if (kind === 'settings') return `${top}<div class="wf-title short"></div>${rows(2)}<div class="wf-row"><i class="wf-checkbox"></i><span class="wf-row-lines"><i></i></span><i class="wf-check"></i></div><div class="wf-row"><i class="wf-checkbox"></i><span class="wf-row-lines"><i></i></span><i class="wf-check"></i></div>`;
  if (kind === 'profile') return `${top}<div class="wf-title short"></div><div class="wf-row"><i class="wf-avatar-small"></i><span class="wf-row-lines"><i></i><i></i></span></div>${fields}`;
  if (kind === 'chart') return `${top}<div class="wf-title short"></div><div class="wf-calendar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>${rows(2)}`;
  if (kind === 'alert') return `${top}<div class="wf-modal-head"><b></b><i></i></div><div class="wf-alert"></div>${copy}<div class="wf-button"></div>`;
  if (kind === 'email') return `${top}<div class="wf-modal-head"><b></b></div><div class="wf-email">${copy}<div class="wf-copy short"></div></div><div class="wf-button"></div>`;
  return `${top}${copy}`;
}

function createNodes() {
  nodes.forEach((node, index) => {
    const position = nodePosition(node);
    positions.set(node.id, { ...position, width: dimensions.width, height: dimensions.height });
    const card = document.createElement('article');
    card.className = `flow-node${node.modal ? ' modal-node' : ''}`;
    card.dataset.id = node.id;
    card.dataset.group = node.group;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    card.style.setProperty('--tilt', `${((index % 5) - 2) * 0.22}deg`);
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${node.title}, ${node.modal ? 'janela' : 'tela'}`);
    card.innerHTML = `<div class="node-heading"><span class="node-index">${node.code}</span><strong>${node.title}</strong><span class="node-type">${node.modal ? 'JANELA' : 'TELA'}</span></div><div class="device-shell"><div class="device-status"><span>9:41</span><i></i><b>● ▰</b></div><div class="wireframe">${wireframe(node.kind)}</div><div class="device-home"></div></div><span class="node-caption">${node.caption}</span>`;
    nodeLayer.append(card);
  });
}

function anchorFor(from, to, route) {
  const source = positions.get(from);
  const target = positions.get(to);
  const sourceNode = nodes.find(node => node.id === from);
  const targetNode = nodes.find(node => node.id === to);
  if (sourceNode.row === targetNode.row) {
    const rightward = target.x >= source.x;
    const x1 = rightward ? source.x + source.width : source.x;
    const y1 = source.y + source.height / 2;
    const x2 = rightward ? target.x : target.x + target.width;
    const y2 = target.y + target.height / 2;
    if (route === 'top') return { d: `M${x1} ${y1 - 15} C${x1} ${source.y - 20}, ${x2} ${target.y - 20}, ${x2} ${y2 - 15}`, lx: (x1 + x2) / 2, ly: Math.min(source.y, target.y) - 14 };
    const midX = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} C${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`, lx: midX, ly: y1 - 9 };
  }
  const x1 = source.x + source.width / 2;
  const y1 = source.y + source.height;
  const x2 = target.x + target.width / 2;
  const y2 = target.y;
  const gap = Math.max(25, (y2 - y1) / 2);
  return { d: `M${x1} ${y1} C${x1} ${y1 + gap}, ${x2} ${y2 - gap}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 3 };
}

function createConnections() {
  svg.setAttribute('viewBox', '0 0 1800 1400');
  svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L7 4L1 7" fill="none" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';
  links.forEach((link, index) => {
    const path = anchorFor(link.from, link.to, link.route);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('connection-group');
    group.dataset.from = link.from;
    group.dataset.to = link.to;
    group.innerHTML = `<path class="flow-link ${link.type}" d="${path.d}" marker-end="url(#arrow)" ${link.route === 'both' ? 'marker-start="url(#arrow)"' : ''}/><text class="link-label" x="${path.lx}" y="${path.ly}">${link.label}</text>`;
    svg.append(group);
  });
}

function applyTransform() {
  board.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  zoomOutput.value = `${Math.round(zoom * 100)}%`;
  zoomOutput.textContent = `${Math.round(zoom * 100)}%`;
}

function fitBoard() {
  const availableWidth = viewport.clientWidth - 50;
  const availableHeight = viewport.clientHeight - 38;
  zoom = Math.min(availableWidth / 1800, availableHeight / 1400, 1.15);
  panX = (viewport.clientWidth - 1800 * zoom) / 2;
  panY = (viewport.clientHeight - 1400 * zoom) / 2;
  applyTransform();
}

function zoomAt(nextZoom, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) {
  const rect = viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const worldX = (localX - panX) / zoom;
  const worldY = (localY - panY) / zoom;
  zoom = Math.max(0.35, Math.min(1.6, nextZoom));
  panX = localX - worldX * zoom;
  panY = localY - worldY * zoom;
  applyTransform();
}

function selectNode(id) {
  selectedNode = selectedNode === id ? null : id;
  document.querySelectorAll('.flow-node').forEach(card => card.classList.toggle('selected', card.dataset.id === selectedNode));
  document.querySelectorAll('.connection-group').forEach(group => {
    const from = nodes.find(node => node.id === group.dataset.from);
    const to = nodes.find(node => node.id === group.dataset.to);
    const filterVisible = activeFilter === 'all' || (from.group === activeFilter && to.group === activeFilter);
    const active = selectedNode && (group.dataset.from === selectedNode || group.dataset.to === selectedNode);
    const dim = !filterVisible || Boolean(selectedNode && !active);
    group.querySelector('.flow-link').classList.toggle('is-dim', dim);
    group.querySelector('.flow-link').classList.toggle('is-highlight', Boolean(active));
    const label = group.querySelector('.link-label');
    label.classList.toggle('is-highlight', Boolean(active));
    label.style.opacity = dim ? '0.08' : '1';
  });
}

function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-button').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  document.querySelectorAll('.flow-node').forEach(card => card.classList.toggle('is-dim', filter !== 'all' && card.dataset.group !== filter));
  document.querySelectorAll('.connection-group').forEach(group => {
    const from = nodes.find(node => node.id === group.dataset.from);
    const to = nodes.find(node => node.id === group.dataset.to);
    const visible = filter === 'all' || (from.group === filter && to.group === filter);
    group.querySelector('.flow-link').classList.toggle('is-dim', !visible);
    group.querySelector('.link-label').classList.toggle('is-dim', !visible);
  });
  selectNode(null);
}

createNodes();
createConnections();
fitBoard();

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (filter) applyFilter(filter.dataset.filter);

  const tool = event.target.closest('[data-tool]')?.dataset.tool;
  if (tool === 'zoom-in') zoomAt(zoom * 1.15);
  if (tool === 'zoom-out') zoomAt(zoom / 1.15);
  if (tool === 'fit' || tool === 'reset') fitBoard();
  if (tool === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  const card = event.target.closest('.flow-node');
  if (card && !drag?.moved) selectNode(card.dataset.id);
});

document.addEventListener('keydown', event => {
  const card = event.target.closest('.flow-node');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    selectNode(card.dataset.id);
  }
  if (event.key === 'Escape') selectNode(null);
});

viewport.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoomAt(zoom * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener('pointerdown', event => {
  if (event.target.closest('.flow-node')) return;
  drag = { x: event.clientX, y: event.clientY, panX, panY, moved: false };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', event => {
  if (!drag) return;
  const deltaX = event.clientX - drag.x;
  const deltaY = event.clientY - drag.y;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
  panX = drag.panX + deltaX;
  panY = drag.panY + deltaY;
  applyTransform();
});
viewport.addEventListener('pointerup', () => {
  if (!drag) return;
  viewport.classList.remove('dragging');
  const moved = drag.moved;
  drag = null;
  if (moved) requestAnimationFrame(() => { drag = null; });
});
window.addEventListener('resize', fitBoard);

const hint = document.getElementById('hint');
hint.classList.add('visible');
setTimeout(() => hint.classList.remove('visible'), 4200);