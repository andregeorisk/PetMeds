const supabaseClient = window.supabaseClient;

let db = { users: [], families: [], pets: [], medications: [], treatments: [], doses: [] };
let currentUser = null;
let currentFamily = null;
let activePetId = null;
let currentWeekOffset = 0;
let pendingDelaySuggestion = null;
let activeDayDetailsDate = null;
let authMode = 'login';

function toLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeString(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${toLocalDateString(date)}T${hours}:${minutes}`;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.substring(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : dateString;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showAlertModal(title, message) {
  document.getElementById('alert-title').innerText = title;
  document.getElementById('alert-message').innerText = message;
  document.getElementById('alert-modal').style.display = 'flex';
}

function closeAlertModal() {
  document.getElementById('alert-modal').style.display = 'none';
}

function showError(error, title = 'Não foi possível concluir') {
  console.error(error);
  showAlertModal(title, error.message || 'Verifique sua conexão e tente novamente.');
}

async function request(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function getUserRole() {
  return currentFamily?.members?.find(member => member.userId === currentUser?.id)?.role || null;
}

function getFamilyPets() {
  return db.pets.filter(pet => pet.familyId === currentFamily?.id);
}

function getFamilyMeds() {
  return db.medications.filter(medication => medication.familyId === currentFamily?.id);
}

async function loadRemoteData() {
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    currentUser = null;
    currentFamily = null;
    db = { users: [], families: [], pets: [], medications: [], treatments: [], doses: [] };
    return;
  }

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError) throw userError;
  const authUser = userData.user;
  const profile = await request(supabaseClient.from('profiles').select('id, name, receive_email_notif').eq('id', authUser.id).single());
  currentUser = { id: authUser.id, name: profile.name, email: authUser.email, receiveEmailNotif: profile.receive_email_notif };

  const memberships = await request(supabaseClient.from('family_members').select('family_id, role, receive_email, families(id, name, code, admin_id)').eq('user_id', authUser.id));
  if (!memberships.length) {
    currentFamily = null;
    return;
  }

  const membership = memberships[0];
  const family = membership.families;
  const [members, profiles, pets, weights, medications, treatments, doses] = await Promise.all([
    request(supabaseClient.from('family_members').select('family_id, user_id, role, receive_email').eq('family_id', family.id)),
    request(supabaseClient.from('profiles').select('id, name')),
    request(supabaseClient.from('pets').select('*').eq('family_id', family.id).order('name')),
    request(supabaseClient.from('weight_records').select('*').order('recorded_at')),
    request(supabaseClient.from('medications').select('*').eq('family_id', family.id).order('name')),
    request(supabaseClient.from('treatments').select('*').eq('family_id', family.id)),
    request(supabaseClient.from('doses').select('*').eq('family_id', family.id).order('scheduled_at'))
  ]);

  const profileById = new Map(profiles.map(item => [item.id, item]));
  const petIds = new Set(pets.map(pet => pet.id));
  const weightsByPet = new Map();
  weights.filter(weight => petIds.has(weight.pet_id)).forEach(weight => {
    const list = weightsByPet.get(weight.pet_id) || [];
    list.push({ id: weight.id, weight: Number(weight.weight), date: weight.recorded_at });
    weightsByPet.set(weight.pet_id, list);
  });

  currentFamily = {
    id: family.id,
    name: family.name,
    code: family.code,
    adminId: family.admin_id,
    members: members.map(member => ({ userId: member.user_id, role: member.role, receiveEmail: member.receive_email }))
  };
  db.users = members.map(member => ({
    id: member.user_id,
    name: profileById.get(member.user_id)?.name || 'Membro',
    email: member.user_id === currentUser.id ? currentUser.email : '',
    receiveEmailNotif: member.user_id === currentUser.id ? currentUser.receiveEmailNotif : true
  }));
  db.families = [currentFamily];
  db.pets = pets.map(pet => ({ ...pet, status: pet.status || 'active', familyId: pet.family_id, birth: pet.birth_date, weightHistory: weightsByPet.get(pet.id) || [] }));
  db.medications = medications.map(med => ({ ...med, familyId: med.family_id, qty: Number(med.quantity), buyDate: med.bought_at, expDate: med.expires_at }));
  db.treatments = treatments.map(treatment => ({ ...treatment, familyId: treatment.family_id, petId: treatment.pet_id, medId: treatment.medication_id, intervalDays: treatment.interval_days, durationType: treatment.duration_type, endDate: treatment.end_date, createdAt: treatment.created_at, times: treatment.times.map(time => time.substring(0, 5)) }));
  db.doses = doses.map(dose => ({ ...dose, familyId: dose.family_id, treatmentId: dose.treatment_id, petId: dose.pet_id, medId: dose.medication_id, scheduledDateTime: `${toLocalDateTimeString(new Date(dose.scheduled_at))}:00`, actualDateTime: dose.actual_at, notified: dose.notified }));
}

async function refreshApp() {
  await loadRemoteData();
  if (!currentUser) {
    showAuthScreen();
    return;
  }
  if (!currentFamily) {
    showAlertModal('Grupo não encontrado', 'Sua conta não possui uma família. Faça login novamente ou contate o suporte.');
    return;
  }
  await generateScheduledDoses();
  await loadRemoteData();
  renderApp();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'block';
  document.getElementById('app-interface').style.display = 'none';
}

function switchAuthMode(mode) {
  authMode = mode;
  const tabs = document.querySelectorAll('.auth-tab');
  tabs[0].classList.toggle('active', mode === 'login');
  tabs[1].classList.toggle('active', mode === 'register');
  document.getElementById('group-name').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('group-confirm-password').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-btn-submit').innerText = mode === 'login' ? 'Entrar' : 'Cadastrar e Entrar';
}

function openForgotPasswordView() {
  document.getElementById('auth-main-view').style.display = 'none';
  document.getElementById('auth-forgot-view').style.display = 'block';
  document.getElementById('auth-reset-view').style.display = 'none';
}

function closeForgotPasswordView() {
  document.getElementById('auth-main-view').style.display = 'block';
  document.getElementById('auth-forgot-view').style.display = 'none';
  document.getElementById('auth-reset-view').style.display = 'none';
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const password = document.getElementById('auth-password').value;
  try {
    if (authMode === 'login') {
      await request(supabaseClient.auth.signInWithPassword({ email, password }));
      await refreshApp();
      return;
    }
    const name = document.getElementById('auth-name').value.trim();
    const confirmPassword = document.getElementById('auth-confirm-password').value;
    if (!name) throw new Error('Informe seu nome completo.');
    if (password !== confirmPassword) throw new Error('As senhas digitadas não coincidem.');
    const data = await request(supabaseClient.auth.signUp({ email, password, options: { data: { name } } }));
    if (!data.session) {
      showAlertModal('Confirme seu e-mail', 'Enviamos um link de confirmação para seu e-mail. Depois de confirmar, entre com sua senha.');
      return;
    }
    await refreshApp();
  } catch (error) {
    showError(error, 'Falha na autenticação');
  }
}

async function handleSendRecoveryCode(event) {
  event.preventDefault();
  const email = document.getElementById('recovery-email').value.trim().toLowerCase();
  try {
    await request(supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href }));
    showAlertModal('E-mail enviado', 'Enviamos um link seguro para redefinir sua senha. Abra o link recebido e retorne ao aplicativo.');
    closeForgotPasswordView();
  } catch (error) {
    showError(error, 'Não foi possível recuperar a senha');
  }
}

async function handleResetPasswordSubmit(event) {
  event.preventDefault();
  showAlertModal('Use o link recebido', 'A redefinição de senha é confirmada pelo link enviado pelo Supabase ao seu e-mail.');
}

async function logout() {
  try {
    await request(supabaseClient.auth.signOut());
  } catch (error) {
    showError(error, 'Não foi possível sair');
    return;
  }
  currentUser = null;
  currentFamily = null;
  showAuthScreen();
}

async function handleUpdateProfile(event) {
  event.preventDefault();
  const name = document.getElementById('profile-name').value.trim();
  const email = document.getElementById('profile-email').value.trim().toLowerCase();
  const password = document.getElementById('profile-pass').value;
  try {
    await request(supabaseClient.from('profiles').update({ name }).eq('id', currentUser.id));
    const authChanges = {};
    if (email !== currentUser.email) authChanges.email = email;
    if (password) authChanges.password = password;
    if (Object.keys(authChanges).length) await request(supabaseClient.auth.updateUser(authChanges));
    await refreshApp();
    document.getElementById('profile-pass').value = '';
    showAlertModal('Perfil atualizado', 'Seus dados foram atualizados. Alterações de e-mail podem exigir confirmação na caixa de entrada.');
  } catch (error) {
    showError(error, 'Não foi possível atualizar o perfil');
  }
}

async function handleDeleteAccount() {
  if (!confirm('Tem certeza que deseja excluir sua conta? Esta ação não pode ser desfeita.')) return;
  try {
    await request(supabaseClient.rpc('delete_my_account'));
    currentUser = null;
    currentFamily = null;
    showAuthScreen();
  } catch (error) {
    showError(error, 'Não foi possível excluir a conta');
  }
}

async function toggleUserEmailNotif(enabled) {
  try {
    await request(supabaseClient.from('profiles').update({ receive_email_notif: enabled }).eq('id', currentUser.id));
    currentUser.receiveEmailNotif = enabled;
  } catch (error) {
    showError(error, 'Não foi possível atualizar a preferência');
  }
}

function renderApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-interface').style.display = 'block';
  if (!activePetId && getFamilyPets().length) activePetId = getFamilyPets()[0].id;
  updateHeaderInfo();
  renderDashboard();
  renderPets();
  renderMeds();
  renderAdmin();
  renderConfig();
}

function updateHeaderInfo() {
  document.getElementById('header-user-name').innerText = currentUser.name;
  const labels = { admin: 'Admin', cuidador: 'Cuidador', visualizador: 'Visualizador' };
  document.getElementById('header-role-badge').innerText = labels[getUserRole()] || 'Membro';
}

function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.getElementById(`page-${pageId}`).classList.add('active');
  const map = { pets: 0, remedios: 1, dashboard: 2, admin: 3, config: 4 };
  document.querySelectorAll('.bottom-nav .nav-btn').forEach((button, index) => button.classList.toggle('active', index === map[pageId]));
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'pets') renderPets();
  if (pageId === 'remedios') renderMeds();
  if (pageId === 'admin') renderAdmin();
  if (pageId === 'config') renderConfig();
}

async function savePet(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar pets.');
  const id = document.getElementById('pet-id').value;
  const values = { name: document.getElementById('pet-name').value.trim(), species: document.getElementById('pet-species').value, birth_date: document.getElementById('pet-birth').value, status: document.getElementById('pet-status').value };
  try {
    if (id) await request(supabaseClient.from('pets').update(values).eq('id', id));
    else await request(supabaseClient.from('pets').insert({ ...values, family_id: currentFamily.id }));
    resetPetForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível salvar o pet'); }
}

function editPet(id) {
  const pet = db.pets.find(item => item.id === id);
  if (!pet) return;
  document.getElementById('pet-id').value = pet.id;
  document.getElementById('pet-name').value = pet.name;
  document.getElementById('pet-species').value = pet.species;
  document.getElementById('pet-birth').value = pet.birth;
  document.getElementById('pet-status').value = pet.status;
  document.getElementById('pet-status').disabled = pet.status === 'deceased';
  document.getElementById('pet-status-help').innerText = pet.status === 'deceased' ? 'Pets falecidos não podem ser reativados.' : 'Pets doados ou perdidos podem voltar para Ativo.';
  document.getElementById('pet-form-title').innerText = 'Editar Pet';
}

function resetPetForm() {
  document.getElementById('form-pet').reset();
  document.getElementById('pet-id').value = '';
  document.getElementById('pet-status').disabled = false;
  document.getElementById('pet-status-help').innerText = '';
  document.getElementById('pet-form-title').innerText = 'Cadastrar Novo Pet';
}

async function deletePet(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem excluir pets.');
  const pet = db.pets.find(item => item.id === id);
  if (!pet || !confirm(`Excluir ${pet.name} e todo o histórico de tratamentos, doses e pesos? Esta ação não pode ser desfeita.`)) return;
  try {
    await request(supabaseClient.rpc('delete_pet', { p_pet_id: id }));
    if (activePetId === id) activePetId = null;
    resetPetForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível excluir o pet'); }
}

function renderPets() {
  const list = document.getElementById('pets-list');
  const isViewer = getUserRole() === 'visualizador';
  const pets = getFamilyPets();
  if (!pets.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum pet cadastrado na família.</p></div>';
    return;
  }
  list.innerHTML = pets.map(pet => {
    const lastWeight = pet.weightHistory.at(-1);
    const icon = pet.species === 'Gato' ? '🐱' : pet.species === 'Cão' ? '🐶' : '🐾';
    const statusLabels = { active: 'Ativo', donated: 'Doado', lost: 'Perdido', deceased: 'Falecido' };
    const statusClasses = { active: 'badge-success', donated: 'badge-warning', lost: 'badge-warning', deceased: 'badge-danger' };
    const status = pet.status || 'active';
    return `<div class="card"><h3>${icon} ${escapeHtml(pet.name)} <span class="badge ${statusClasses[status] || 'badge'}">${statusLabels[status] || 'Ativo'}</span></h3><p style="font-size:0.85rem;color:var(--text-muted)">Espécie: ${escapeHtml(pet.species)} | Nasc.: ${formatDate(pet.birth)}</p><p style="font-size:0.85rem;margin-top:4px"><strong>Peso Atual:</strong> ${lastWeight ? `${lastWeight.weight} kg (${formatDate(lastWeight.date)})` : 'Não registrado'}</p><div class="btn-group"><button class="btn btn-secondary btn-sm" onclick="openWeightModal('${pet.id}')">Histórico de Peso</button>${!isViewer ? `<button class="btn btn-secondary btn-sm" onclick="editPet('${pet.id}')">Editar</button><button class="btn btn-danger btn-sm" onclick="deletePet('${pet.id}')">Excluir</button>` : ''}</div></div>`;
  }).join('');
}

function openWeightModal(petId) {
  document.getElementById('weight-pet-id').value = petId;
  document.getElementById('weight-date').value = toLocalDateString();
  document.getElementById('weight-val').value = '';
  renderWeightHistory(petId);
  document.getElementById('weight-modal').style.display = 'flex';
}

function closeWeightModal() { document.getElementById('weight-modal').style.display = 'none'; }

async function addWeightRecord(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar peso.');
  try {
    await request(supabaseClient.from('weight_records').insert({ pet_id: document.getElementById('weight-pet-id').value, weight: Number(document.getElementById('weight-val').value), recorded_at: document.getElementById('weight-date').value }));
    const petId = document.getElementById('weight-pet-id').value;
    await refreshApp();
    openWeightModal(petId);
  } catch (error) { showError(error, 'Não foi possível registrar o peso'); }
}

function renderWeightHistory(petId) {
  const pet = db.pets.find(item => item.id === petId);
  const container = document.getElementById('weight-history-list');
  if (!pet?.weightHistory.length) {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted)">Nenhum peso registrado.</p>';
    return;
  }
  container.innerHTML = '<h4>Registros:</h4>' + pet.weightHistory.map(weight => `<div class="list-item"><span>${formatDate(weight.date)}</span><strong>${weight.weight} kg</strong></div>`).join('');
}

async function saveMedication(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar medicamentos.');
  const id = document.getElementById('med-id').value;
  const values = { name: document.getElementById('med-name').value.trim(), lab: document.getElementById('med-lab').value.trim(), quantity: Number(document.getElementById('med-qty').value), unit: document.getElementById('med-unit').value, bought_at: document.getElementById('med-buy-date').value, expires_at: document.getElementById('med-exp-date').value };
  try {
    if (id) await request(supabaseClient.from('medications').update(values).eq('id', id));
    else await request(supabaseClient.from('medications').insert({ ...values, family_id: currentFamily.id }));
    resetMedForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível salvar o medicamento'); }
}

function editMedication(id) {
  const med = db.medications.find(item => item.id === id);
  if (!med) return;
  document.getElementById('med-id').value = med.id;
  document.getElementById('med-name').value = med.name;
  document.getElementById('med-lab').value = med.lab;
  document.getElementById('med-qty').value = med.qty;
  document.getElementById('med-unit').value = med.unit;
  document.getElementById('med-buy-date').value = med.buyDate;
  document.getElementById('med-exp-date').value = med.expDate;
  document.getElementById('med-form-title').innerText = 'Editar Medicamento';
}

function resetMedForm() {
  document.getElementById('form-med').reset();
  document.getElementById('med-id').value = '';
  document.getElementById('med-form-title').innerText = 'Cadastrar Remédio';
}

function renderMeds() {
  const list = document.getElementById('meds-list');
  const today = toLocalDateString();
  const in30Days = toLocalDateString(new Date(Date.now() + 30 * 86400000));
  const isViewer = getUserRole() === 'visualizador';
  const meds = getFamilyMeds();
  if (!meds.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum medicamento cadastrado.</p></div>';
    return;
  }
  list.innerHTML = meds.map(med => {
    const badge = med.expDate < today ? '<span class="badge badge-danger">VENCIDO</span>' : med.expDate <= in30Days ? '<span class="badge badge-warning">VENCE EM BREVE</span>' : '';
    return `<div class="card"><h3>💊 ${escapeHtml(med.name)} ${badge}</h3><p style="font-size:0.85rem;color:var(--text-muted)">Lab: ${escapeHtml(med.lab)} | Qtd: ${med.qty} ${escapeHtml(med.unit)}</p><p style="font-size:0.85rem;margin-top:4px">Validade: <strong>${formatDate(med.expDate)}</strong></p>${!isViewer ? `<div class="btn-group" style="margin-top:8px"><button class="btn btn-secondary btn-sm" onclick="editMedication('${med.id}')">Editar</button></div>` : ''}</div>`;
  }).join('');
}

function addTimeField() {
  const input = document.createElement('input');
  input.type = 'time';
  input.className = 'form-control treat-time';
  input.required = true;
  input.style.marginBottom = '4px';
  document.getElementById('times-container').appendChild(input);
}

function toggleEndDate(value) { document.getElementById('group-end-date').style.display = value === 'until_date' ? 'block' : 'none'; }

async function saveTreatment(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar tratamentos.');
  const id = document.getElementById('treat-id').value;
  const times = [...document.querySelectorAll('.treat-time')].map(input => input.value).filter(Boolean);
  if (!times.length) return showAlertModal('Horário necessário', 'Adicione pelo menos um horário de administração.');
  const durationType = document.getElementById('treat-duration-type').value;
  const endDate = durationType === 'until_date' ? document.getElementById('treat-end-date').value : null;
  if (durationType === 'until_date' && !endDate) return showAlertModal('Data final necessária', 'Informe a data final do tratamento.');
  const values = { pet_id: document.getElementById('treat-pet').value, medication_id: document.getElementById('treat-med').value, dosage: document.getElementById('treat-dosage').value.trim(), times, interval_days: Number(document.getElementById('treat-interval').value), duration_type: durationType, end_date: endDate };
  try {
    if (id) {
      await request(supabaseClient.from('doses').delete().eq('treatment_id', id).in('status', ['pending', 'late']));
      await request(supabaseClient.from('treatments').update(values).eq('id', id));
    } else {
      await request(supabaseClient.from('treatments').insert({ ...values, family_id: currentFamily.id }));
    }
    resetTreatmentForm();
    await refreshApp();
  } catch (error) { showError(error, id ? 'Não foi possível atualizar o tratamento' : 'Não foi possível criar o tratamento'); }
}

function resetTreatmentForm() {
  document.getElementById('form-treatment').reset();
  document.getElementById('treat-id').value = '';
  document.getElementById('treat-form-title').innerText = 'Novo Tratamento';
  document.getElementById('treat-submit-button').innerText = 'Criar Tratamento';
  document.getElementById('times-container').innerHTML = '<input type="time" class="form-control treat-time" style="margin-bottom: 4px;" required>';
  toggleEndDate('indefinite');
}

function editTreatment(id) {
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment) return;
  document.getElementById('treat-id').value = treatment.id;
  document.getElementById('treat-pet').value = treatment.petId;
  document.getElementById('treat-med').value = treatment.medId;
  document.getElementById('treat-dosage').value = treatment.dosage;
  document.getElementById('treat-interval').value = String(treatment.intervalDays);
  document.getElementById('treat-duration-type').value = treatment.durationType;
  document.getElementById('treat-end-date').value = treatment.endDate || '';
  document.getElementById('times-container').innerHTML = treatment.times.map(time => `<input type="time" class="form-control treat-time" style="margin-bottom: 4px;" value="${escapeHtml(time)}" required>`).join('');
  document.getElementById('treat-form-title').innerText = 'Editar Tratamento';
  document.getElementById('treat-submit-button').innerText = 'Salvar Alterações';
  toggleEndDate(treatment.durationType);
  document.getElementById('form-treatment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteTreatment(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem excluir tratamentos.');
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment || !confirm('Excluir este tratamento e suas doses agendadas?')) return;
  try {
    await request(supabaseClient.from('doses').delete().eq('treatment_id', id));
    await request(supabaseClient.from('treatments').delete().eq('id', id));
    resetTreatmentForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível excluir o tratamento'); }
}

function renderTreatments() {
  const list = document.getElementById('treatments-list');
  const isViewer = getUserRole() === 'visualizador';
  const treatments = db.treatments.filter(treatment => treatment.familyId === currentFamily?.id);
  if (!treatments.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum tratamento cadastrado.</p></div>';
    return;
  }
  list.innerHTML = treatments.map(treatment => {
    const pet = db.pets.find(item => item.id === treatment.petId);
    const medication = db.medications.find(item => item.id === treatment.medId);
    const duration = treatment.durationType === 'until_date' ? `Até ${formatDate(treatment.endDate)}` : 'Indefinido';
    const actions = !isViewer ? `<div class="btn-group"><button class="btn btn-secondary btn-sm" onclick="editTreatment('${treatment.id}')">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteTreatment('${treatment.id}')">Excluir</button></div>` : '';
    return `<div class="card"><h3>${escapeHtml(pet?.name || 'Pet')} - ${escapeHtml(medication?.name || 'Medicamento')}</h3><p style="font-size:0.85rem;color:var(--text-muted)">${escapeHtml(treatment.dosage)} | Horários: ${treatment.times.map(escapeHtml).join(', ')} | A cada ${treatment.intervalDays} dia(s)</p><p style="font-size:0.85rem;margin-top:4px">Duração: ${duration}</p>${actions}</div>`;
  }).join('');
}

