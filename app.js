const supabaseClient = window.supabaseClient;

let db = { users: [], families: [], pets: [], medications: [], treatments: [], doses: [] };
let currentUser = null;
let currentFamily = null;
let activePetId = 'all';
let activePetFilter = 'active';
let activeMedicationFilter = 'available';
let currentWeekOffset = 0;
let activeTreatmentTab = 'active';
let pendingDoseConfirmationId = null;
let activeDayDetailsDate = null;
let selectedWeekDate = null;
let activeDoseDetailsId = null;
let authMode = 'login';
let userFamilies = [];
const ACTIVE_FAMILY_KEY = 'petmeds.activeFamilyId';

function getAccessState(role, startsOn, endsOn) {
  if (role !== 'cuidador_temporario') return 'active';
  const today = toLocalDateString();
  if (startsOn && today < startsOn) return 'scheduled';
  if (endsOn && today > endsOn) return 'expired';
  return 'active';
}

function isTemporaryCaregiver() {
  return getUserRole() === 'cuidador_temporario';
}

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

const svgIcon = paths => `<svg class="inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const UI_ICONS = {
  scale: svgIcon('<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>'),
  edit: svgIcon('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  trash: svgIcon('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'),
  calendar: svgIcon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')
};

function uiIcon(file, size = 16) {
  return `<span class="ui-icon" style="--s:${size}px"><img src="${file}" width="${size}" height="${size}" alt=""></span>`;
}

function safePhoto(photo) {
  return typeof photo === 'string' && photo.startsWith('data:image/') ? photo : null;
}

function resizeImageFile(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem selecionada.'));
    };
    image.src = url;
  });
}

// undefined = foto inalterada, null = remover, string = nova foto
const pendingPhotos = { pet: undefined, profile: undefined };

function photoFallback(target) {
  return target === 'pet' ? '🐾' : escapeHtml((currentUser?.name || '?').charAt(0).toUpperCase());
}

function renderPhotoPreview(target, photo) {
  const preview = document.getElementById(`${target}-photo-preview`);
  preview.innerHTML = safePhoto(photo) ? `<img src="${escapeHtml(photo)}" alt="">` : photoFallback(target);
}

async function handlePhotoInput(event, target) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    pendingPhotos[target] = await resizeImageFile(file);
    renderPhotoPreview(target, pendingPhotos[target]);
  } catch (error) { showError(error, 'Foto inválida'); }
}

function clearPhoto(target) {
  pendingPhotos[target] = null;
  renderPhotoPreview(target, null);
}

function memberAvatar(user) {
  const photo = safePhoto(user?.photo);
  return `<div class="member-avatar">${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml((user?.name || '?').charAt(0).toUpperCase())}</div>`;
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

function getActiveFamilyPets() {
  return getFamilyPets().filter(pet => (pet.status || 'active') === 'active');
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
  const profile = await request(supabaseClient.from('profiles').select('id, name, receive_email_notif, photo').eq('id', authUser.id).single());
  currentUser = { id: authUser.id, name: profile.name, email: authUser.email, receiveEmailNotif: profile.receive_email_notif, photo: profile.photo };

  const memberships = await request(supabaseClient.from('family_members').select('family_id, role, receive_email, starts_on, ends_on, families(id, name, code, admin_id)').eq('user_id', authUser.id));
  if (!memberships.length) {
    userFamilies = [];
    currentFamily = null;
    return;
  }

  const membership = memberships.find(item => item.family_id === localStorage.getItem(ACTIVE_FAMILY_KEY)) || memberships[0];
  localStorage.setItem(ACTIVE_FAMILY_KEY, membership.family_id);
  userFamilies = memberships.map(item => ({ id: item.family_id, name: item.families.name, role: item.role }));
  const family = membership.families;
  const accessState = getAccessState(membership.role, membership.starts_on, membership.ends_on);
  if (accessState !== 'active') {
    currentFamily = { id: family.id, name: family.name, code: '', adminId: family.admin_id, accessState, startsOn: membership.starts_on, endsOn: membership.ends_on, members: [{ userId: authUser.id, role: membership.role, startsOn: membership.starts_on, endsOn: membership.ends_on, receiveEmail: membership.receive_email }] };
    db = { users: [{ id: authUser.id, name: profile.name, email: authUser.email, receiveEmailNotif: profile.receive_email_notif }], families: [currentFamily], pets: [], medications: [], treatments: [], doses: [] };
    return;
  }
  const [members, profiles, pets, weights, medications, treatments, doses] = await Promise.all([
    request(supabaseClient.from('family_members').select('family_id, user_id, role, receive_email, starts_on, ends_on').eq('family_id', family.id)),
    request(supabaseClient.from('profiles').select('id, name, photo')),
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
    members: members.map(member => ({ userId: member.user_id, role: member.role, receiveEmail: member.receive_email, startsOn: member.starts_on, endsOn: member.ends_on }))
  };
  db.users = members.map(member => ({
    id: member.user_id,
    name: profileById.get(member.user_id)?.name || 'Membro',
    photo: profileById.get(member.user_id)?.photo || null,
    email: member.user_id === currentUser.id ? currentUser.email : '',
    receiveEmailNotif: member.user_id === currentUser.id ? currentUser.receiveEmailNotif : true
  }));
  db.families = [currentFamily];
  db.pets = pets.map(pet => ({ ...pet, status: pet.status || 'active', familyId: pet.family_id, birth: pet.birth_date, donatedAt: pet.donated_at, deceasedAt: pet.deceased_at, weightHistory: weightsByPet.get(pet.id) || [] }));
  db.medications = medications.map(med => ({ ...med, familyId: med.family_id, qty: Number(med.quantity), packageQty: med.package_quantity ? Number(med.package_quantity) : null, singleDose: Boolean(med.single_dose), buyDate: med.bought_at, expDate: med.expires_at, stockHistory: Array.isArray(med.stock_history) ? med.stock_history : [] }));
  db.treatments = treatments.map(treatment => ({ ...treatment, familyId: treatment.family_id, petId: treatment.pet_id, medId: treatment.medication_id, intervalDays: treatment.interval_days, intervalValue: treatment.interval_value || treatment.interval_days || 1, intervalUnit: treatment.interval_unit || 'day', startDate: treatment.start_date || treatment.created_at.substring(0, 10), scheduleMode: treatment.schedule_mode || 'exact', toleranceMinutes: treatment.tolerance_minutes || 0, durationType: treatment.duration_type, endDate: treatment.end_date, pausedAt: treatment.paused_at, finishedAt: treatment.finished_at, pauseHistory: Array.isArray(treatment.pause_history) ? treatment.pause_history : [], disabledTimes: Array.isArray(treatment.disabled_times) ? treatment.disabled_times : [], createdAt: treatment.created_at, times: treatment.times.map(time => time.substring(0, 5)) }));
  db.doses = doses.map(dose => ({ ...dose, familyId: dose.family_id, treatmentId: dose.treatment_id, petId: dose.pet_id, medId: dose.medication_id, administeredById: dose.administered_by, scheduledDateTime: `${toLocalDateTimeString(new Date(dose.scheduled_at))}:00`, actualDateTime: dose.actual_at, notified: dose.notified }));
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
      activePetId = 'all';
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
    activePetId = 'all';
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
    await request(supabaseClient.from('profiles').update(pendingPhotos.profile !== undefined ? { name, photo: pendingPhotos.profile } : { name }).eq('id', currentUser.id));
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
  document.getElementById('header-user-name').innerText = `Olá, ${currentUser.name.split(' ')[0]}!`;
  document.getElementById('header-avatar').innerHTML = safePhoto(currentUser.photo) ? `<img src="${escapeHtml(currentUser.photo)}" alt="">` : escapeHtml(currentUser.name.charAt(0).toUpperCase());
  const familySelect = document.getElementById('header-family-select');
  familySelect.innerHTML = userFamilies.map(family => `<option value="${escapeHtml(family.id)}">${escapeHtml(family.name)}</option>`).join('');
  familySelect.value = currentFamily?.id || '';
  const labels = { admin: 'Admin', cuidador: 'Cuidador', visualizador: 'Visualizador', cuidador_temporario: 'Cuidador temporário' };
  document.getElementById('header-role-badge').innerText = labels[getUserRole()] || 'Membro';
  document.body.classList.toggle('restricted-caregiver', isTemporaryCaregiver());
  const blocked = currentFamily?.accessState && currentFamily.accessState !== 'active';
  document.body.classList.toggle('access-blocked', Boolean(blocked));
  const banner = document.getElementById('access-blocked-banner');
  banner.style.display = blocked ? 'block' : 'none';
  banner.innerHTML = blocked ? (currentFamily.accessState === 'scheduled' ? `<strong>Acesso ainda não iniciado.</strong><p style="margin-top:4px">Seu acesso a esta família começa em ${formatDate(currentFamily.startsOn)}.</p>` : `<strong>Acesso desativado.</strong><p style="margin-top:4px">Seu período como cuidador temporário nesta família terminou em ${formatDate(currentFamily.endsOn)}. Peça a um administrador para reativá-lo.</p>`) : '';
}

async function switchFamily(familyId) {
  localStorage.setItem(ACTIVE_FAMILY_KEY, familyId);
  activePetId = 'all';
  try {
    await refreshApp();
    switchPage('dashboard');
  } catch (error) { showError(error, 'Não foi possível trocar de família'); }
}

function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.getElementById(`page-${pageId}`).classList.add('active');
  const map = { pets: 0, remedios: 1, dashboard: 2, admin: 3, config: 4 };
  document.querySelectorAll('.bottom-nav .nav-btn').forEach((button, index) => button.classList.toggle('active', index === map[pageId]));
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'pets') renderPets();
  if (pageId === 'remedios') renderMeds();
  if (pageId === 'admin') {
    activeTreatmentTab = 'active';
    renderAdmin();
  }
  if (pageId === 'config' || pageId === 'usuario') renderConfig();
}

async function savePet(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar pets.');
  const id = document.getElementById('pet-id').value;
  const existingPet = db.pets.find(pet => pet.id === id);
  const status = document.getElementById('pet-status').value;
  const values = {
    name: document.getElementById('pet-name').value.trim(),
    species: document.getElementById('pet-species').value,
    birth_date: document.getElementById('pet-birth').value,
    status,
    donated_at: status === 'donated' ? document.getElementById('pet-donated-date').value || existingPet?.donatedAt || (!existingPet || existingPet.status !== 'donated' ? toLocalDateString() : null) : existingPet?.donatedAt || null,
    deceased_at: status === 'deceased' ? document.getElementById('pet-deceased-date').value || existingPet?.deceasedAt || (!existingPet || existingPet.status !== 'deceased' ? toLocalDateString() : null) : existingPet?.deceasedAt || null
  };
  if (pendingPhotos.pet !== undefined) values.photo = pendingPhotos.pet;
  try {
    if (id) await request(supabaseClient.from('pets').update(values).eq('id', id));
    else await request(supabaseClient.from('pets').insert({ ...values, family_id: currentFamily.id }));
    resetPetForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível salvar o pet'); }
}

function openPetForm() {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem cadastrar pets.');
  resetPetForm();
  document.getElementById('pet-modal').style.display = 'flex';
}

function editPet(id) {
  const pet = db.pets.find(item => item.id === id);
  if (!pet) return;
  document.getElementById('pet-id').value = pet.id;
  document.getElementById('pet-name').value = pet.name;
  document.getElementById('pet-species').value = pet.species;
  document.getElementById('pet-birth').value = pet.birth;
  document.getElementById('pet-status').value = pet.status;
  document.getElementById('pet-donated-date').value = pet.donatedAt?.substring(0, 10) || '';
  document.getElementById('pet-deceased-date').value = pet.deceasedAt?.substring(0, 10) || '';
  document.getElementById('pet-status').disabled = pet.status === 'deceased';
  document.getElementById('pet-status-help').innerText = pet.status === 'deceased' ? 'Pets falecidos não podem ser reativados.' : 'Pets doados ou perdidos podem voltar para Ativo.';
  togglePetStatusDates(pet.status);
  pendingPhotos.pet = undefined;
  renderPhotoPreview('pet', pet.photo);
  document.getElementById('pet-form-title').innerText = 'Editar Pet';
  document.getElementById('pet-modal').style.display = 'flex';
}

function resetPetForm() {
  document.getElementById('form-pet').reset();
  document.getElementById('pet-id').value = '';
  document.getElementById('pet-status').disabled = false;
  document.getElementById('pet-donated-date').value = '';
  document.getElementById('pet-deceased-date').value = '';
  document.getElementById('pet-status-help').innerText = '';
  togglePetStatusDates('active');
  pendingPhotos.pet = undefined;
  renderPhotoPreview('pet', null);
  document.getElementById('pet-form-title').innerText = 'Cadastrar Novo Pet';
  document.getElementById('pet-modal').style.display = 'none';
}

function togglePetStatusDates(status, setDefaultDate = false) {
  const donatedGroup = document.getElementById('pet-donated-date-group');
  const deceasedGroup = document.getElementById('pet-deceased-date-group');
  donatedGroup.style.display = status === 'donated' ? 'block' : 'none';
  deceasedGroup.style.display = status === 'deceased' ? 'block' : 'none';
  if (setDefaultDate && status === 'donated' && !document.getElementById('pet-donated-date').value) document.getElementById('pet-donated-date').value = toLocalDateString();
  if (setDefaultDate && status === 'deceased' && !document.getElementById('pet-deceased-date').value) document.getElementById('pet-deceased-date').value = toLocalDateString();
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
  document.getElementById('add-pet-button').style.display = isViewer ? 'none' : 'block';
  document.querySelectorAll('[data-pet-filter]').forEach(button => {
    button.onclick = () => { activePetFilter = button.dataset.petFilter; renderPets(); };
    button.classList.toggle('active', button.dataset.petFilter === activePetFilter);
    button.setAttribute('aria-selected', String(button.dataset.petFilter === activePetFilter));
  });
  const pets = getFamilyPets();
  if (!pets.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum pet cadastrado na família.</p></div>';
    return;
  }
  const visiblePets = pets.filter(pet => activePetFilter === 'active' ? (pet.status || 'active') === 'active' : (pet.status || 'active') !== 'active');
  if (!visiblePets.length) {
    list.innerHTML = `<div class="card"><p style="color:var(--text-muted)">${activePetFilter === 'active' ? 'Nenhum pet ativo.' : 'Nenhum pet não ativo.'}</p></div>`;
    return;
  }
  list.innerHTML = visiblePets.map(pet => {
    const lastWeight = pet.weightHistory.at(-1);
    const icon = pet.species === 'Gato' ? '🐱' : pet.species === 'Cão' ? '🐶' : '🐾';
    const statusLabels = { active: 'Ativo', donated: 'Doado', lost: 'Perdido', deceased: 'Falecido' };
    const statusClasses = { active: 'badge-success', donated: 'badge-warning', lost: 'badge-warning', deceased: 'badge-danger' };
    const status = pet.status || 'active';
    const statusDate = status === 'donated' ? `<p style="font-size:0.85rem;margin-top:4px">Data da doação: <strong>${pet.donatedAt ? formatDate(pet.donatedAt) : 'Não registrada'}</strong></p>` : status === 'deceased' ? `<p style="font-size:0.85rem;margin-top:4px">Data do falecimento: <strong>${pet.deceasedAt ? formatDate(pet.deceasedAt) : 'Não registrada'}</strong></p>` : '';
    const activeTreatments = db.treatments.filter(treatment => treatment.petId === pet.id && !treatment.pausedAt && !isTreatmentFinished(treatment));
    const treatmentsHtml = activeTreatments.length ? `<div class="card-section-label">Tratamentos Ativos:</div><div class="chip-list">${activeTreatments.map(treatment => `<span class="chip">${uiIcon('icone_medicamento_petmeds.svg', 14)}${escapeHtml(treatment.code || '--')} · ${escapeHtml(db.medications.find(med => med.id === treatment.medId)?.name || 'Medicamento')}</span>`).join('')}</div>` : '';
    return `<div class="card pet-card" onclick="openWeightModal('${pet.id}')"><div class="card-head"><div class="card-avatar">${safePhoto(pet.photo) ? `<img src="${escapeHtml(pet.photo)}" alt="">` : icon}</div><div class="card-head-text"><span class="badge ${statusClasses[status] || 'badge'}">${statusLabels[status] || 'Ativo'}</span><h3 class="card-title">${escapeHtml(pet.name)}</h3></div></div><p class="card-meta">Espécie: ${escapeHtml(pet.species)} • ${UI_ICONS.calendar} Nasc.: ${formatDate(pet.birth)}</p>${statusDate}<p class="card-weight weight-summary">${UI_ICONS.scale} ${lastWeight ? `Peso: ${lastWeight.weight} kg <small>(${formatDate(lastWeight.date)})</small>` : 'Peso não registrado'}</p>${treatmentsHtml}<div class="card-actions" onclick="event.stopPropagation()"><button class="btn btn-secondary btn-sm" onclick="openWeightModal('${pet.id}')">${UI_ICONS.scale} Histórico de Peso</button>${!isViewer ? `<button class="btn btn-secondary btn-sm" onclick="editPet('${pet.id}')">${UI_ICONS.edit} Editar</button><button class="btn btn-danger btn-sm" onclick="deletePet('${pet.id}')">${UI_ICONS.trash} Excluir</button>` : ''}</div></div>`;
  }).join('');
}

function openWeightModal(petId) {
  document.getElementById('weight-pet-id').value = petId;
  document.getElementById('weight-record-id').value = '';
  document.getElementById('weight-date').value = toLocalDateString();
  document.getElementById('weight-val').value = '';
  document.getElementById('weight-submit-button').innerText = 'Registrar Peso';
  renderWeightHistory(petId);
  document.getElementById('weight-modal').style.display = 'flex';
  requestAnimationFrame(() => drawWeightChart(petId));
}

function closeWeightModal() { document.getElementById('weight-modal').style.display = 'none'; }

function editWeightRecord(petId, weightId) {
  const pet = db.pets.find(item => item.id === petId);
  const weight = pet?.weightHistory.find(item => item.id === weightId);
  if (!weight) return;
  document.getElementById('weight-pet-id').value = petId;
  document.getElementById('weight-record-id').value = weight.id;
  document.getElementById('weight-date').value = weight.date.substring(0, 10);
  document.getElementById('weight-val').value = weight.weight;
  document.getElementById('weight-submit-button').innerText = 'Salvar Alterações';
}

async function addWeightRecord(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar peso.');
  const petId = document.getElementById('weight-pet-id').value;
  const weightId = document.getElementById('weight-record-id').value;
  const values = { weight: Number(document.getElementById('weight-val').value), recorded_at: document.getElementById('weight-date').value };
  try {
    if (weightId) await request(supabaseClient.from('weight_records').update(values).eq('id', weightId));
    else await request(supabaseClient.from('weight_records').insert({ ...values, pet_id: petId }));
    await refreshApp();
    openWeightModal(petId);
  } catch (error) { showError(error, 'Não foi possível registrar o peso'); }
}

function renderWeightHistory(petId) {
  const pet = db.pets.find(item => item.id === petId);
  const container = document.getElementById('weight-history-list');
  const chart = document.getElementById('weight-chart');
  if (!pet?.weightHistory.length) {
    chart.style.display = 'none';
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted)">Nenhum peso registrado.</p>';
    return;
  }
  chart.style.display = 'block';
  const canEdit = getUserRole() !== 'visualizador';
  container.innerHTML = '<h4>Registros:</h4>' + pet.weightHistory.map(weight => `<div class="list-item"><span>${formatDate(weight.date)}</span><strong>${weight.weight} kg</strong>${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" onclick="editWeightRecord('${petId}', '${weight.id}')">Editar</button>` : ''}</div>`).join('');
}

