const STORAGE_KEY = 'diving_email_settings';

function loadSettings() {
  try {
    const base = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    // PATはsessionStorageから読み込む
    const pat = sessionStorage.getItem(STORAGE_KEY + '_pat') ?? '';
    return { ...base, pat };
  } catch { return {}; }
}

function saveSettings(s) {
  // PATはsessionStorageに保存し、それ以外はlocalStorageに保存
  const { pat, ...rest } = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  if (pat !== undefined) {
    sessionStorage.setItem(STORAGE_KEY + '_pat', pat);
  }
}

async function triggerWorkflowDispatch(email, repo, token) {
  const [owner, repoName] = repo.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/morning-brief.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { test_email: email } }),
    }
  );
  return res.ok;
}

export function initEmailModal() {
  const btn       = document.getElementById('email-settings-btn');
  const modal     = document.getElementById('email-modal');
  const closeBtn  = document.getElementById('modal-close');
  const saveBtn   = document.getElementById('modal-save');
  const testBtn   = document.getElementById('modal-test');
  const statusEl  = document.getElementById('modal-status');
  const emailEl   = document.getElementById('modal-email');
  const timeEl    = document.getElementById('modal-time');
  const repoEl    = document.getElementById('modal-repo');
  const patEl     = document.getElementById('modal-pat');

  const s = loadSettings();
  if (s.email) emailEl.value = s.email;
  if (s.time)  timeEl.value  = s.time;
  if (s.repo)  repoEl.value  = s.repo;
  if (s.pat)   patEl.value   = s.pat;

  const open  = () => modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  function setStatus(msg, color) {
    statusEl.textContent = msg;
    statusEl.style.color = color;
  }

  saveBtn.addEventListener('click', () => {
    saveSettings({ email: emailEl.value.trim(), time: timeEl.value, repo: repoEl.value.trim(), pat: patEl.value.trim() });
    setStatus('✅ 設定を保存しました', '#22c55e');
    setTimeout(() => setStatus('', ''), 3000);
  });

  testBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const repo  = repoEl.value.trim();
    const pat   = patEl.value.trim();

    if (!email) { setStatus('⚠️ メールアドレスを入力してください', '#f59e0b'); return; }
    if (!repo || !pat) { setStatus('⚠️ GitHubリポジトリとPATを入力してください', '#f59e0b'); return; }

    setStatus('📡 GitHub Actions にリクエスト中...', '#00b4d8');
    testBtn.disabled = true;

    try {
      const ok = await triggerWorkflowDispatch(email, repo, pat);
      if (ok) {
        setStatus('✅ 送信リクエスト成功！数分後にメールを確認してください', '#22c55e');
        saveSettings({ email, time: timeEl.value, repo, pat });
      } else {
        setStatus('❌ 失敗。リポジトリ名・PAT・Secretsを確認してください', '#ef4444');
      }
    } catch {
      setStatus('❌ ネットワークエラーが発生しました', '#ef4444');
    } finally {
      testBtn.disabled = false;
    }
  });
}