async function generateScheduledDoses() {
  if (!currentFamily) return;
  const missingDoses = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const treatment of db.treatments) {
    const treatmentStart = new Date(treatment.createdAt);
    treatmentStart.setHours(0, 0, 0, 0);
    for (let index = 0; index < 30; index += 1) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + index);
      const diffDays = Math.round((targetDate - treatmentStart) / 86400000);
      const date = toLocalDateString(targetDate);
      if (diffDays < 0 || diffDays % treatment.intervalDays !== 0 || (treatment.endDate && date > treatment.endDate)) continue;
      treatment.times.forEach(time => {
        const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
        if (!db.doses.some(dose => dose.treatmentId === treatment.id && dose.scheduledDateTime.startsWith(`${date}T${time}`))) {
          missingDoses.push({ family_id: currentFamily.id, treatment_id: treatment.id, pet_id: treatment.petId, medication_id: treatment.medId, scheduled_at: scheduledAt });
        }
      });
    }
  }
  if (missingDoses.length) await request(supabaseClient.from('doses').upsert(missingDoses, { onConflict: 'treatment_id,scheduled_at', ignoreDuplicates: true }));
  const overdueIds = db.doses.filter(dose => dose.status === 'pending' && dose.scheduledDateTime.substring(0, 16) < toLocalDateTimeString()).map(dose => dose.id);
  if (overdueIds.length) await request(supabaseClient.from('doses').update({ status: 'late' }).in('id', overdueIds));
}