function drawWeightChart(petId) {
  const pet = db.pets.find(item => item.id === petId);
  const canvas = document.getElementById('weight-chart');
  if (!pet?.weightHistory.length || !canvas || canvas.offsetParent === null) return;
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue('--text-muted').trim() || '#6c757d';
  const lineColor = styles.getPropertyValue('--primary').trim() || '#4a6fa5';
  const padding = { top: 18, right: 16, bottom: 34, left: 42 };
  const values = pet.weightHistory.map(item => Number(item.weight));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, 1);
  const minValue = Math.max(0, minimum - spread * 0.15);
  const maxValue = maximum + spread * 0.15;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const point = (index, value) => ({ x: padding.left + (pet.weightHistory.length === 1 ? chartWidth / 2 : index * chartWidth / (pet.weightHistory.length - 1)), y: padding.top + (maxValue - value) * chartHeight / (maxValue - minValue) });
  context.font = '11px system-ui';
  context.fillStyle = textColor;
  context.strokeStyle = styles.getPropertyValue('--border-color').trim() || '#e2e8f0';
  context.lineWidth = 1;
  [0, 0.5, 1].forEach(step => {
    const y = padding.top + chartHeight * step;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(`${(maxValue - (maxValue - minValue) * step).toFixed(1)} kg`, 2, y + 4);
  });
  context.strokeStyle = lineColor;
  context.lineWidth = 2.5;
  context.beginPath();
  pet.weightHistory.forEach((item, index) => {
    const current = point(index, Number(item.weight));
    if (index === 0) context.moveTo(current.x, current.y); else context.lineTo(current.x, current.y);
  });
  context.stroke();
  pet.weightHistory.forEach((item, index) => {
    const current = point(index, Number(item.weight));
    context.fillStyle = lineColor;
    context.beginPath();
    context.arc(current.x, current.y, 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = textColor;
    context.fillText(formatDate(item.date).substring(0, 5), current.x - 14, height - 12);
  });
}

