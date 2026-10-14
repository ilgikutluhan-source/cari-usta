import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { WorkspaceMember } from '../services/members';

type TeamPanelProps = {
  members: WorkspaceMember[];
  onCreate: (data: { displayName: string; email: string; password: string }) => Promise<void>;
};

export default function TeamPanel({ members, onCreate }: TeamPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const displayName = String(values.get('displayName') ?? '').trim();
    const email = String(values.get('email') ?? '').trim().toLowerCase();
    const password = String(values.get('password') ?? '');
    setError('');
    setSuccess('');

    if (displayName.length < 2) {
      setError('Çalışanın adını en az 2 karakterle girin.');
      return;
    }
    if (password.length < 12) {
      setError('İlk şifre en az 12 karakter olmalıdır.');
      return;
    }

    setBusy(true);
    try {
      await onCreate({ displayName, email, password });
      form.reset();
      setSuccess(`${displayName} için çalışan hesabı oluşturuldu. İlk şifre bu tarayıcıda saklanmaz.`);
    } catch (reason) {
      const code = (reason as { code?: string })?.code;
      const messages: Record<string, string> = {
        'auth/email-already-in-use': 'Bu e-posta adresiyle bir Firebase hesabı zaten var.',
        'auth/invalid-email': 'Geçerli bir e-posta adresi yazın.',
        'auth/weak-password': 'Şifre Firebase kurallarını karşılamıyor; daha güçlü bir şifre seçin.',
        'auth/operation-not-allowed': 'Firebase Authentication ayarlarında E-posta/Şifre sağlayıcısını açın.',
        'permission-denied': 'Üyelik eklenemedi. Yeni Firestore güvenlik kurallarının yayımlandığını kontrol edin.',
      };
      setError(code ? (messages[code] ?? (reason instanceof Error ? reason.message : 'Hesap oluşturulamadı.')) : (reason instanceof Error ? reason.message : 'Hesap oluşturulamadı.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-layout">
      <section className="panel team-create-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SAHİP YETKİSİ</span>
            <h2>Çalışan hesabı oluştur</h2>
            <p>Her çalışan kendi e-posta ve şifresiyle giriş yapar; cari defter aynı kalır.</p>
          </div>
          <span className="team-panel-mark"><UserPlus size={19} /></span>
        </div>
        <form className="form-stack team-form" onSubmit={submit}>
          <label className="field">
            <span>Çalışanın adı soyadı <i>*</i></span>
            <input name="displayName" placeholder="Örn. Ayşe Yılmaz" required minLength={2} maxLength={80} autoComplete="name" />
          </label>
          <label className="field">
            <span>Giriş e-postası <i>*</i></span>
            <input type="email" name="email" placeholder="calisan@ornek.com" required maxLength={254} autoComplete="email" />
          </label>
          <label className="field">
            <span>İlk şifre <i>*</i></span>
            <input type="password" name="password" placeholder="En az 12 karakter" required minLength={12} maxLength={128} autoComplete="new-password" />
            <small>Şifre Firebase Authentication'a gönderilir; cari kaydında saklanmaz. İlk şifreyi çalışana ayrı ve güvenli bir kanaldan iletin.</small>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {success && <div className="form-success" role="status"><Check size={15} />{success}</div>}
          <button className="button button-primary team-submit" disabled={busy}>
            {busy ? 'Hesap oluşturuluyor…' : <><UserPlus size={16} /> Çalışan hesabı oluştur</>}
          </button>
        </form>
        <div className="team-security-note"><ShieldCheck size={16} /><span>Çalışanlar cari kayıtlarını görür; kullanıcı hesabı oluşturma yetkisi yalnızca işletme sahibindedir.</span></div>
      </section>

      <section className="panel team-members-panel">
        <div className="panel-heading">
          <div><h2>İşletme kullanıcıları <span className="count-pill">{members.length}</span></h2><p>Bu ortak cari defterine erişimi olan hesaplar.</p></div>
          <span className="team-panel-mark"><Users size={19} /></span>
        </div>
        {members.length ? (
          <div className="team-member-list">
            {members.map((member) => (
              <div className="team-member-row" key={member.uid}>
                <span className="team-member-avatar">{(member.displayName || member.email || '?').trim().slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
                <span className="team-member-copy"><strong>{member.displayName || member.email}</strong><span><Mail size={13} />{member.email}</span></span>
                <span className={`member-role ${member.role}`}>{member.role === 'owner' ? <><ShieldCheck size={13} /> Yönetici</> : <><KeyRound size={13} /> Çalışan</>}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state team-empty"><div className="empty-icon"><Users size={20} /></div><strong>Kullanıcı kaydı yükleniyor</strong><span>Üyelik listesi Firebase'den eşitleniyor.</span></div>
        )}
      </section>
    </div>
  );
}