function renderAdmin() {
  const isViewer = getUserRole() === 'visualizador';
  document.getElementById('treat-pet').innerHTML = getFamilyPets().map(pet => `<option value="${pet.id}">${escapeHtml(pet.name)}</option>`).join('');
  document.getElementById('treat-med').innerHTML = getFamilyMeds().map(med => `<option value="${med.id}">${escapeHtml(med.name)} (${escapeHtml(med.unit)})</option>`).join('');
  renderTreatments();
  const todayDoses = db.doses.filter(dose => dose.scheduledDateTime.startsWith(toLocalDateString())).sort((left, right) => left.scheduledDateTime.localeCompare(right.scheduledDateTime));
  const list = document.getElementById('today-doses-list');
  if (!todayDoses.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhuma dose agendada para hoje.</p></div>';
    return;
  }
  list.innerHTML = todayDoses.map(dose => renderDoseCard(dose, isViewer)).join('');
}

function renderDoseActions(dose, isViewer) {
  if (isViewer) return '';
  if (dose.status !== 'done' && dose.status !== 'skipped') return `<div class="btn-group" style="margin-top:10px"><button class="btn btn-sm" onclick="markDose('${dose.id}', 'now')">Dei agora</button><button class="btn btn-secondary btn-sm" onclick="markDose('${dose.id}', 'late')">Dei c/ atraso</button><button class="btn btn-danger btn-sm" onclick="markDose('${dose.id}', 'skip')">Não dei</button></div>`;
  return `<div class="btn-group" style="margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="openDoseEdit('${dose.id}')">Editar registro</button><button class="btn btn-danger btn-sm" onclick="undoDose('${dose.id}')">Desfazer</button></div>`;
}