async function saveMedication(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar medicamentos.');
  const id = document.getElementById('med-id').value;
  const values = { name: document.getElementById('med-name').value.trim(), lab: document.getElementById('med-lab').value.trim(), quantity: Number(document.getElementById('med-qty').value), package_quantity: document.getElementById('med-package-qty').value ? Number(document.getElementById('med-package-qty').value) : null, single_dose: document.getElementById('med-single-dose').checked, unit: document.getElementById('med-unit').value, bought_at: document.getElementById('med-buy-unknown').checked ? null : document.getElementById('med-buy-date').value, expires_at: document.getElementById('med-exp-date').value };
  if (!Number.isFinite(values.quantity) || values.quantity < 0) return showAlertModal('Quantidade inválida', 'Informe uma quantidade igual ou maior que zero.');
  try {
    if (id) {
      const existing = db.medications.find(medication => medication.id === id);
      const stockChanged = existing && (values.quantity !== existing.qty || values.bought_at !== existing.buyDate || values.expires_at !== existing.expDate);
      const stockHistory = [...(existing?.stockHistory || [])];
      if (stockChanged) stockHistory.push({ type: 'adjustment', purchased_at: values.bought_at, expires_at: values.expires_at, quantity_added: values.quantity - existing.qty, recorded_at: new Date().toISOString() });
      await request(supabaseClient.from('medications').update({ ...values, ...(stockChanged ? { stock_history: stockHistory } : {}) }).eq('id', id));
    } else {
      const stockHistory = [{ type: 'initial', purchased_at: values.bought_at, expires_at: values.expires_at, quantity_added: values.quantity, recorded_at: new Date().toISOString() }];
      await request(supabaseClient.from('medications').insert({ ...values, stock_history: stockHistory, family_id: currentFamily.id }));
    }
    resetMedForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível salvar o medicamento'); }
}

function openMedicationForm() {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem cadastrar medicamentos.');
  resetMedForm();
  document.getElementById('med-modal').style.display = 'flex';
}

function editMedication(id) {
  const med = db.medications.find(item => item.id === id);
  if (!med) return;
  document.getElementById('med-id').value = med.id;
  document.getElementById('med-name').value = med.name;
  document.getElementById('med-lab').value = med.lab;
  document.getElementById('med-qty').value = med.qty;
  document.getElementById('med-package-qty').value = med.packageQty ?? '';
  document.getElementById('med-single-dose').checked = med.singleDose;
  document.getElementById('med-unit').value = med.unit;
  document.getElementById('med-buy-date').value = med.buyDate || '';
  toggleBuyDateUnknown(!med.buyDate);
  document.getElementById('med-exp-date').value = med.expDate;
  document.getElementById('med-form-title').innerText = 'Editar Medicamento';
  document.getElementById('med-modal').style.display = 'flex';
}

function resetMedForm() {
  document.getElementById('form-med').reset();
  toggleBuyDateUnknown(false);
  document.getElementById('med-id').value = '';
  document.getElementById('med-form-title').innerText = 'Cadastrar Medicamento';
  document.getElementById('med-modal').style.display = 'none';
}

async function toggleMedicationSingleDose(id, enabled) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar medicamentos.');
  try {
    await request(supabaseClient.from('medications').update({ single_dose: enabled }).eq('id', id));
    await refreshApp();
  } catch (error) {
    showError(error, 'Não foi possível atualizar o medicamento');
    await refreshApp();
  }
}

function toggleBuyDateUnknown(unknown) {
  document.getElementById('med-buy-unknown').checked = unknown;
  const input = document.getElementById('med-buy-date');
  input.disabled = unknown;
  input.required = !unknown;
  if (unknown) input.value = '';
}

function openMedicationRestock(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem atualizar o estoque.');
  const medication = db.medications.find(item => item.id === id);
  if (!medication) return;
  document.getElementById('form-med-restock').reset();
  document.getElementById('med-restock-id').value = medication.id;
  document.getElementById('med-restock-title').innerText = `Reposição: ${medication.name}`;
  document.getElementById('med-restock-date').value = toLocalDateString();
  document.getElementById('med-restock-quantity').value = medication.packageQty ?? '';
  document.getElementById('med-restock-modal').style.display = 'flex';
}

function closeMedicationRestock() {
  document.getElementById('med-restock-modal').style.display = 'none';
}

