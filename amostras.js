const screens = ['dashboard', 'pets', 'meds', 'treatments', 'family'];
const screenNames = { dashboard: 'Painel', pets: 'Meus pets', meds: 'Medicamentos', treatments: 'Tratamentos', family: 'Família e ajustes' };
let activeScreenIndex = 0;
let toastTimer;

function showScreen(index) {
  activeScreenIndex = (index + screens.length) % screens.length;
  const screenName = screens[activeScreenIndex];
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${screenName}`));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.screen === screenName));
  document.getElementById('current-section').textContent = screenNames[screenName];
  document.getElementById('screen-counter').textContent = `${String(activeScreenIndex + 1).padStart(2, '0')} / 05`;
  document.querySelector('[data-action="previous-screen"]').disabled = activeScreenIndex === 0;
  document.querySelector('[data-action="next-screen"]').disabled = activeScreenIndex === screens.length - 1;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function openDialog(title, description, fields = []) {
  const content = document.getElementById('dialog-content');
  content.className = 'dialog-content';
  content.innerHTML = `<h2>${title}</h2><p>${description}</p>${fields.map(field => `<label>${field.label}${field.type === 'select' ? `<select>${field.options.map(option => `<option>${option}</option>`).join('')}</select>` : `<input type="${field.type || 'text'}" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>`}</label>`).join('')}<button class="button primary" data-action="save-demo">Salvar na demonstração</button>`;
  document.getElementById('demo-dialog').showModal();
}

function setFilter(selector, activeButton, dataKey, value, itemSelector) {
  document.querySelectorAll(`${selector} .segment`).forEach(button => button.classList.toggle('active', button === activeButton));
  document.querySelectorAll(itemSelector).forEach(item => { item.hidden = item.dataset[dataKey] !== value; });
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-screen]');
  if (nav) showScreen(screens.indexOf(nav.dataset.screen));

  const goTo = event.target.closest('[data-goto]');
  if (goTo) showScreen(screens.indexOf(goTo.dataset.goto));

  const petFilter = event.target.closest('[data-pet-filter]');
  if (petFilter && petFilter.closest('.pet-filter')) {
    const inactive = petFilter.dataset.petFilter === 'inactive';
    document.querySelectorAll('.pet-filter .segment').forEach(button => button.classList.toggle('active', button === petFilter));
    document.querySelectorAll('.pet-profile').forEach(card => { card.hidden = card.classList.contains('inactive-pet') !== inactive; });
  }

  const medFilter = event.target.closest('[data-med-filter]');
  if (medFilter) setFilter('.med-filter', medFilter, 'medStatus', medFilter.dataset.medFilter, '.med-row');

  const treatmentFilter = event.target.closest('[data-treatment-filter]');
  if (treatmentFilter) setFilter('.treatment-filter', treatmentFilter, 'treatmentStatus', treatmentFilter.dataset.treatmentFilter, '.treatment-card');

  const history = event.target.closest('[data-history]');
  if (history) {
    document.querySelectorAll('[data-history]').forEach(button => button.classList.toggle('active', button === history));
    notify(`Histórico demonstrativo: agrupado por ${history.dataset.history}.`);
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'previous-screen') showScreen(activeScreenIndex - 1);
  if (action === 'next-screen') showScreen(activeScreenIndex + 1);
  if (action === 'close-dialog') document.getElementById('demo-dialog').close();
  if (action === 'confirm-dose') {
    const button = event.target.closest('[data-action="confirm-dose"]');
    button.textContent = 'Dose registrada';
    button.classList.remove('primary', 'confirm-dose');
    button.classList.add('outline');
    button.disabled = true;
    notify('Dose registrada nesta demonstração.');
  }
  if (action === 'open-dose') openDialog('Registrar dose única', 'Anote uma administração fora dos horários programados.', [{ label: 'Pet', type: 'select', options: ['Ícaro', 'Laranja'] }, { label: 'Medicamento', type: 'select', options: ['Dipirona', 'Antibiótico', 'Outro'] }, { label: 'Data e horário', type: 'datetime-local', required: true }]);
  if (action === 'open-pet') openDialog('Cadastrar pet', 'Crie um perfil para acompanhar os cuidados.', [{ label: 'Nome do pet', placeholder: 'Ex.: Bento', required: true }, { label: 'Espécie', type: 'select', options: ['Gato', 'Cão', 'Outro'] }, { label: 'Data de nascimento', type: 'date' }]);
  if (action === 'edit-pet') openDialog('Editar perfil do pet', 'Atualize os dados de Ícaro nesta prévia.', [{ label: 'Nome', placeholder: 'Ícaro' }, { label: 'Espécie', type: 'select', options: ['Gato', 'Cão', 'Outro'] }]);
  if (action === 'open-med') openDialog('Cadastrar medicamento', 'Inclua o estoque e a validade para acompanhar reposições.', [{ label: 'Nome', placeholder: 'Nome do medicamento', required: true }, { label: 'Quantidade', type: 'number', placeholder: 'Ex.: 20' }, { label: 'Validade', type: 'date' }]);
  if (action === 'restock') openDialog('Registrar reposição', 'Atualize a quantidade em estoque e a validade da nova embalagem.', [{ label: 'Quantidade adicionada', type: 'number', placeholder: 'Ex.: 10', required: true }, { label: 'Validade', type: 'date' }]);
  if (action === 'open-treatment') openDialog('Novo tratamento', 'Defina pet, medicamento, dose e frequência.', [{ label: 'Pet', type: 'select', options: ['Ícaro', 'Laranja'] }, { label: 'Medicamento', type: 'select', options: ['Dipirona', 'Antibiótico', 'Probiótico'] }, { label: 'Frequência', type: 'select', options: ['1 vez ao dia', 'A cada 8 horas', 'A cada 12 horas'] }]);
  if (action === 'pause-treatment' || action === 'resume-treatment') {
    const button = event.target.closest('[data-action]');
    const card = button.closest('.treatment-card');
    const pause = action === 'pause-treatment';
    card.dataset.treatmentStatus = pause ? 'paused' : 'active';
    card.querySelector('.treatment-status').textContent = pause ? 'Pausado' : 'Ativo';
    card.querySelector('.treatment-status').className = `treatment-status ${pause ? 'paused-status' : 'active-status'}`;
    button.dataset.action = pause ? 'resume-treatment' : 'pause-treatment';
    button.textContent = pause ? 'Retomar' : 'Pausar';
    notify(pause ? 'Tratamento pausado nesta demonstração.' : 'Tratamento retomado nesta demonstração.');
  }
  if (action === 'copy-code') {
    navigator.clipboard?.writeText('G6M2K9').then(() => notify('Código G6M2K9 copiado.')).catch(() => notify('Código do grupo: G6M2K9'));
    if (!navigator.clipboard) notify('Código do grupo: G6M2K9');
  }
  if (action === 'invite-member') openDialog('Convidar pessoa', 'Compartilhe o código do grupo ou envie um convite.', [{ label: 'E-mail', type: 'email', placeholder: 'pessoa@email.com', required: true }, { label: 'Permissão', type: 'select', options: ['Cuidador', 'Visualizador', 'Cuidador temporário'] }]);
  if (action === 'edit-profile') openDialog('Editar perfil', 'Ajuste os dados do seu perfil.', [{ label: 'Nome', placeholder: 'André Silva' }, { label: 'E-mail', type: 'email', placeholder: 'andre@email.com' }]);
  if (action === 'weight-history') openDialog('Histórico de peso · Ícaro', 'Acompanhe as medições ao longo do tempo.', [{ label: 'Novo peso (kg)', type: 'number', placeholder: '6,1' }, { label: 'Data do registro', type: 'date' }]);
  if (action === 'pet-record' || action === 'med-details' || action === 'treatment-history') notify('Histórico de exemplo disponível nesta prévia.');
  if (action === 'save-demo') {
    const form = event.target.closest('.dialog-content');
    if (form.querySelector('input:invalid')) { form.querySelector('input:invalid').focus(); return; }
    document.getElementById('demo-dialog').close();
    notify('Salvo apenas nesta demonstração.');
  }
  if (action === 'export-data') {
    const blob = new Blob([JSON.stringify({ pets: ['Ícaro', 'Laranja'], medications: ['Dipirona', 'Antibiótico'] }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'petmeds-amostra.json';
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Arquivo de exemplo exportado.');
  }
  if (action === 'show-all-doses') notify('Agenda semanal de demonstração.');
});

document.querySelectorAll('[data-pet]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-pet]').forEach(chip => chip.classList.toggle('selected', chip === button));
  const pet = button.dataset.pet;
  document.querySelectorAll('.dose-row').forEach(row => { row.hidden = pet !== 'Todos' && row.dataset.petName !== pet; });
}));

document.getElementById('dark-toggle').addEventListener('change', event => {
  document.body.classList.toggle('dark-preview', event.target.checked);
  notify(event.target.checked ? 'Prévia do tema escuro.' : 'Prévia do tema claro.');
});

document.querySelector('.search-field input[aria-label="Buscar pet"]').addEventListener('input', event => {
  const query = event.target.value.trim().toLocaleLowerCase('pt-BR');
  document.querySelectorAll('#screen-pets .pet-profile:not(.inactive-pet)').forEach(card => { card.hidden = !card.querySelector('h2').textContent.toLocaleLowerCase('pt-BR').includes(query); });
});

showScreen(0);