function renderDoseCard(dose, isViewer) {
  const pet = db.pets.find(item => item.id === dose.petId);
  const med = db.medications.find(item => item.id === dose.medId);
  const treatment = db.treatments.find(item => item.id === dose.treatmentId);
  const status = dose.status === 'done' ? '<span class="badge badge-success">Administrada</span>' : dose.status === 'late' ? '<span class="badge badge-danger">Atrasada</span>' : dose.status === 'skipped' ? '<span class="badge badge-warning">Não dada</span>' : '<span class="badge" style="background:var(--text-muted)">Pendente</span>';
  const actual = dose.actualDateTime ? ` | Realizada: ${toLocalDateTimeString(new Date(dose.actualDateTime)).substring(11, 16)}` : '';
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><strong>${dose.scheduledDateTime.substring(11, 16)} - ${escapeHtml(pet?.name || 'Pet')}</strong>${status}</div><p style="font-size:0.9rem;margin-top:4px">Remédio: <strong>${escapeHtml(med?.name || 'Medicamento')}</strong></p><p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">Dose: ${escapeHtml(treatment?.dosage || 'Não informada')}${actual}</p>${renderDoseActions(dose, isViewer)}</div>`;
}

async function markDose(doseId, action) {
  const dose = db.doses.find(item => item.id === doseId);
  if (!dose) return;
  const now = new Date();
  const values = { actual_at: now.toISOString(), status: action === 'skip' ? 'skipped' : 'done' };
  try {
    await request(supabaseClient.from('doses').update(values).eq('id', doseId));
    if (action === 'late' && now - new Date(dose.scheduledDateTime) > 15 * 60000) {
      pendingDelaySuggestion = { doseId, treatmentId: dose.treatmentId, oldTime: dose.scheduledDateTime.substring(11, 16), newTime: now.toTimeString().substring(0, 5), actualAt: now.toISOString() };
      showDelayBanner(pendingDelaySuggestion.oldTime, pendingDelaySuggestion.newTime);
    }
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível registrar a dose'); }
}

function showDelayBanner(oldTime, newTime) {
  const content = `<p style="font-size:0.85rem;margin-bottom:8px">Você administrou com atraso (previsto: <strong>${oldTime}</strong>; atual: <strong>${newTime}</strong>). Deseja usar este horário para esta dose e para os próximos lembretes?</p><div class="btn-group"><button class="btn btn-sm" onclick="acceptDelayAdjust()">Ajustar dose e agenda</button><button class="btn btn-secondary btn-sm" onclick="dismissDelayAdjust()">Manter agenda</button></div>`;
  ['delay-suggestion-banner', 'day-delay-suggestion-banner'].forEach(id => {
    const banner = document.getElementById(id);
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = content;
    }
  });
}