async function saveMedicationRestock(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem atualizar o estoque.');
  const id = document.getElementById('med-restock-id').value;
  const medication = db.medications.find(item => item.id === id);
  const quantityAdded = Number(document.getElementById('med-restock-quantity').value);
  const purchasedAt = document.getElementById('med-restock-date').value;
  const expiresAt = document.getElementById('med-restock-exp-date').value;
  if (!medication || !Number.isFinite(quantityAdded) || quantityAdded <= 0 || !purchasedAt || !expiresAt) return showAlertModal('Dados incompletos', 'Informe a quantidade, a data da compra e a validade da nova caixa.');
  const stockHistory = [...medication.stockHistory, { type: 'restock', purchased_at: purchasedAt, expires_at: expiresAt, quantity_added: quantityAdded, recorded_at: new Date().toISOString() }];
  try {
    await request(supabaseClient.from('medications').update({ quantity: medication.qty + quantityAdded, bought_at: purchasedAt, expires_at: expiresAt, stock_history: stockHistory }).eq('id', id));
    closeMedicationRestock();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível registrar a reposição'); }
}

function getMedicationStockCategory(medication, today = toLocalDateString()) {
  if (medication.expDate && medication.expDate < today) return 'expired';
  return medication.qty > 0 ? 'available' : 'empty';
}

function getMedicationStockHistoryHtml(medication) {
  const entries = [...medication.stockHistory].sort((left, right) => (left.purchased_at || '').localeCompare(right.purchased_at || ''));
  if (!entries.length) return '';
  const rows = entries.map((entry, index) => {
    const nextEntry = entries[index + 1];
    const elapsedDays = entry.purchased_at ? Math.max(0, Math.round((Date.parse(`${nextEntry?.purchased_at || toLocalDateString()}T12:00:00`) - Date.parse(`${entry.purchased_at}T12:00:00`)) / 86400000)) : null;
    const duration = elapsedDays === null ? 'Data de compra indefinida' : nextEntry ? `Tempo até a próxima reposição: ${elapsedDays} dia(s)` : `Estoque registrado há ${elapsedDays} dia(s)`;
    const entryLabel = entry.type === 'restock' ? 'Reposição' : entry.type === 'adjustment' ? 'Ajuste' : 'Estoque inicial';
    const amount = Number(entry.quantity_added || 0);
    const signedAmount = entry.type === 'adjustment' && amount > 0 ? '+' : '';
    return `<div class="stock-history-entry"><span>${entryLabel}: ${entry.purchased_at ? formatDate(entry.purchased_at) : 'data indefinida'}</span><strong>${signedAmount}${amount} ${escapeHtml(medication.unit)}</strong><small>${duration}${entry.expires_at ? ` | Validade: ${formatDate(entry.expires_at)}` : ''}</small></div>`;
  }).join('');
  return `<details class="stock-history"><summary>Histórico de reposições</summary>${rows}</details>`;
}

function renderMeds() {
  const list = document.getElementById('meds-list');
  const today = toLocalDateString();
  const in30Days = toLocalDateString(new Date(Date.now() + 30 * 86400000));
  const isViewer = getUserRole() === 'visualizador';
  document.getElementById('add-med-button').style.display = isViewer ? 'none' : 'block';
  document.querySelectorAll('[data-medication-filter]').forEach(button => {
    button.onclick = () => { activeMedicationFilter = button.dataset.medicationFilter; renderMeds(); };
    button.classList.toggle('active', button.dataset.medicationFilter === activeMedicationFilter);
    button.setAttribute('aria-selected', String(button.dataset.medicationFilter === activeMedicationFilter));
  });
  const meds = getFamilyMeds();
  if (!meds.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum medicamento cadastrado.</p></div>';
    return;
  }
  const visibleMeds = meds.filter(med => getMedicationStockCategory(med, today) === activeMedicationFilter);
  if (!visibleMeds.length) {
    const emptyMessages = { available: 'Nenhum medicamento dentro da validade com doses disponíveis.', empty: 'Nenhum medicamento sem doses disponíveis.', expired: 'Nenhum medicamento fora da validade.' };
    list.innerHTML = `<div class="card"><p style="color:var(--text-muted)">${emptyMessages[activeMedicationFilter]}</p></div>`;
    return;
  }
  list.innerHTML = visibleMeds.map(med => {
    const category = getMedicationStockCategory(med, today);
    const badge = category === 'expired' ? '<span class="badge badge-danger">FORA DA VALIDADE</span>' : med.expDate <= in30Days ? '<span class="badge badge-warning">VENCE EM BREVE</span>' : '';
    const actions = !isViewer ? `<div class="card-actions"><button class="btn btn-secondary btn-sm" onclick="editMedication('${med.id}')">${UI_ICONS.edit} Editar</button><button class="btn btn-sm" onclick="openMedicationRestock('${med.id}')">Registrar reposição</button></div>` : '';
    return `<div class="card med-card"><div class="card-head"><div class="card-avatar">${uiIcon('icone_medicamento_petmeds.svg', 28)}</div><div class="card-head-text">${badge}<h3 class="card-title">${escapeHtml(med.name)}</h3></div></div><p style="font-size:0.85rem;color:var(--text-muted)">Lab: ${escapeHtml(med.lab)} | Disponível: ${med.qty} ${escapeHtml(med.unit)}${med.packageQty ? ` | Embalagem: ${med.packageQty} ${escapeHtml(med.unit)}` : ''}</p><p style="font-size:0.85rem;margin-top:4px">Validade: <strong>${formatDate(med.expDate)}</strong></p><label style="display:flex;gap:6px;align-items:center;font-size:0.85rem;margin-top:6px"><input type="checkbox" ${med.singleDose ? 'checked' : ''} ${isViewer ? 'disabled' : ''} onchange="toggleMedicationSingleDose('${med.id}', this.checked)"> Disponível para dose única</label>${getMedicationStockHistoryHtml(med)}${actions}</div>`;
  }).join('');
}

function addTimeField() {
  const row = document.createElement('div');
  row.className = 'time-row';
  row.innerHTML = '<label class="treat-time-toggle"><input type="checkbox" class="treat-time-enabled" checked onchange="toggleTreatmentTime(this)"><span>Ativo</span></label><input type="time" class="form-control treat-time" required><button type="button" class="btn btn-danger btn-sm" onclick="removeTimeField(this)" aria-label="Excluir horário">Excluir</button>';
  document.getElementById('times-container').appendChild(row);
}

function removeTimeField(button) {
  const rows = document.querySelectorAll('#times-container .time-row');
  if (rows.length <= 1) return showAlertModal('Horário necessário', 'O tratamento precisa ter pelo menos um horário.');
  button.closest('.time-row').remove();
}

function toggleEndDate(value) { document.getElementById('group-end-date').style.display = value === 'until_date' ? 'block' : 'none'; }

function toggleScheduleMode(value) {
  const isAllDay = value === 'all_day';
  const isWindow = value === 'window';
  document.getElementById('times-container').closest('.form-group').style.display = isAllDay ? 'none' : 'block';
  document.getElementById('group-tolerance').style.display = isWindow ? 'block' : 'none';
  document.querySelectorAll('.treat-time').forEach(input => {
    input.required = !isAllDay && input.closest('.time-row').querySelector('.treat-time-enabled').checked;
  });
}

function toggleTreatmentTime(checkbox) {
  const row = checkbox.closest('.time-row');
  const input = row.querySelector('.treat-time');
  const isAllDay = document.getElementById('treat-schedule-mode').value === 'all_day';
  input.required = checkbox.checked && !isAllDay;
  row.classList.toggle('treat-time-disabled', !checkbox.checked);
}

function openTreatmentForm() {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem cadastrar tratamentos.');
  resetTreatmentForm();
  document.getElementById('treatment-modal').style.display = 'flex';
}

async function saveTreatment(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar tratamentos.');
  const id = document.getElementById('treat-id').value;
  const scheduleMode = document.getElementById('treat-schedule-mode').value;
  const timeInputs = [...document.querySelectorAll('.treat-time')];
  const times = timeInputs.map(input => input.value).filter(Boolean);
  const disabledTimes = scheduleMode === 'all_day' ? [] : timeInputs.filter(input => !input.closest('.time-row').querySelector('.treat-time-enabled').checked).map(input => input.value).filter(Boolean);
  if (new Set(times).size !== times.length) return showAlertModal('Horário duplicado', 'Use apenas um campo para cada horário de administração.');
  if (scheduleMode !== 'all_day' && !times.some(time => !disabledTimes.includes(time))) return showAlertModal('Horário necessário', 'Mantenha pelo menos um horário ativo ou selecione Dia inteiro.');
  const durationType = document.getElementById('treat-duration-type').value;
  const startDate = document.getElementById('treat-start-date').value;
  const intervalValue = Number(document.getElementById('treat-interval-value').value);
  const intervalUnit = document.getElementById('treat-interval-unit').value;
  const toleranceMinutes = scheduleMode === 'window' ? Number(document.getElementById('treat-tolerance-minutes').value) : 0;
  if (!startDate) return showAlertModal('Data inicial necessária', 'Informe a data de início do tratamento.');
  if (!Number.isInteger(intervalValue) || intervalValue < 1) return showAlertModal('Intervalo inválido', 'Informe um número inteiro maior que zero.');
  if (scheduleMode === 'window' && (!Number.isInteger(toleranceMinutes) || toleranceMinutes < 1)) return showAlertModal('Tolerância inválida', 'Informe os minutos de tolerância.');
  const endDate = durationType === 'until_date' ? document.getElementById('treat-end-date').value : null;
  if (durationType === 'until_date' && !endDate) return showAlertModal('Data final necessária', 'Informe a data final do tratamento.');
  const intervalDays = intervalUnit === 'day' ? intervalValue : intervalUnit === 'week' ? intervalValue * 7 : intervalUnit === 'month' ? intervalValue * 30 : intervalValue * 365;
  const values = { pet_id: document.getElementById('treat-pet').value, medication_id: document.getElementById('treat-med').value, dosage: `${document.getElementById('treat-dosage-qty').value} ${document.getElementById('treat-dosage-unit').value}`, dosage_quantity: Number(document.getElementById('treat-dosage-qty').value), dosage_unit: document.getElementById('treat-dosage-unit').value, times: scheduleMode === 'all_day' ? ['12:00'] : times, disabled_times: scheduleMode === 'all_day' ? [] : disabledTimes, schedule_mode: scheduleMode, tolerance_minutes: toleranceMinutes, start_date: startDate, interval_value: intervalValue, interval_unit: intervalUnit, interval_days: intervalDays, duration_type: durationType, end_date: endDate };
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
  document.getElementById('times-container').innerHTML = '<div class="time-row"><label class="treat-time-toggle"><input type="checkbox" class="treat-time-enabled" checked onchange="toggleTreatmentTime(this)"><span>Ativo</span></label><input type="time" class="form-control treat-time" required></div>';
  document.getElementById('treat-start-date').value = toLocalDateString();
  document.getElementById('treat-interval-value').value = '1';
  document.getElementById('treat-interval-unit').value = 'day';
  document.getElementById('treat-schedule-mode').value = 'exact';
  document.getElementById('treat-tolerance-minutes').value = '30';
  toggleEndDate('indefinite');
  toggleScheduleMode('exact');
  document.getElementById('treatment-modal').style.display = 'none';
}

function editTreatment(id) {
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment) return;
  document.getElementById('treat-id').value = treatment.id;
  document.getElementById('treat-pet').value = treatment.petId;
  document.getElementById('treat-med').value = treatment.medId;
  const legacyDosage = /^([\d.,]+)\s*(.*)$/.exec(treatment.dosage || '');
  const unitSelect = document.getElementById('treat-dosage-unit');
  document.getElementById('treat-dosage-qty').value = treatment.dosage_quantity ?? (legacyDosage ? legacyDosage[1].replace(',', '.') : '');
  const legacyUnit = (legacyDosage?.[2] || '').trim().toLowerCase();
  unitSelect.value = treatment.dosage_unit || [...unitSelect.options].find(option => option.value.toLowerCase().startsWith(legacyUnit.replace(/s$/, '')) && legacyUnit)?.value || 'comprimido(s)';
  document.getElementById('treat-schedule-mode').value = treatment.scheduleMode;
  document.getElementById('treat-tolerance-minutes').value = String(treatment.toleranceMinutes || 30);
  document.getElementById('treat-start-date').value = treatment.startDate;
  document.getElementById('treat-interval-value').value = String(treatment.intervalValue);
  document.getElementById('treat-interval-unit').value = treatment.intervalUnit;
  document.getElementById('treat-duration-type').value = treatment.durationType;
  document.getElementById('treat-end-date').value = treatment.endDate || '';
  document.getElementById('times-container').innerHTML = treatment.times.map((time, index) => {
    const enabled = !treatment.disabledTimes.includes(time);
    return `<div class="time-row${enabled ? '' : ' treat-time-disabled'}"><label class="treat-time-toggle"><input type="checkbox" class="treat-time-enabled" ${enabled ? 'checked' : ''} onchange="toggleTreatmentTime(this)"><span>Ativo</span></label><input type="time" class="form-control treat-time" value="${escapeHtml(time)}" ${enabled && treatment.scheduleMode !== 'all_day' ? 'required' : ''}>${index > 0 ? '<button type="button" class="btn btn-danger btn-sm" onclick="removeTimeField(this)" aria-label="Excluir horário">Excluir</button>' : ''}</div>`;
  }).join('');
  document.getElementById('treat-form-title').innerText = 'Editar Tratamento';
  document.getElementById('treat-submit-button').innerText = 'Salvar Alterações';
  toggleEndDate(treatment.durationType);
  toggleScheduleMode(treatment.scheduleMode);
  document.getElementById('treatment-modal').style.display = 'flex';
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
  document.querySelectorAll('.treatment-tab').forEach(button => {
    button.onclick = () => selectTreatmentTab(button.dataset.treatmentTab);
    button.classList.toggle('active', button.dataset.treatmentTab === activeTreatmentTab);
    button.setAttribute('aria-selected', String(button.dataset.treatmentTab === activeTreatmentTab));
  });
  if (!treatments.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Nenhum tratamento cadastrado.</p></div>';
    return;
  }
  const visibleTreatments = activeTreatmentTab === 'all' ? treatments : treatments.filter(treatment => getTreatmentCategory(treatment) === activeTreatmentTab);
  if (!visibleTreatments.length) {
    const emptyMessages = { all: 'Nenhum tratamento cadastrado.', active: 'Nenhum tratamento ativo.', paused: 'Nenhum tratamento pausado.', completed: 'Nenhum tratamento concluído.' };
    list.innerHTML = `<div class="card"><p style="color:var(--text-muted)">${emptyMessages[activeTreatmentTab]}</p></div>`;
    return;
  }
  list.innerHTML = visibleTreatments.map(treatment => {
    const pet = db.pets.find(item => item.id === treatment.petId);
    const medication = db.medications.find(item => item.id === treatment.medId);
    const unitLabels = { day: 'dia(s)', week: 'semana(s)', month: 'mês(es)', year: 'ano(s)' };
    const duration = treatment.durationType === 'until_date' ? `Até ${formatDate(treatment.endDate)}` : 'Indefinido';
    const administeredCount = db.doses.filter(dose => dose.treatmentId === treatment.id && dose.status === 'done').length;
    const plannedCount = getTreatmentPlannedDoseCount(treatment);
    const doseCount = plannedCount === null ? `Administradas: ${administeredCount}` : `Planejadas: ${plannedCount} | Administradas: ${administeredCount}`;
    const finishedDate = treatment.finishedAt ? toLocalDateString(new Date(treatment.finishedAt)) : treatment.endDate;
    const finishedEarly = Boolean(treatment.finishedAt && treatment.endDate && finishedDate < treatment.endDate);
    const status = isTreatmentFinished(treatment)
      ? `<span class="badge badge-warning">${finishedEarly ? `Encerrado antes do previsto: ${formatDate(finishedDate)} (previsto ${formatDate(treatment.endDate)})` : `Concluído em ${formatDate(finishedDate)}`}</span>`
      : treatment.pausedAt ? `<span class="badge badge-warning">Pausado desde ${formatDate(toLocalDateString(new Date(treatment.pausedAt)))}</span>` : '';
    const pauseHistory = treatment.pauseHistory.map(period => {
      const startedAt = new Date(period.paused_at);
      const endedAt = period.resumed_at ? new Date(period.resumed_at) : null;
      const endLabel = endedAt ? formatDateTime(endedAt) : 'em andamento';
      const durationLabel = formatPauseDuration(startedAt, endedAt || new Date());
      return `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Pausa: ${formatDateTime(startedAt)} até ${endLabel} (${durationLabel})</p>`;
    }).join('');
    const statusActions = isTreatmentFinished(treatment) ? '' : treatment.pausedAt
      ? `<button class="btn btn-sm" onclick="resumeTreatment('${treatment.id}')">Retomar</button><button class="btn btn-danger btn-sm" onclick="finishTreatment('${treatment.id}')">Encerrar agora</button>`
      : `<button class="btn btn-secondary btn-sm" onclick="pauseTreatment('${treatment.id}')">Pausar</button><button class="btn btn-danger btn-sm" onclick="finishTreatment('${treatment.id}')">Encerrar agora</button>`;
    const actions = !isViewer ? `<div class="card-actions">${statusActions}<button class="btn btn-secondary btn-sm" onclick="editTreatment('${treatment.id}')">${UI_ICONS.edit} Editar</button><button class="btn btn-danger btn-sm" onclick="deleteTreatment('${treatment.id}')">${UI_ICONS.trash} Excluir</button></div>` : '';
    const timeLabels = treatment.times.map(time => `${escapeHtml(time)}${treatment.disabledTimes.includes(time) ? ' (desativado)' : ''}`).join(', ');
    const scheduleLabels = { exact: `Horários: ${timeLabels}`, window: `Horários: ${timeLabels} (±${treatment.toleranceMinutes} min)`, all_day: 'Dia inteiro' };
    return `<div class="card treatment-card"><div class="card-head"><div class="card-avatar">${uiIcon('icone_tratamento_petmeds.svg', 28)}</div><div class="card-head-text">${status}<h3 class="card-title">${escapeHtml(pet?.name || 'Pet')} - ${escapeHtml(medication?.name || 'Medicamento')}</h3></div></div><p style="font-size:0.8rem;color:var(--text-muted)">Código: <strong>${escapeHtml(treatment.code || '--')}</strong></p><p style="font-size:0.85rem;color:var(--text-muted)">${escapeHtml(treatment.dosage)} | ${scheduleLabels[treatment.scheduleMode] || scheduleLabels.exact} | A cada ${treatment.intervalValue} ${unitLabels[treatment.intervalUnit] || 'dia(s)'}</p><p style="font-size:0.85rem;margin-top:4px">Início: ${formatDate(treatment.startDate)} | Duração: ${duration}</p><p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">${doseCount}</p>${pauseHistory}${actions}</div>`;
  }).join('');
}

