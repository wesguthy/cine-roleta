/* ======================================================================
   CINE ROLETA — autenticação e sincronização com Supabase
   ====================================================================== */

// >>> PREENCHA AQUI com os dados do seu projeto Supabase <<<
// (Supabase Dashboard > Project Settings > API)
const SUPABASE_URL = 'COLE_A_URL_DO_SEU_PROJETO_AQUI';
const SUPABASE_ANON_KEY = 'COLE_SUA_CHAVE_ANON_AQUI';

const supabaseClient = (window.supabase && !SUPABASE_URL.startsWith('COLE_'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
let currentUsername = null;
let authMode = 'login'; // 'login' | 'signup'

function isSupabaseConfigured(){
  return !!supabaseClient;
}

// ---------------------------------------------------------------------
// UI do widget de login (canto superior)
// ---------------------------------------------------------------------
function updateAuthUI(){
  const widget = document.getElementById('auth-widget');
  if(!isSupabaseConfigured()){
    widget.innerHTML = `<span class="auth-unconfigured" title="Configure o Supabase em auth.js">☁️ off-line</span>`;
    return;
  }
  if(currentUser){
    widget.innerHTML = `
      <span class="auth-username">👤 ${currentUsername}</span>
      <button class="auth-btn" id="auth-logout-btn">Sair</button>
    `;
    document.getElementById('auth-logout-btn').addEventListener('click', handleLogoutClick);
  } else {
    widget.innerHTML = `<button class="auth-btn" id="auth-open-btn">Entrar</button>`;
    document.getElementById('auth-open-btn').addEventListener('click', () => openAuthModal('login'));
  }
}

function openAuthModal(mode){
  authMode = mode || 'login';
  document.getElementById('auth-modal').hidden = false;
  setAuthTab(authMode);
  clearAuthError();
}

function closeAuthModal(){
  document.getElementById('auth-modal').hidden = true;
  clearAuthError();
  document.getElementById('login-form').reset();
  document.getElementById('signup-form').reset();
}

function setAuthTab(mode){
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === mode);
  });
  document.getElementById('login-form').hidden = mode !== 'login';
  document.getElementById('signup-form').hidden = mode !== 'signup';
  clearAuthError();
}

function showAuthError(msg){
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.hidden = false;
}

function clearAuthError(){
  const el = document.getElementById('auth-error');
  el.hidden = true;
  el.textContent = '';
}

function setAuthLoading(isLoading, formEl){
  const btn = formEl.querySelector('button[type="submit"]');
  btn.disabled = isLoading;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = isLoading ? 'Aguarde...' : btn.dataset.originalText;
}

// ---------------------------------------------------------------------
// Ações de autenticação
// ---------------------------------------------------------------------
async function resolveEmailForIdentifier(identifier){
  if(identifier.includes('@')) return identifier;
  const { data, error } = await supabaseClient.rpc('get_email_for_username', { uname: identifier });
  if(error || !data){
    throw new Error('Usuário não encontrado.');
  }
  return data;
}

async function handleLoginSubmit(e){
  e.preventDefault();
  clearAuthError();
  const form = document.getElementById('login-form');
  const identifier = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value;

  setAuthLoading(true, form);
  try{
    const email = await resolveEmailForIdentifier(identifier);
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;
    closeAuthModal();
  }catch(err){
    showAuthError(traduzErroAuth(err));
  }finally{
    setAuthLoading(false, form);
  }
}

async function handleSignupSubmit(e){
  e.preventDefault();
  clearAuthError();
  const form = document.getElementById('signup-form');
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  if(username.length < 3){
    showAuthError('O usuário precisa ter pelo menos 3 caracteres.');
    return;
  }
  if(password.length < 6){
    showAuthError('A senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  setAuthLoading(true, form);
  try{
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: {
        data: { username },
        emailRedirectTo: window.location.href
      }
    });
    if(error) throw error;

    if(data.session){
      closeAuthModal();
    } else {
      showAuthError('Conta criada! Verifique seu e-mail para confirmar antes de entrar.');
    }
  }catch(err){
    showAuthError(traduzErroAuth(err));
  }finally{
    setAuthLoading(false, form);
  }
}

async function handleLogoutClick(){
  await supabaseClient.auth.signOut();
}

function traduzErroAuth(err){
  const msg = (err && err.message) || 'Algo deu errado.';
  if(msg.includes('Invalid login credentials')) return 'Usuário/e-mail ou senha incorretos.';
  if(msg.includes('User already registered')) return 'Já existe uma conta com esse e-mail.';
  if(msg.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(msg.includes('não encontrado')) return msg;
  return msg;
}

// ---------------------------------------------------------------------
// Sincronização de filmes assistidos com a nuvem
// ---------------------------------------------------------------------
async function fetchCloudWatched(){
  const { data, error } = await supabaseClient
    .from('watched_movies')
    .select('tt_id')
    .eq('user_id', currentUser.id);
  if(error){
    console.warn('Não foi possível carregar os filmes assistidos da nuvem.', error);
    return [];
  }
  return data.map(r => r.tt_id);
}

async function pushWatchedToCloud(ttId){
  if(!currentUser) return;
  const { error } = await supabaseClient
    .from('watched_movies')
    .upsert({ user_id: currentUser.id, tt_id: ttId });
  if(error) console.warn('Falha ao salvar na nuvem:', error);
}

async function removeWatchedFromCloud(ttId){
  if(!currentUser) return;
  const { error } = await supabaseClient
    .from('watched_movies')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('tt_id', ttId);
  if(error) console.warn('Falha ao remover da nuvem:', error);
}

// Ao logar: a nuvem passa a ser a única fonte de verdade do progresso.
async function loadCloudWatchedIntoState(){
  const cloudIds = await fetchCloudWatched();
  watched = new Set(cloudIds);
  refreshWatchedUI();
  refreshAllGridStates();
  if(currentMovie) applyWatchedState(currentMovie.ttId);
  applyListFilter();
}

// ---------------------------------------------------------------------
// Estado de autenticação
// ---------------------------------------------------------------------
async function handleAuthChange(session){
  if(session && session.user){
    currentUser = session.user;
    currentUsername = session.user.user_metadata && session.user.user_metadata.username
      ? session.user.user_metadata.username
      : session.user.email.split('@')[0];
    updateAuthUI();
    await loadCloudWatchedIntoState();
  } else {
    currentUser = null;
    currentUsername = null;
    updateAuthUI();
    watched = new Set();
    refreshWatchedUI();
    refreshAllGridStates();
    if(currentMovie) applyWatchedState(currentMovie.ttId);
    applyListFilter();
  }
}

async function initAuth(){
  updateAuthUI();

  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('signup-form').addEventListener('submit', handleSignupSubmit);
  document.getElementById('auth-modal-close').addEventListener('click', closeAuthModal);
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => setAuthTab(btn.dataset.tab));
  });

  if(!isSupabaseConfigured()){
    console.warn('Supabase não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY em auth.js. O app segue funcionando em modo local (visitante).');
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  await handleAuthChange(session);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleAuthChange(session);
  });
}

document.addEventListener('DOMContentLoaded', initAuth);