async function acceptDelayAdjust() {
  if (!pendingDelaySuggestion) return;
  const treatment = db.treatments.find(item => item.id === pendingDelaySuggestion.treatmentId);
  if (!treatment) return;
  const times = treatment.times.map(time => time === pendingDelaySuggestion.oldTime ? pendingDelaySuggestion.newTime : time);
  try {
    await Promise.all([
      request(supabaseClient.from('treatments').update({ times }).eq('id', treatment.id)),
      request(supabaseClient.from('doses').update({ scheduled_at: pendingDelaySuggestion.actualAt }).eq('id', pendingDelaySuggestion.doseId))
    ]);
    dismissDelayAdjust();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível ajustar a agenda'); }
}

function dismissDelayAdjust() {
  pendingDelaySuggestion = null;
  ['delay-suggestion-banner', 'day-delay-suggestion-banner'].forEach(id => {
    const banner = document.getElementById(id);
    if (banner) banner.style.display = 'none';
  });
}

function openDoseEdit(doseId) {
  const dose = db.doses.find(item => item.id === doseId);
  if (!dose) return;
  document.getElementById('dose-edit-id').value = dose.id;
  document.getElementById('dose-edit-status').value = dose.status === 'skipped' ? 'skipped' : 'done';
  const actualAt = dose.actualDateTime ? new Date(dose.actualDateTime) : new Date(dose.scheduledDateTime);
  document.getElementById('dose-edit-actual-at').value = `${toLocalDateString(actualAt)}T${String(actualAt.getHours()).padStart(2, '0')}:${String(actualAt.getMinutes()).padStart(2, '0')}`;
  toggleDoseActualTime();
  document.getElementById('dose-edit-modal').style.display = 'flex';
}

function closeDoseEdit() {
  document.getElementById('dose-edit-modal').style.display = 'none';
}

function toggleDoseActualTime() {
  const status = document.getElementById('dose-edit-status').value;
  document.getElementById('dose-edit-actual-group').style.display = status === 'pending' ? 'none' : 'block';
}

async function saveDoseEdit(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar doses.');
  const doseId = document.getElementById('dose-edit-id').value;
  const status = document.getElementById('dose-edit-status').value;
  const actualAt = document.getElementById('dose-edit-actual-at').value;
  if (status !== 'pending' && !actualAt) return showAlertModal('Horário necessário', 'Informe quando a dose foi administrada.');
  try {
    await request(supabaseClient.from('doses').update({ status, actual_at: status === 'pending' ? null : new Date(actualAt).toISOString(), notified: false }).eq('id', doseId));
    closeDoseEdit();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível editar a dose'); }
}

async function undoDose(doseId) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar doses.');
  if (!confirm('Desfazer o registro desta dose e voltar para pendente?')) return;
  try {
    await request(supabaseClient.from('doses').update({ status: 'pending', actual_at: null, notified: false }).eq('id', doseId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível desfazer o registro da dose'); }
}

function renderDashboard() {
  const pets = getFamilyPets();
  const tabs = document.getElementById('dash-pet-tabs');
  if (!pets.length) {
    tabs.innerHTML = '<span style="color:var(--text-muted)">Nenhum pet cadastrado.</span>';
    document.getElementById('kpi-weight').innerText = '-- kg';
    document.getElementById('kpi-doses').innerText = '0';
    document.getElementById('kpi-meds').innerText = '0';
    document.getElementById('week-grid').innerHTML = '';
    return;
  }
  if (!pets.some(pet => pet.id === activePetId)) activePetId = pets[0].id;
  tabs.innerHTML = pets.map(pet => `<div class="pet-tab ${pet.id === activePetId ? 'active' : ''}" onclick="selectDashPet('${pet.id}')">${escapeHtml(pet.name)}</div>`).join('');
  const pet = pets.find(item => item.id === activePetId);
  document.getElementById('kpi-weight').innerText = pet.weightHistory.at(-1) ? `${pet.weightHistory.at(-1).weight} kg` : '-- kg';
  const range = getWeekDateRange(currentWeekOffset);
  document.getElementById('kpi-doses').innerText = db.doses.filter(dose => dose.petId === activePetId && dose.scheduledDateTime >= range.startStr && dose.scheduledDateTime <= range.endStr).length;
  document.getElementById('kpi-meds').innerText = db.treatments.filter(treatment => treatment.petId === activePetId).length;
  renderWeekGrid(range);
}

function selectDashPet(petId) { activePetId = petId; renderDashboard(); }
function changeWeek(delta) { currentWeekOffset += delta; renderDashboard(); }

function getWeekDateRange(offset) {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - startDate.getDay() + offset * 7);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  return { startDate, endDate, startStr: `${toLocalDateString(startDate)}T00:00:00`, endStr: `${toLocalDateString(endDate)}T23:59:59` };
}

function renderWeekGrid(range) {
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const today = toLocalDateString();
  document.getElementById('week-grid').innerHTML = [...Array(7)].map((_, index) => {
    const date = new Date(range.startDate);
    date.setDate(date.getDate() + index);
    const dateString = toLocalDateString(date);
    const dots = db.doses.filter(dose => dose.petId === activePetId && dose.scheduledDateTime.startsWith(dateString)).map(dose => dose.status === 'done' ? '<span class="dose-dot" style="color:var(--success-badge)">✓</span>' : dose.status === 'late' ? '<span class="dose-dot" style="color:var(--danger-badge)">!</span>' : '<span class="dose-dot" style="color:var(--text-muted)">○</span>').join('') || '<span style="color:var(--text-muted);font-size:0.7rem">-</span>';
    return `<button type="button" class="day-col ${dateString === today ? 'today' : ''}" onclick="openDayDetails('${dateString}')" aria-label="Ver detalhes de ${names[index]} ${date.getDate()}"><div>${names[index]}</div><div style="font-size:0.7rem;color:var(--text-muted)">${date.getDate()}</div>${dots}</button>`;
  }).join('');
  document.getElementById('week-label').innerText = currentWeekOffset === 0 ? 'Semana Atual' : `${currentWeekOffset > 0 ? '+' : ''}${currentWeekOffset} Semana(s)`;
  if (activeDayDetailsDate && document.getElementById('day-details-modal').style.display === 'flex') renderDayDetails();
}

function openDayDetails(dateString) {
  activeDayDetailsDate = dateString;
  renderDayDetails();
  document.getElementById('day-details-modal').style.display = 'flex';
}

function closeDayDetails() {
  activeDayDetailsDate = null;
  document.getElementById('day-details-modal').style.display = 'none';
  dismissDelayAdjust();
}

function renderDayDetails() {
  if (!activeDayDetailsDate) return;
  const list = document.getElementById('day-details-list');
  const isViewer = getUserRole() === 'visualizador';
  const doses = db.doses.filter(dose => dose.petId === activePetId && dose.scheduledDateTime.startsWith(activeDayDetailsDate)).sort((left, right) => left.scheduledDateTime.localeCompare(right.scheduledDateTime));
  document.getElementById('day-details-title').innerText = `Detalhes de ${formatDate(activeDayDetailsDate)}`;
  list.innerHTML = doses.length ? doses.map(dose => renderDoseCard(dose, isViewer)).join('') : '<div class="card"><p style="color:var(--text-muted)">Nenhuma dose agendada para este dia.</p></div>';
}

function renderConfig() {
  renderFamilySection();
  document.getElementById('profile-name').value = currentUser.name;
  document.getElementById('profile-email').value = currentUser.email;
  document.getElementById('email-notif-user').checked = currentUser.receiveEmailNotif;
}

function renderFamilySection() {
  const container = document.getElementById('family-info-container');
  const isAdmin = getUserRole() === 'admin';
  const members = currentFamily.members.map(member => {
    const user = db.users.find(item => item.id === member.userId);
    const controls = isAdmin && member.userId !== currentUser.id ? `<div><select class="form-control" style="font-size:0.75rem;padding:4px" onchange="updateMemberRole('${member.userId}', this.value)"><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option><option value="cuidador" ${member.role === 'cuidador' ? 'selected' : ''}>Cuidador</option><option value="visualizador" ${member.role === 'visualizador' ? 'selected' : ''}>Visualizador</option></select><button class="btn btn-danger btn-sm" style="margin-top:4px;padding:2px 6px" onclick="removeMember('${member.userId}')">Remover</button></div>` : '';
    return `<div class="list-item"><div><strong>${escapeHtml(user?.name || 'Membro')}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">Função: ${member.role}</span></div>${controls}</div>`;
  }).join('');
  const controls = isAdmin ? `<div style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:12px"><h4>Código de convite da família</h4><div class="code-box">${escapeHtml(currentFamily.code)}</div><h4 style="margin-top:16px">Convidar por e-mail</h4><form onsubmit="inviteMemberByEmail(event)"><div class="form-group"><input type="email" id="invite-email" class="form-control" placeholder="E-mail do usuário cadastrado" required></div><div class="form-group"><select id="invite-role" class="form-control"><option value="cuidador">Cuidador</option><option value="visualizador">Visualizador</option><option value="admin">Administrador</option></select></div><button type="submit" class="btn btn-sm">Adicionar por e-mail</button></form><form onsubmit="handleRenameFamily(event)" style="margin-top:16px"><div class="form-group"><label>Nome do grupo/família</label><input type="text" id="family-name-input" class="form-control" value="${escapeHtml(currentFamily.name)}" required></div><button type="submit" class="btn btn-secondary btn-sm">Renomear família</button></form><button class="btn btn-danger btn-sm" style="margin-top:12px" onclick="handleDeleteFamily()">Excluir família completa</button></div>` : '';
  container.innerHTML = `<p><strong>Nome do grupo:</strong> ${escapeHtml(currentFamily.name)}</p><h4 style="margin-top:12px">Membros participantes:</h4>${members}${controls}`;
}

async function inviteMemberByEmail(event) {
  event.preventDefault();
  try {
    await request(supabaseClient.rpc('invite_member_by_email', { p_email: document.getElementById('invite-email').value.trim(), p_role: document.getElementById('invite-role').value }));
    document.getElementById('invite-email').value = '';
    await refreshApp();
    showAlertModal('Membro adicionado', 'O usuário agora faz parte do grupo familiar.');
  } catch (error) { showError(error, 'Não foi possível convidar o usuário'); }
}

async function handleJoinByCode(event) {
  event.preventDefault();
  try {
    await request(supabaseClient.rpc('join_family_by_code', { p_code: document.getElementById('join-family-code').value }));
    document.getElementById('join-family-code').value = '';
    await refreshApp();
    showAlertModal('Grupo atualizado', 'Você entrou no novo grupo como Cuidador.');
  } catch (error) { showError(error, 'Não foi possível entrar no grupo'); }
}

async function handleRenameFamily(event) {
  event.preventDefault();
  try {
    await request(supabaseClient.from('families').update({ name: document.getElementById('family-name-input').value.trim() }).eq('id', currentFamily.id));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível renomear a família'); }
}

async function handleDeleteFamily() {
  if (!confirm('Excluir a família apagará pets, tratamentos e histórico compartilhados. Continuar?')) return;
  try {
    await request(supabaseClient.rpc('delete_family_and_create_personal', { p_name: `Família de ${currentUser.name.split(' ')[0]}` }));
    await refreshApp();
    showAlertModal('Família excluída', 'Seu ambiente pessoal foi recriado.');
  } catch (error) { showError(error, 'Não foi possível excluir a família'); }
}

async function updateMemberRole(userId, role) {
  try {
    await request(supabaseClient.from('family_members').update({ role }).eq('family_id', currentFamily.id).eq('user_id', userId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível atualizar a função'); }
}

async function removeMember(userId) {
  if (!confirm('Deseja remover este membro da família?')) return;
  try {
    await request(supabaseClient.from('family_members').delete().eq('family_id', currentFamily.id).eq('user_id', userId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível remover o membro'); }
}

function testNotification() {
  if (!('Notification' in window)) return showAlertModal('Não suportado', 'Seu navegador não suporta notificações de área de trabalho.');
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') new Notification('PetMeds', { body: 'Notificações ativadas com sucesso!' });
    else showAlertModal('Permissão negada', 'Permita as notificações nas configurações do navegador.');
  });
}

async function checkDueNotifications() {
  if (!currentFamily) return;
  const minute = toLocalDateTimeString();
  const due = db.doses.filter(dose => dose.status === 'pending' && !dose.notified && dose.scheduledDateTime.substring(0, 16) === minute);
  for (const dose of due) {
    const pet = db.pets.find(item => item.id === dose.petId);
    const med = db.medications.find(item => item.id === dose.medId);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(`PetMeds: ${pet?.name || 'Pet'}`, { body: `Hora de administrar ${med?.name || 'o medicamento'}.` });
    try { await request(supabaseClient.from('doses').update({ notified: true }).eq('id', dose.id)); } catch (error) { console.error(error); }
  }
}

function changeTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('petmeds_theme', theme);
}

function loadSavedTheme() {
  const theme = localStorage.getItem('petmeds_theme') || 'light';
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-select').value = theme;
}

function exportData() {
  const data = JSON.stringify({ family: currentFamily, pets: db.pets, medications: db.medications, treatments: db.treatments, doses: db.doses }, null, 2);
  const link = document.createElement('a');
  link.href = `data:application/json;charset=utf-8,${encodeURIComponent(data)}`;
  link.download = `petmeds_backup_${toLocalDateString()}.json`;
  link.click();
}

window.addEventListener('DOMContentLoaded', async () => {
  loadSavedTheme();
  try {
    await refreshApp();
  } catch (error) {
    showAuthScreen();
    showError(error, 'Falha ao conectar ao Supabase');
  }
  setInterval(async () => {
    await checkDueNotifications();
  }, 60000);
});