function getTreatmentCategory(treatment) {
  if (treatment.pausedAt && !isTreatmentFinished(treatment)) return 'paused';
  return isTreatmentFinished(treatment) ? 'completed' : 'active';
}

function selectTreatmentTab(tab) {
  activeTreatmentTab = tab;
  renderTreatments();
}

function isTreatmentFinished(treatment) {
  return Boolean(treatment.finishedAt || (treatment.endDate && treatment.endDate < toLocalDateString()));
}

function formatDateTime(date) {
  return `${formatDate(toLocalDateString(date))} às ${toLocalDateTimeString(date).substring(11, 16)}`;
}

function formatPauseDuration(start, end) {
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days} dia(s)` : '', hours ? `${hours} h` : '', `${minutes} min`].filter(Boolean).join(' ');
}

function isDoseWithinTreatmentPause(treatment, scheduledAt) {
  return treatment.pauseHistory.some(period => {
    const start = new Date(period.paused_at);
    const end = period.resumed_at ? new Date(period.resumed_at) : null;
    return scheduledAt >= start && (!end || scheduledAt < end);
  });
}

function getTreatmentPlannedDoseCount(treatment) {
  if (!treatment.endDate) return null;
  const endDate = dateFromString(treatment.endDate);
  let plannedCount = 0;
  for (let occurrence = 0; occurrence <= 1000; occurrence += 1) {
    const occurrenceDate = addTreatmentInterval(dateFromString(treatment.startDate), treatment, occurrence);
    if (occurrenceDate > endDate) break;
    const date = toLocalDateString(occurrenceDate);
    for (const time of treatment.times) {
      if (treatment.disabledTimes.includes(time)) continue;
      const scheduledAt = new Date(`${date}T${time}:00`);
      if (treatment.finishedAt && scheduledAt > new Date(treatment.finishedAt)) continue;
      if (!isDoseWithinTreatmentPause(treatment, scheduledAt)) plannedCount += 1;
    }
  }
  return plannedCount;
}

async function pauseTreatment(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem pausar tratamentos.');
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment || treatment.pausedAt || isTreatmentFinished(treatment) || !confirm('Pausar este tratamento? As próximas doses pendentes serão removidas do dashboard.')) return;
  const pausedAt = new Date();
  const pauseHistory = [...treatment.pauseHistory, { paused_at: pausedAt.toISOString(), resumed_at: null }];
  try {
    await request(supabaseClient.from('treatments').update({ paused_at: pausedAt.toISOString(), pause_history: pauseHistory }).eq('id', id));
    await request(supabaseClient.from('doses').delete().eq('treatment_id', id).in('status', ['pending', 'late']).gte('scheduled_at', pausedAt.toISOString()));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível pausar o tratamento'); }
}

async function resumeTreatment(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem retomar tratamentos.');
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment?.pausedAt || isTreatmentFinished(treatment)) return;
  const resumedAt = new Date().toISOString();
  const pauseHistory = [...treatment.pauseHistory];
  const openPauseIndex = pauseHistory.findLastIndex(period => !period.resumed_at);
  if (openPauseIndex >= 0) pauseHistory[openPauseIndex] = { ...pauseHistory[openPauseIndex], resumed_at: resumedAt };
  try {
    await request(supabaseClient.from('treatments').update({ paused_at: null, pause_history: pauseHistory }).eq('id', id));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível retomar o tratamento'); }
}

async function finishTreatment(id) {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem encerrar tratamentos.');
  const treatment = db.treatments.find(item => item.id === id);
  if (!treatment || isTreatmentFinished(treatment) || !confirm('Encerrar este tratamento agora? A data de encerramento será registrada e as próximas doses serão canceladas.')) return;
  const finishedAt = new Date();
  const pauseHistory = [...treatment.pauseHistory];
  const openPauseIndex = pauseHistory.findLastIndex(period => !period.resumed_at);
  if (openPauseIndex >= 0) pauseHistory[openPauseIndex] = { ...pauseHistory[openPauseIndex], resumed_at: finishedAt.toISOString() };
  try {
    await request(supabaseClient.from('treatments').update({ finished_at: finishedAt.toISOString(), paused_at: null, pause_history: pauseHistory }).eq('id', id));
    await request(supabaseClient.from('doses').delete().eq('treatment_id', id).in('status', ['pending', 'late']).gte('scheduled_at', finishedAt.toISOString()));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível encerrar o tratamento'); }
}

function dateFromString(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addTreatmentInterval(date, treatment, count) {
  const result = new Date(date);
  if (treatment.intervalUnit === 'day') result.setDate(result.getDate() + count * treatment.intervalValue);
  if (treatment.intervalUnit === 'week') result.setDate(result.getDate() + count * treatment.intervalValue * 7);
  if (treatment.intervalUnit === 'month') {
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + count * treatment.intervalValue);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
  }
  if (treatment.intervalUnit === 'year') {
    const month = result.getMonth();
    const day = result.getDate();
    result.setDate(1);
    result.setFullYear(result.getFullYear() + count * treatment.intervalValue);
    result.setMonth(month);
    const lastDay = new Date(result.getFullYear(), month + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
  }
  return result;
}

function isTreatmentDateDue(treatment, targetDate) {
  const startDate = dateFromString(treatment.startDate);
  startDate.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  if (targetDate < startDate) return false;
  for (let occurrence = 0; occurrence <= 1000; occurrence += 1) {
    const occurrenceDate = addTreatmentInterval(startDate, treatment, occurrence);
    if (occurrenceDate > targetDate) return false;
    if (toLocalDateString(occurrenceDate) === toLocalDateString(targetDate)) return true;
  }
  return false;
}

async function generateScheduledDoses() {
  if (!currentFamily) return;
  const missingDoses = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const treatment of db.treatments) {
    if (treatment.pausedAt || treatment.finishedAt) continue;
    for (let index = 0; index < 30; index += 1) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + index);
      const date = toLocalDateString(targetDate);
      if (!isTreatmentDateDue(treatment, targetDate) || (treatment.endDate && date > treatment.endDate)) continue;
      treatment.times.forEach(time => {
        if (treatment.disabledTimes.includes(time)) return;
        const scheduledDateTime = new Date(`${date}T${time}:00`);
        if (isDoseWithinTreatmentPause(treatment, scheduledDateTime)) return;
        const scheduledAt = scheduledDateTime.toISOString();
        if (!db.doses.some(dose => dose.treatmentId === treatment.id && dose.scheduledDateTime.startsWith(`${date}T${time}`))) {
          missingDoses.push({ family_id: currentFamily.id, treatment_id: treatment.id, pet_id: treatment.petId, medication_id: treatment.medId, scheduled_at: scheduledAt });
        }
      });
    }
  }
  if (missingDoses.length) await request(supabaseClient.from('doses').upsert(missingDoses, { onConflict: 'treatment_id,scheduled_at', ignoreDuplicates: true }));
  const overdueIds = db.doses.filter(dose => {
    if (dose.status !== 'pending') return false;
    const treatment = db.treatments.find(item => item.id === dose.treatmentId);
    if (treatment?.scheduleMode === 'all_day') return dose.scheduledDateTime.substring(0, 10) < toLocalDateString();
    const deadline = new Date(dose.scheduledDateTime);
    if (treatment?.scheduleMode === 'window') deadline.setMinutes(deadline.getMinutes() + treatment.toleranceMinutes);
    return deadline < new Date();
  }).map(dose => dose.id);
  if (overdueIds.length) await request(supabaseClient.from('doses').update({ status: 'late' }).in('id', overdueIds));
}

function renderAdmin() {
  document.getElementById('treat-pet').innerHTML = getFamilyPets().map(pet => `<option value="${pet.id}">${escapeHtml(pet.name)}</option>`).join('');
  document.getElementById('treat-med').innerHTML = getFamilyMeds().map(med => `<option value="${med.id}">${escapeHtml(med.name)} (${escapeHtml(med.unit)})</option>`).join('');
  document.getElementById('add-treatment-button').style.display = getUserRole() === 'visualizador' ? 'none' : 'block';
  renderTreatments();
}

function setDoseHistoryMode(mode) {
  document.getElementById('dose-history-mode').value = mode;
  document.querySelectorAll('[data-history-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.historyMode === mode);
    button.setAttribute('aria-selected', String(button.dataset.historyMode === mode));
  });
  changeDoseHistoryMode();
}

function changeDoseHistoryMode() {
  document.getElementById('dose-history-member').value = 'all';
  renderDoseAdministrationHistory();
}

function renderDoseAdministrationHistory() {
  const isMedicationMode = document.getElementById('dose-history-mode').value === 'medication';
  const filter = document.getElementById('dose-history-member');
  const history = document.getElementById('dose-administration-history');
  const previous = filter.value || 'all';
  const options = isMedicationMode ? getFamilyMeds().map(med => ({ id: med.id, name: med.name })) : db.users.map(user => ({ id: user.id, name: user.name }));
  document.getElementById('dose-history-filter-label').innerText = isMedicationMode ? 'Filtrar por medicamento' : 'Filtrar por pessoa';
  filter.innerHTML = `<option value="all">${isMedicationMode ? 'Todos os medicamentos' : 'Todas as pessoas'}</option>` + options.map(option => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.name)}</option>`).join('');
  filter.value = previous === 'all' || options.some(option => option.id === previous) ? previous : 'all';

  const doses = db.doses
    .filter(dose => dose.status === 'done' && dose.administeredById && (filter.value === 'all' || (isMedicationMode ? dose.medId : dose.administeredById) === filter.value))
    .sort((left, right) => new Date(right.actualDateTime) - new Date(left.actualDateTime));
  if (!doses.length) {
    history.innerHTML = `<div class="card"><p style="color:var(--text-muted)">Nenhuma administração registrada${isMedicationMode ? ' para este medicamento' : ' para esta pessoa'}.</p></div>`;
    return;
  }

  history.innerHTML = doses.map(dose => {
    const pet = db.pets.find(item => item.id === dose.petId);
    const medication = db.medications.find(item => item.id === dose.medId);
    const member = db.users.find(item => item.id === dose.administeredById);
    const treatment = db.treatments.find(item => item.id === dose.treatmentId);
    const actualAt = new Date(dose.actualDateTime);
    const date = formatDate(toLocalDateString(actualAt));
    const time = toLocalDateTimeString(actualAt).substring(11, 16);
    const muted = 'font-size:0.85rem;color:var(--text-muted);margin-top:4px';
    const treatmentLine = `<p class="card-meta">Tratamento: <strong>${dose.treatmentId ? escapeHtml(treatment?.code || '--') : 'Dose única'}</strong></p>`;
    return `<div class="card"><div class="card-head"><div class="card-avatar">${safePhoto(pet?.photo) ? `<img src="${escapeHtml(pet.photo)}" alt="">` : '🐾'}</div><div class="card-head-text"><span class="badge badge-success">Administrada</span><h3 class="card-title">${escapeHtml(medication?.name || 'Medicamento')}</h3></div></div><p class="card-meta">Pet: <strong>${escapeHtml(pet?.name || 'Pet')}</strong></p><p class="card-meta">Administrado por: <strong>${escapeHtml(member?.name || 'Membro')}</strong></p><p class="card-meta">${UI_ICONS.calendar} Data e horário: <strong>${date} às ${time}</strong></p>${treatmentLine}</div>`;
  }).join('');
}

function renderDoseActions(dose, isViewer) {
  if (isViewer) return '';
  if (dose.status === 'done' || dose.status === 'skipped') return `<div class="card-actions"><button class="btn btn-secondary btn-sm" onclick="openDoseEdit('${dose.id}')">${UI_ICONS.edit} Alterar registro</button><button class="btn btn-secondary btn-sm" onclick="undoDose('${dose.id}')">Desfazer</button></div>`;
  return `<div class="card-actions"><button class="btn btn-sm" onclick="markDose('${dose.id}', 'now')">Dei</button><button class="btn btn-danger btn-sm" onclick="markDose('${dose.id}', 'skip')">Não Dei</button></div>`;
}

function renderDoseCard(dose, isViewer) {
  const pet = db.pets.find(item => item.id === dose.petId);
  const med = db.medications.find(item => item.id === dose.medId);
  const treatment = db.treatments.find(item => item.id === dose.treatmentId);
  const administeredBy = db.users.find(user => user.id === dose.administeredById);
  const status = dose.status === 'done' ? '<span class="badge badge-success">Administrada</span>' : dose.status === 'late' ? '<span class="badge badge-danger">Atrasada</span>' : dose.status === 'skipped' ? '<span class="badge badge-warning">Não dada</span>' : '<span class="badge" style="background:var(--text-muted)">Pendente</span>';
  const schedule = !dose.treatmentId ? 'Dose única' : treatment?.scheduleMode === 'all_day' ? 'Dia inteiro' : `Prevista: ${dose.scheduledDateTime.substring(11, 16)}${treatment?.scheduleMode === 'window' ? ` (±${treatment.toleranceMinutes} min)` : ''}`;
  const actual = dose.actualDateTime ? ` | Realizada: ${toLocalDateTimeString(new Date(dose.actualDateTime)).substring(11, 16)}` : '';
  const administeredByLabel = administeredBy ? `<p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">Administrada por: <strong>${escapeHtml(administeredBy.name)}</strong></p>` : '';
  return `<div class="card dose-card"><div class="card-head"><div class="card-avatar">${safePhoto(pet?.photo) ? `<img src="${escapeHtml(pet.photo)}" alt="">` : '🐾'}</div><div class="card-head-text">${status}<h3 class="card-title">${escapeHtml(med?.name || 'Medicamento')}</h3></div></div><p class="card-meta">Pet: <strong>${escapeHtml(pet?.name || 'Pet')}</strong></p><p class="card-meta">${schedule}${actual}</p><p class="card-meta">Dose: ${escapeHtml(dose.treatmentId ? treatment?.dosage || 'Não informada' : 'Única')}</p><p class="card-meta">Tratamento: <strong>${dose.treatmentId ? escapeHtml(treatment?.code || '--') : 'Dose única'}</strong></p>${administeredByLabel}${renderDoseActions(dose, isViewer)}</div>`;
}

async function markDose(doseId, action) {
  const dose = db.doses.find(item => item.id === doseId);
  if (!dose) return;
  if (action === 'now') return openDoseConfirmation(doseId);
  const now = new Date();
  const values = { actual_at: now.toISOString(), status: 'skipped', administered_by: null };
  try {
    await request(supabaseClient.from('doses').update(values).eq('id', doseId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível registrar a dose'); }
}

function openDoseConfirmation(doseId) {
  pendingDoseConfirmationId = doseId;
  document.getElementById('dose-confirm-actual-at').value = toLocalDateTimeString();
  populateDoseMemberOptions('dose-confirm-administered-by');
  document.getElementById('dose-confirm-modal').style.display = 'flex';
}

function populateDoseMemberOptions(selectId, selectedUserId = currentUser.id) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">Selecione quem administrou</option>' + db.users.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join('');
  select.value = db.users.some(user => user.id === selectedUserId) ? selectedUserId : '';
}

function closeDoseConfirmation() {
  pendingDoseConfirmationId = null;
  document.getElementById('dose-confirm-modal').style.display = 'none';
}

async function confirmDoseNow(event) {
  event.preventDefault();
  const doseId = pendingDoseConfirmationId;
  const actualAt = document.getElementById('dose-confirm-actual-at').value;
  if (!doseId || !actualAt) return showAlertModal('Horário necessário', 'Informe quando a dose foi administrada.');
  const dose = db.doses.find(item => item.id === doseId);
  if (!dose) return closeDoseConfirmation();
  const administeredAt = new Date(actualAt);
  if (Number.isNaN(administeredAt.getTime())) return showAlertModal('Data inválida', 'Informe uma data e horário válidos.');
  const administeredById = document.getElementById('dose-confirm-administered-by').value;
  if (!administeredById) return showAlertModal('Responsável necessário', 'Selecione quem administrou o medicamento.');
  closeDoseConfirmation();
  try {
    await request(supabaseClient.from('doses').update({ actual_at: administeredAt.toISOString(), administered_by: administeredById, status: 'done' }).eq('id', doseId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível registrar a dose'); }
}

function openDoseEdit(doseId) {
  const dose = db.doses.find(item => item.id === doseId);
  if (!dose) return;
  document.getElementById('dose-edit-id').value = dose.id;
  document.getElementById('dose-edit-status').value = dose.status === 'skipped' ? 'skipped' : 'done';
  populateDoseMemberOptions('dose-edit-administered-by', dose.administeredById || currentUser.id);
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
  document.getElementById('dose-edit-administered-by-group').style.display = status === 'done' ? 'block' : 'none';
}

async function saveDoseEdit(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem alterar doses.');
  const doseId = document.getElementById('dose-edit-id').value;
  const status = document.getElementById('dose-edit-status').value;
  const actualAt = document.getElementById('dose-edit-actual-at').value;
  if (status !== 'pending' && !actualAt) return showAlertModal('Horário necessário', 'Informe quando a dose foi administrada.');
  const administeredById = document.getElementById('dose-edit-administered-by').value;
  if (status === 'done' && !administeredById) return showAlertModal('Responsável necessário', 'Selecione quem administrou o medicamento.');
  try {
    await request(supabaseClient.from('doses').update({ status, actual_at: status === 'pending' ? null : new Date(actualAt).toISOString(), administered_by: status === 'done' ? administeredById : null, notified: false }).eq('id', doseId));
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

function getSingleDoseMedications() {
  const today = toLocalDateString();
  return getFamilyMeds().filter(med => getMedicationStockCategory(med, today) === 'available' && med.singleDose);
}

function openSingleDoseForm() {
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem registrar doses.');
  const pets = getActiveFamilyPets();
  const meds = getSingleDoseMedications();
  if (!pets.length) return showAlertModal('Nenhum pet ativo', 'Cadastre um pet ativo para registrar uma dose.');
  if (!meds.length) return showAlertModal('Nenhum medicamento disponível', 'Não há medicamentos disponíveis marcados para dose única. Marque a opção no cadastro do medicamento.');
  document.getElementById('single-dose-pet').innerHTML = pets.map(pet => `<option value="${pet.id}">${escapeHtml(pet.name)}</option>`).join('');
  if (pets.some(pet => pet.id === activePetId)) document.getElementById('single-dose-pet').value = activePetId;
  document.getElementById('single-dose-med').innerHTML = meds.map(med => `<option value="${med.id}">${escapeHtml(med.name)} (${escapeHtml(med.unit)})</option>`).join('');
  document.getElementById('single-dose-actual-at').value = toLocalDateTimeString();
  populateDoseMemberOptions('single-dose-administered-by');
  document.getElementById('single-dose-modal').style.display = 'flex';
}

function closeSingleDoseForm() {
  document.getElementById('single-dose-modal').style.display = 'none';
}

async function saveSingleDose(event) {
  event.preventDefault();
  if (getUserRole() === 'visualizador') return showAlertModal('Acesso restrito', 'Visualizadores não podem registrar doses.');
  const petId = document.getElementById('single-dose-pet').value;
  const medId = document.getElementById('single-dose-med').value;
  const administeredAt = new Date(document.getElementById('single-dose-actual-at').value);
  const administeredById = document.getElementById('single-dose-administered-by').value;
  if (!petId || !medId || Number.isNaN(administeredAt.getTime())) return showAlertModal('Dados incompletos', 'Informe o pet, o medicamento e a data da administração.');
  if (!administeredById) return showAlertModal('Responsável necessário', 'Selecione quem administrou o medicamento.');
  try {
    await request(supabaseClient.from('doses').insert({ family_id: currentFamily.id, treatment_id: null, pet_id: petId, medication_id: medId, scheduled_at: administeredAt.toISOString(), actual_at: administeredAt.toISOString(), administered_by: administeredById, status: 'done' }));
    closeSingleDoseForm();
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível registrar a dose única'); }
}

function isTreatmentVisibleInDashboard(treatmentId) {
  if (!treatmentId) return true;
  const treatment = db.treatments.find(item => item.id === treatmentId);
  return Boolean(treatment && !treatment.pausedAt && !isTreatmentFinished(treatment));
}

function renderDashboard() {
  renderDoseAdministrationHistory();
  const pets = getActiveFamilyPets();
  const tabs = document.getElementById('dash-pet-tabs');
  if (!pets.length) {
    tabs.innerHTML = '<span style="color:var(--text-muted)">Nenhum pet cadastrado.</span>';
    document.getElementById('kpi-weight').innerText = '-- kg';
    document.getElementById('kpi-doses').innerText = '0';
    document.getElementById('kpi-meds').innerText = '0';
    document.getElementById('week-grid').innerHTML = '';
    document.getElementById('week-dose-list').innerHTML = '';
    return;
  }
  if (activePetId !== 'all' && !pets.some(pet => pet.id === activePetId)) activePetId = pets[0].id;
  tabs.innerHTML = `<div class="pet-tab ${activePetId === 'all' ? 'active' : ''}" onclick="selectDashPet('all')">Todos</div>${pets.map(pet => `<div class="pet-tab ${pet.id === activePetId ? 'active' : ''}" onclick="selectDashPet('${pet.id}')">${safePhoto(pet.photo) ? `<img class="tab-avatar" src="${escapeHtml(pet.photo)}" alt="">` : ''}${escapeHtml(pet.name)}</div>`).join('')}`;
  const pet = pets.find(item => item.id === activePetId);
  const range = getWeekDateRange(currentWeekOffset);
  const selectedPetIds = activePetId === 'all' ? new Set(getFamilyPets().map(item => item.id)) : new Set([activePetId]);
  const weight = activePetId === 'all'
    ? pets.reduce((total, currentPet) => total + (Number(currentPet.weightHistory.at(-1)?.weight) || 0), 0)
    : pet?.weightHistory.at(-1)?.weight;
  const hasWeight = activePetId === 'all' ? pets.some(currentPet => currentPet.weightHistory.at(-1)) : weight !== undefined;
  document.getElementById('kpi-weight').innerText = hasWeight ? `${weight} kg` : '-- kg';
  document.getElementById('kpi-doses').innerText = db.doses.filter(dose => selectedPetIds.has(dose.petId) && isTreatmentVisibleInDashboard(dose.treatmentId) && dose.scheduledDateTime >= range.startStr && dose.scheduledDateTime <= range.endStr).length;
  document.getElementById('kpi-meds').innerText = db.treatments.filter(treatment => selectedPetIds.has(treatment.petId) && !treatment.pausedAt && !isTreatmentFinished(treatment)).length;
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

const DOSE_STATUS_ICONS = {
  done: '<svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Administrada"><circle cx="12" cy="12" r="11" fill="#2ecc71"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  waiting: '<svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Aguardando administração"><path d="M6 3h12M6 21h12M7 3v3.5c0 2 2 3.5 5 5.5-3 2-5 3.5-5 5.5V21M17 3v3.5c0 2-2 3.5-5 5.5 3 2 5 3.5 5 5.5V21" fill="rgba(245,166,35,0.25)" stroke="#f5a623" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  scheduled: '<svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Agendada"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  skipped: '<svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Não dada"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#e74c3c" stroke-width="2.8" stroke-linecap="round"/></svg>'
};

function getDoseStatusIcon(dose) {
  if (dose.status === 'done') return DOSE_STATUS_ICONS.done;
  if (dose.status === 'skipped') return DOSE_STATUS_ICONS.skipped;
  if (dose.status === 'late' || new Date(dose.scheduledDateTime) <= new Date()) return DOSE_STATUS_ICONS.waiting;
  return DOSE_STATUS_ICONS.scheduled;
}

function selectWeekDay(dateString) {
  selectedWeekDate = dateString;
  renderWeekGrid(getWeekDateRange(currentWeekOffset));
}

function renderWeekGrid(range) {
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const today = toLocalDateString();
  const weekDates = [...Array(7)].map((_, index) => {
    const date = new Date(range.startDate);
    date.setDate(date.getDate() + index);
    return { date, dateString: toLocalDateString(date), name: names[index] };
  });
  if (!weekDates.some(day => day.dateString === selectedWeekDate)) selectedWeekDate = weekDates.find(day => day.dateString === today)?.dateString || weekDates[0].dateString;
  const selectedPetIds = activePetId === 'all' ? new Set(getFamilyPets().map(pet => pet.id)) : new Set([activePetId]);
  document.getElementById('week-grid').innerHTML = weekDates.map(day => `<button type="button" class="day-col ${day.dateString === today ? 'today' : ''} ${day.dateString === selectedWeekDate ? 'selected' : ''}" onclick="selectWeekDay('${day.dateString}')" aria-pressed="${day.dateString === selectedWeekDate}" aria-label="${day.name} ${day.date.getDate()}"><span>${day.name}</span><strong>${day.date.getDate()}</strong></button>`).join('');
  const doses = db.doses.filter(dose => selectedPetIds.has(dose.petId) && isTreatmentVisibleInDashboard(dose.treatmentId) && dose.scheduledDateTime.startsWith(selectedWeekDate)).sort((left, right) => left.scheduledDateTime.localeCompare(right.scheduledDateTime));
  document.getElementById('week-dose-list').innerHTML = doses.length ? doses.map(dose => {
    const medication = db.medications.find(item => item.id === dose.medId);
    const pet = db.pets.find(item => item.id === dose.petId);
    const treatment = db.treatments.find(item => item.id === dose.treatmentId);
    const time = treatment?.scheduleMode === 'all_day' ? 'Dia todo' : dose.scheduledDateTime.substring(11, 16);
    return `<div class="week-dose-row" role="button" tabindex="0" onclick="openDoseDetails('${dose.id}')" onkeydown="if (event.key === 'Enter') openDoseDetails('${dose.id}')"><div><strong>${time}</strong> - ${escapeHtml(medication?.name || 'Medicamento')}<div class="week-dose-pet">${escapeHtml(pet?.name || 'Pet')}</div></div><span class="dose-status">${getDoseStatusIcon(dose)}</span></div>`;
  }).join('') : '<p class="week-dose-empty">Nenhuma dose agendada para este dia.</p>';
  document.getElementById('week-label').innerText = currentWeekOffset === 0 ? 'Semana Atual' : `${currentWeekOffset > 0 ? '+' : ''}${currentWeekOffset} Semana(s)`;
  if ((activeDayDetailsDate || activeDoseDetailsId) && document.getElementById('day-details-modal').style.display === 'flex') renderDayDetails();
}

function openDayDetails(dateString) {
  activeDayDetailsDate = dateString;
  renderDayDetails();
  document.getElementById('day-details-modal').style.display = 'flex';
}

function openDoseDetails(doseId) {
  activeDayDetailsDate = null;
  activeDoseDetailsId = doseId;
  renderDayDetails();
  document.getElementById('day-details-modal').style.display = 'flex';
}

function closeDayDetails() {
  activeDayDetailsDate = null;
  activeDoseDetailsId = null;
  document.getElementById('day-details-modal').style.display = 'none';
}

function renderDayDetails() {
  const list = document.getElementById('day-details-list');
  const isViewer = getUserRole() === 'visualizador';
  if (activeDoseDetailsId) {
    const dose = db.doses.find(item => item.id === activeDoseDetailsId);
    document.getElementById('day-details-title').innerText = 'Detalhes da dose';
    list.innerHTML = dose ? renderDoseCard(dose, isViewer) : '<div class="card"><p style="color:var(--text-muted)">Dose não encontrada.</p></div>';
    return;
  }
  if (!activeDayDetailsDate) return;
  const selectedPetIds = activePetId === 'all' ? new Set(getFamilyPets().map(pet => pet.id)) : new Set([activePetId]);
  const doses = db.doses.filter(dose => selectedPetIds.has(dose.petId) && isTreatmentVisibleInDashboard(dose.treatmentId) && dose.scheduledDateTime.startsWith(activeDayDetailsDate)).sort((left, right) => left.scheduledDateTime.localeCompare(right.scheduledDateTime));
  document.getElementById('day-details-title').innerText = `Detalhes de ${formatDate(activeDayDetailsDate)}`;
  list.innerHTML = doses.length ? doses.map(dose => renderDoseCard(dose, isViewer)).join('') : '<div class="card"><p style="color:var(--text-muted)">Nenhuma dose agendada para este dia.</p></div>';
}

function renderConfig() {
  renderFamilySection();
  document.getElementById('profile-name').value = currentUser.name;
  pendingPhotos.profile = undefined;
  renderPhotoPreview('profile', currentUser.photo);
  document.getElementById('profile-email').value = currentUser.email;
  document.getElementById('email-notif-user').checked = currentUser.receiveEmailNotif;
}

function renderFamilySection() {
  const container = document.getElementById('family-info-container');
  const isAdmin = getUserRole() === 'admin';
  const members = currentFamily.members.map(member => {
    const user = db.users.find(item => item.id === member.userId);
    const roleLabels = { admin: 'Admin', cuidador: 'Cuidador', visualizador: 'Visualizador', cuidador_temporario: 'Cuidador temporário' };
    const isTemporary = member.role === 'cuidador_temporario';
    const stateLabels = { active: 'Ativo', scheduled: 'Aguardando início', expired: 'Desativado' };
    const state = getAccessState(member.role, member.startsOn, member.endsOn);
    const periodInfo = isTemporary ? `<br><span style="font-size:0.75rem;color:var(--text-muted)">${stateLabels[state]} | Período: ${member.startsOn ? formatDate(member.startsOn) : 'sem início'} a ${member.endsOn ? formatDate(member.endsOn) : 'sem fim'}</span>` : '';
    const periodControls = isTemporary ? `<div style="display:flex;gap:4px;margin-top:4px"><input type="date" class="form-control" style="font-size:0.75rem;padding:4px" id="member-start-${member.userId}" value="${member.startsOn || ''}" aria-label="Data de início"><input type="date" class="form-control" style="font-size:0.75rem;padding:4px" id="member-end-${member.userId}" value="${member.endsOn || ''}" aria-label="Data final"></div><button class="btn btn-secondary btn-sm" style="margin-top:4px;padding:2px 6px" onclick="updateMemberPeriod('${member.userId}')">${state === 'expired' ? 'Reativar com este período' : 'Salvar período'}</button> ` : '';
    const controls = isAdmin && member.userId !== currentUser.id ? `<div><select class="form-control" style="font-size:0.75rem;padding:4px" onchange="updateMemberRole('${member.userId}', this.value)"><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option><option value="cuidador" ${member.role === 'cuidador' ? 'selected' : ''}>Cuidador</option><option value="cuidador_temporario" ${isTemporary ? 'selected' : ''}>Cuidador temporário</option><option value="visualizador" ${member.role === 'visualizador' ? 'selected' : ''}>Visualizador</option></select>${periodControls}<button class="btn btn-danger btn-sm" style="margin-top:4px;padding:2px 6px" onclick="removeMember('${member.userId}')">Remover</button></div>` : '';
    return `<div class="list-item"><div class="member-info">${memberAvatar(user)}<div><strong>${escapeHtml(user?.name || 'Membro')}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">Função: ${roleLabels[member.role] || member.role}</span>${periodInfo}</div></div>${controls}</div>`;
  }).join('');
  const controls = isAdmin ? `<div style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:12px"><h4>Código de convite da família</h4><div class="code-box">${escapeHtml(currentFamily.code)}</div><h4 style="margin-top:16px">Convidar por e-mail</h4><form onsubmit="inviteMemberByEmail(event)"><div class="form-group"><input type="email" id="invite-email" class="form-control" placeholder="E-mail do usuário cadastrado" required></div><div class="form-group"><select id="invite-role" class="form-control" onchange="toggleInvitePeriod(this.value)"><option value="cuidador">Cuidador</option><option value="cuidador_temporario">Cuidador temporário (só administra doses)</option><option value="visualizador">Visualizador</option><option value="admin">Administrador</option></select></div><div id="invite-period" style="display:none"><div class="form-group"><label>Início do acesso</label><input type="date" id="invite-starts-on" class="form-control"></div><div class="form-group"><label>Fim do acesso</label><input type="date" id="invite-ends-on" class="form-control"></div></div><button type="submit" class="btn btn-sm">Adicionar por e-mail</button></form><form onsubmit="handleRenameFamily(event)" style="margin-top:16px"><div class="form-group"><label>Nome do grupo/família</label><input type="text" id="family-name-input" class="form-control" value="${escapeHtml(currentFamily.name)}" required></div><button type="submit" class="btn btn-secondary btn-sm">Renomear família</button></form><button class="btn btn-danger btn-sm" style="margin-top:12px" onclick="handleDeleteFamily()">Excluir família completa</button></div>` : '';
  container.innerHTML = `<p><strong>Nome do grupo:</strong> ${escapeHtml(currentFamily.name)}</p><h4 style="margin-top:12px">Membros participantes:</h4>${members}${controls}`;
}

async function inviteMemberByEmail(event) {
  event.preventDefault();
  const role = document.getElementById('invite-role').value;
  const isTemporary = role === 'cuidador_temporario';
  const startsOn = isTemporary ? document.getElementById('invite-starts-on').value || null : null;
  const endsOn = isTemporary ? document.getElementById('invite-ends-on').value || null : null;
  if (startsOn && endsOn && endsOn < startsOn) return showAlertModal('Período inválido', 'A data final deve ser igual ou posterior à data de início.');
  try {
    await request(supabaseClient.rpc('invite_member_to_family', { p_family_id: currentFamily.id, p_email: document.getElementById('invite-email').value.trim(), p_role: role, p_starts_on: startsOn, p_ends_on: endsOn }));
    document.getElementById('invite-email').value = '';
    await refreshApp();
    showAlertModal('Membro adicionado', 'O usuário agora faz parte do grupo familiar.');
  } catch (error) { showError(error, 'Não foi possível convidar o usuário'); }
}

async function handleJoinByCode(event) {
  event.preventDefault();
  try {
    const joined = await request(supabaseClient.rpc('join_family_by_code', { p_code: document.getElementById('join-family-code').value }));
    document.getElementById('join-family-code').value = '';
    if (joined?.id) localStorage.setItem(ACTIVE_FAMILY_KEY, joined.id);
    await refreshApp();
    showAlertModal('Grupo adicionado', 'Você entrou no grupo como Cuidador e ele agora é a família ativa.');
  } catch (error) { showError(error, 'Não foi possível entrar no grupo'); }
}

function toggleInvitePeriod(role) {
  document.getElementById('invite-period').style.display = role === 'cuidador_temporario' ? 'block' : 'none';
}

async function handleCreateFamily(event) {
  event.preventDefault();
  try {
    const created = await request(supabaseClient.rpc('create_personal_family', { p_name: document.getElementById('new-family-name').value.trim() }));
    document.getElementById('new-family-name').value = '';
    if (created?.id) localStorage.setItem(ACTIVE_FAMILY_KEY, created.id);
    await refreshApp();
    showAlertModal('Família criada', 'A nova família agora é a família ativa.');
  } catch (error) { showError(error, 'Não foi possível criar a família'); }
}

async function updateMemberPeriod(userId) {
  const startsOn = document.getElementById(`member-start-${userId}`).value || null;
  const endsOn = document.getElementById(`member-end-${userId}`).value || null;
  if (startsOn && endsOn && endsOn < startsOn) return showAlertModal('Período inválido', 'A data final deve ser igual ou posterior à data de início.');
  try {
    await request(supabaseClient.from('family_members').update({ starts_on: startsOn, ends_on: endsOn }).eq('family_id', currentFamily.id).eq('user_id', userId));
    await refreshApp();
  } catch (error) { showError(error, 'Não foi possível atualizar o período'); }
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
    const wasLastFamily = userFamilies.length <= 1;
    await request(supabaseClient.rpc('delete_family', { p_family_id: currentFamily.id }));
    localStorage.removeItem(ACTIVE_FAMILY_KEY);
    if (wasLastFamily) await request(supabaseClient.rpc('create_personal_family', { p_name: `Família de ${currentUser.name.split(' ')[0]}` }));
    await refreshApp();
    showAlertModal('Família excluída', wasLastFamily ? 'Seu ambiente pessoal foi recriado.' : 'Você voltou para outra família.');
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
